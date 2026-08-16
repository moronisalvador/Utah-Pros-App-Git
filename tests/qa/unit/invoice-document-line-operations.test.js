/**
 * ════════════════════════════════════════════════
 * FILE: invoice-document-line-operations.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the invoice line-item safety rules remain present in the
 *   database change, its undo file, and its isolated proof. It protects the
 *   rule that saved invoice lines change only after QuickBooks succeeds.
 *
 * DEPENDS ON:
 *   Packages:  node:fs/promises, vitest
 *   Internal:  invoice document-line migration, rollback, isolated proof, and local qualifier
 *   Data:      reads  → repository SQL and qualifier files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source-level guard; the isolated qualifier provides behavioral database proof.
 * ════════════════════════════════════════════════
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../../supabase/migrations/20260810182847_invoice_document_line_operations.sql', import.meta.url);
const rollbackPath = new URL('../../../supabase/rollbacks/20260810182847_invoice_document_line_operations.rollback.sql', import.meta.url);
const proofPath = new URL('../../../supabase/tests/invoice_document_line_operations_isolated.sql', import.meta.url);
const qualifierPath = new URL('../../../scripts/qa/qualify-qbo-invoice-command-reservation-local.mjs', import.meta.url);

describe('invoice document line operation boundary', () => {
  it('keeps every create/update/delete/reorder mutation service-only and post-provider', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    expect(migration).toContain('FUNCTION public.stage_qbo_invoice_line_change');
    expect(migration).toContain('FUNCTION public.finalize_qbo_invoice_line_change');
    expect(migration).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
    expect(migration).toMatch(/v_command\.status IS DISTINCT FROM 'provider_succeeded'/);
    expect(migration).toContain("v_kind NOT IN ('create','update','delete','reorder')");
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.stage_qbo_invoice_line_change');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.stage_qbo_invoice_line_change(uuid,uuid,uuid,uuid,text,text,jsonb) TO service_role;');
    expect(migration).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(migration).toContain("v_current_order IS NOT DISTINCT FROM v_frozen->'ordered_line_ids'");
  });

  it('has a paired rollback that removes only the additive generic RPC lane', async () => {
    const rollback = await readFile(rollbackPath, 'utf8');
    expect(rollback).toContain('INVOICE_DOCUMENT_LINE_ROLLBACK_ORDER');
    expect(rollback).toContain('INVOICE_DOCUMENT_LINE_ROLLBACK_RESERVATIONS_ACTIVE');
    expect(rollback).toContain('INVOICE_DOCUMENT_LINE_ROLLBACK_LINE_CHANGE_ACTIVE');
    expect(rollback).toContain("c.status IN ('prepared','provider_started','ambiguous','provider_succeeded','needs_reconciliation')");
    expect(rollback).toContain("jsonb_typeof(c.intent_payload->'line_change') = 'object'");
    expect(rollback.indexOf('INVOICE_DOCUMENT_LINE_ROLLBACK_LINE_CHANGE_ACTIVE')).toBeLessThan(rollback.indexOf('DROP FUNCTION IF EXISTS public.stage_qbo_invoice_line_change'));
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.stage_qbo_invoice_line_change');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.finalize_qbo_invoice_line_change');
    expect(rollback).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(rollback).not.toContain("auth.role() <> 'service_role'");
    expect(rollback).toContain('v_created_by := p_created_by');
    expect(rollback).toContain('e.auth_user_id=auth.uid()');
  });

  it('ships an isolated behavioral proof for provider barriers, replay, source mismatch, and claimless denial', async () => {
    const proof = await readFile(proofPath, 'utf8');
    expect(proof).toContain('upr.isolated_test_database');
    expect(proof).toContain('claimless service role bypassed guard');
    expect(proof).toContain('"kind":"create"');
    expect(proof).toContain('"kind":"update"');
    expect(proof).toContain('"kind":"delete"');
    expect(proof).toContain('"kind":"reorder"');
    expect(proof).toContain('provider_succeeded');
    expect(proof).toContain('third update state was overwritten');
    expect(proof).toContain('authenticated caller spoofed invoice created_by');
    expect(proof).toContain('invalid sort order stranded reservation');
  });

  it('executes rollback refusals in the isolated qualifier before cleanup and reapply', async () => {
    const qualifier = await readFile(qualifierPath, 'utf8');
    expect(qualifier).toContain('documentRollbackRefusalProof');
    expect(qualifier).toContain("const activeStates = ['prepared', 'provider_started', 'ambiguous', 'provider_succeeded', 'needs_reconciliation'];");
    expect(qualifier).toContain('INVOICE_DOCUMENT_LINE_ROLLBACK_RESERVATIONS_ACTIVE');
    expect(qualifier).toContain('INVOICE_DOCUMENT_LINE_ROLLBACK_LINE_CHANGE_ACTIVE');
    expect(qualifier.indexOf('await documentRollbackRefusalProof(context,container);')).toBeLessThan(qualifier.indexOf('psqlFile(context,container,inside(DOCUMENT_ROLLBACK));'));
    expect(qualifier).toContain("const network = `supabase_network_${project}`;");
    expect(qualifier).toContain("if (attachments === '0') docker(context, ['network', 'rm', network]");
  });
});
