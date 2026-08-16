/**
 * ════════════════════════════════════════════════
 * FILE: qbo-single-company-binding.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that UPR remembers one QuickBooks company after credentials are
 *   removed and replaces or refreshes that login as one protected operation.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  QuickBooks helpers/callback, migration, rollback, proof, qualifier
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Database behavior is separately executed by the isolated local qualifier.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260810182905_qbo_single_company_binding.sql');
const rollback = read('supabase/rollbacks/20260810182905_qbo_single_company_binding.rollback.sql');
const proof = read('supabase/tests/qbo_single_company_binding_isolated.sql');
const quickbooks = read('functions/lib/quickbooks.js');
const callback = read('functions/api/quickbooks-callback.js');
const mcpQbo = read('upr-mcp/src/qbo.js');
const mcpQboTest = read('upr-mcp/src/qbo.test.js');
const qualifier = read('scripts/qa/qualify-qbo-estimate-command-boundary-local.mjs');

describe('QBO durable single-company binding', () => {
  it('stores one forced-RLS realm/environment identity with no browser access', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.qbo_company_binding[\s\S]*singleton boolean PRIMARY KEY[\s\S]*environment text NOT NULL[\s\S]*realm_id text NOT NULL[\s\S]*generation bigint NOT NULL/);
    expect(migration).toMatch(/ALTER TABLE public\.qbo_company_binding ENABLE ROW LEVEL SECURITY;[\s\S]*FORCE ROW LEVEL SECURITY/);
    expect(migration).toContain('REVOKE ALL ON TABLE public.qbo_company_binding FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('GRANT SELECT ON TABLE public.qbo_company_binding TO service_role');
    expect(migration).not.toMatch(/GRANT[^;]*(?:anon|authenticated)[^;]*qbo_company_binding/i);
  });

  it('atomically binds tokens after exchange and advances reconnect generations', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.replace_qbo_connection\([\s\S]*auth\.role\(\) IS DISTINCT FROM 'service_role'/);
    expect(migration).toMatch(/UPDATE public\.qbo_company_binding[\s\S]*generation = v_generation[\s\S]*INSERT INTO public\.integration_credentials/);
    expect(migration).toMatch(/ON CONFLICT \(provider\) DO UPDATE SET[\s\S]*qbo_binding_generation = EXCLUDED\.qbo_binding_generation/);
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.replace_qbo_connection(text,text,text,text,timestamptz,text,uuid,timestamptz) TO service_role');
    const exchange = callback.indexOf('await exchangeCodeForTokens');
    const replace = callback.indexOf('await replaceQboConnection');
    expect(exchange).toBeGreaterThan(0);
    expect(replace).toBeGreaterThan(exchange);
    expect(callback).toMatch(/getQboCompanyBinding\(env\)[\s\S]*await exchangeCodeForTokens/);
    expect(callback).toContain("import { fetchWithTimeout } from '../lib/http.js'");
    expect(callback).toContain('supabase(env, fetchWithTimeout)');
  });

  it('refuses a credential realm that conflicts with authoritative persisted realm evidence', () => {
    const preflight = migration.indexOf('DO $realm_evidence_preflight$');
    const firstDdl = migration.indexOf('CREATE TABLE IF NOT EXISTS public.qbo_company_binding');
    expect(preflight).toBeGreaterThan(0);
    expect(preflight).toBeLessThan(firstDdl);
    for (const sentinel of [
      "('payments', 'qbo_realm_id')",
      "('payment_receipts', 'qbo_realm_id')",
      "('payment_receipt_attempts', 'qbo_realm_id')",
      "('qbo_payment_allocation_fences', 'qbo_realm_id')",
      "('qbo_invoice_commands', 'realm_id')",
      "('qbo_invoice_command_reservations', 'realm_id')",
      "('qbo_estimate_commands', 'realm_id')",
      "('qbo_estimate_command_reservations', 'realm_id')",
    ]) expect(migration).toContain(sentinel);
    expect(migration).toContain('QBO_COMPANY_BINDING_ARTIFACT_REALM_MISMATCH');
    expect(migration).toContain('QBO_COMPANY_BINDING_UNATTRIBUTED_REALM_EVIDENCE');
    expect(migration).toMatch(/IF v_expected_realm IS NULL THEN[\s\S]*v_expected_realm := v_evidence_realm/);
    expect(proof).toContain('consistent-but-unattributed realm evidence');
    expect(qualifier).toContain('20260810020000_qbo_invoice_command_reservation.sql');
    expect(qualifier).toContain('20260810030000_qbo_payment_allocation_lock_fence.sql');
    expect(qualifier).toContain('bindingUnboundArtifactSplitRefusal');
    expect(qualifier).toContain('binding migration did not refuse conflicting unbound artifact realms');
    expect(qualifier).toContain('unbound artifact preflight mutated authoritative evidence');
    expect(qualifier).toContain('bindingUnattributedArtifactRefusal');
    expect(qualifier).toContain('binding migration did not refuse unattributed realm evidence');
    expect(qualifier).toContain('unattributed realm preflight mutated command evidence');
    expect(qualifier).toContain('bindingSeedMismatchRefusal');
    expect(qualifier).toContain('failed realm preflight left a company binding');
    expect(qualifier).toContain('failed realm preflight mutated credential or command evidence');
  });

  it('uses generation CAS for refresh and lets reconnect win without a stale overwrite', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.refresh_qbo_connection_cas\([\s\S]*v_binding\.generation IS DISTINCT FROM p_expected_generation[\s\S]*v_connection\.qbo_binding_generation IS DISTINCT FROM p_expected_generation/);
    expect(migration).toMatch(/v_generation := p_expected_generation \+ 1;[\s\S]*UPDATE public\.qbo_company_binding[\s\S]*UPDATE public\.integration_credentials/);
    expect(quickbooks).toMatch(/conn\.qbo_binding_generation == null[\s\S]*refreshQboConnectionCas\(env, tokens, conn\)/);
    expect(quickbooks).toContain('p_expected_generation: expectedConnection.qbo_binding_generation');
  });

  it('routes the separately deployed owner MCP through the same CAS with bounded requests', () => {
    expect(mcpQbo).toContain("db.rpc('refresh_qbo_connection_cas'");
    expect(mcpQbo).toContain('p_expected_generation: expectedConnection.qbo_binding_generation');
    expect(mcpQbo).toMatch(/const QBO_TIMEOUT_MS = 15_000[\s\S]*AbortSignal\.timeout\(QBO_TIMEOUT_MS\)/);
    expect(mcpQbo).toContain('supabase(env, fetchWithTimeout)');
    expect(mcpQbo).not.toMatch(/\.upsert\(['"]integration_credentials['"]/);
    expect(mcpQboTest).toContain('does not issue an Accounting request when refresh CAS loses to a reconnect');
    expect(mcpQboTest).toContain('advances the current generation, reloads the winner, and bounds every fetch');
  });

  it('fences ordinary credential realm drift and recognizes every legacy QBO identity surface', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_quickbooks_company_binding\(\)[\s\S]*QBO_BINDING_REQUIRED[\s\S]*QBO_COMPANY_BINDING_MISMATCH/);
    expect(migration).toMatch(/qbo_connection_writer_generation[\s\S]*QBO_CONNECTION_WRITE_REQUIRES_CAS/);
    expect(migration).toMatch(/CREATE OR REPLACE TRIGGER trg_integration_credentials_qbo_company_binding[\s\S]*BEFORE INSERT OR UPDATE ON public\.integration_credentials/);
    for (const sentinel of [
      'qbo_customer_id', 'qbo_invoice_id', 'qbo_estimate_id', 'qbo_payment_id',
      'stripe_fee_qbo_purchase_id', 'qbo_attachable_id', 'qbo_item_id', 'qbo_class_id',
      'qbo_stripe_clearing_account_id', 'qbo_fee_expense_account_id', 'qbo_bank_account_id',
    ]) expect(migration).toContain(sentinel);
    expect(migration).toMatch(/v_has_artifacts[\s\S]*qbo_payment_allocation_fences[\s\S]*qbo_invoice_command_reservations[\s\S]*qbo_estimate_command_reservations/);
    expect(callback).toContain("['qbo_payment_allocation_fences', 'qbo_realm_id=not.is.null&select=attempt_id&limit=1', true]");
    expect(callback).toContain("['qbo_invoice_command_reservations', 'realm_id=not.is.null&select=invoice_id&limit=1', true]");
    expect(callback).toContain("['qbo_estimate_commands', 'realm_id=not.is.null&select=id&limit=1', true]");
    expect(callback).toMatch(/rollingOptional[\s\S]*exactMissingBoundary[\s\S]*continue/);
  });

  it('guards every durable realm-bearing command, receipt, fence, and projection write at storage', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_qbo_realm_binding\(\)[\s\S]*ordinary browser-created manual payments[\s\S]*QBO_REALM_WRITE_REQUIRES_SERVICE_ROLE[\s\S]*QBO_REALM_BINDING_REQUIRED[\s\S]*QBO_COMPANY_BINDING_MISMATCH/);
    for (const sentinel of [
      "('payments', 'qbo_realm_id', 'nullable', 'qbo_payment_id', 'stripe_fee_qbo_purchase_id')",
      "('payment_receipts', 'qbo_realm_id', 'required', '', '')",
      "('payment_receipt_attempts', 'qbo_realm_id', 'required', '', '')",
      "('payment_receipt_events', 'qbo_realm_id', 'nullable', 'qbo_payment_id', '')",
      "('qbo_payment_allocation_fences', 'qbo_realm_id', 'required', '', '')",
      "('qbo_invoice_commands', 'realm_id', 'required', '', '')",
      "('qbo_invoice_command_reservations', 'realm_id', 'required', '', '')",
      "('qbo_estimate_commands', 'realm_id', 'required', '', '')",
      "('qbo_estimate_command_reservations', 'realm_id', 'required', '', '')",
    ]) expect(migration).toContain(sentinel);
    expect(migration).toMatch(/v_new_identity IS NULL[\s\S]*v_old_identity IS NULL[\s\S]*v_new_secondary_identity IS NULL[\s\S]*v_old_secondary_identity IS NULL/);
    expect(migration).toContain("QBO_REALM_GUARD_REQUIRES_CREATE_OR_REPLACE_TRIGGER");
    expect(migration).toContain('CREATE OR REPLACE TRIGGER trg_qbo_realm_binding BEFORE INSERT OR UPDATE');
    expect(migration).not.toMatch(/DROP TRIGGER IF EXISTS trg_qbo_realm_binding/i);
    expect(migration).toContain('public.guard_qbo_realm_binding(%L, %L, %L, %L)');
    expect(migration).not.toMatch(/\('qbo_events', 'qbo_realm_id'/);
    expect(rollback).toContain('REVOKE EXECUTE ON FUNCTION public.guard_qbo_realm_binding()');
    for (const sentinel of [
      'realm B estimate reservation was accepted',
      'realm B estimate reservation persisted a row',
      'realm B invoice reservation was accepted',
      'realm B invoice reservation persisted a row',
      'realm B receipt reservation was accepted',
      'realm B receipt reservation persisted a row',
      'same-realm estimate reservation did not persist',
      'realm B receipt projection was accepted',
      'realm B receipt projection persisted a row',
      'QBO payment projection without realm was accepted',
      'QBO payment projection without realm persisted a row',
      'authenticated QBO-attributed payment was accepted',
      'authenticated QBO-attributed payment persisted a row',
      'authenticated QBO purchase insert was accepted',
      'authenticated QBO purchase insert persisted a row',
      'authenticated QBO purchase update was accepted',
      'authenticated QBO purchase update changed the manual payment',
    ]) expect(proof).toContain(sentinel);
    expect(proof).toContain('reserve_qbo_estimate_command');
    expect(proof).toContain('reserve_qbo_invoice_command');
    expect(proof).toContain('reserve_qbo_payment_receipt');
    expect(proof).toContain("SET LOCAL ROLE authenticated;");
    expect(proof).toContain("VALUES (v_job_id, 1, current_date, 'other');");
    expect(qualifier).toMatch(/psqlFile\(context, container, inside\(BINDING_PROOF\), true\);[\s\S]*seedBindingRollbackEvidence\(context, container\);[\s\S]*await runRaces\(context, container\);/);
  });

  it('keeps the safety record on rollback and exercises atomic failure, drift, deletion, and replay', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.replace_qbo_connection');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.refresh_qbo_connection_cas');
    expect(rollback).not.toContain('DROP TABLE');
    expect(rollback).not.toContain('DROP TRIGGER');
    expect(rollback).not.toContain('DROP COLUMN');
    for (const sentinel of [
      'failed first connection left a partial binding or credential',
      'unscoped QBO artifact did not block first connection',
      'same-company reconnect did not advance generation',
      'stale refresh was accepted',
      'refresh-vs-refresh CAS did not choose exactly one winner',
      'environment mismatch did not fail closed',
      'ordinary credential update changed QBO realm',
      'ordinary credential update bypassed generation CAS',
      'credential deletion lost durable QBO company binding',
    ]) expect(proof).toContain(sentinel);
    expect(qualifier).toContain('qbo_single_company_binding_isolated.sql');
  });
});
