/**
 * Credential-free source contract for the private QBO invoice command ledger.
 * The hosted companion proves behavior against qa-staging; this guard keeps
 * migration sequencing, ACLs, retry semantics, and rollback visible in CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const estimateMigration = readFileSync(
  join(root, 'supabase', 'migrations', '20260731180000_qbo_estimate_conversion_concurrency.sql'),
  'utf8',
);
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260731210000_qbo_invoice_command_ledger.sql'),
  'utf8',
);
const rollback = readFileSync(
  join(root, 'supabase', 'rollbacks', '20260731210000_qbo_invoice_command_ledger.rollback.sql'),
  'utf8',
);

describe('QBO invoice command ledger migration', () => {
  it('is sequenced after the estimate migration and keeps ledger scope out of migration 1', () => {
    expect(migration).toMatch(/APPLY ORDER: after 20260731180000_qbo_estimate_conversion_concurrency/);
    expect(estimateMigration).not.toMatch(/qbo_invoice_commands/);
    expect(estimateMigration).toMatch(/CREATE OR REPLACE TRIGGER trg_invoice_qbo_lifecycle_status/);
    expect(estimateMigration).not.toMatch(/DROP TRIGGER/i);
    expect(estimateMigration).not.toMatch(/'idempotent', true/);
  });

  it('creates a forced-RLS ledger denied to browser roles and serialized only by active invoice command', () => {
    expect(migration).toMatch(/CREATE TABLE public\.qbo_invoice_commands/);
    expect(migration).not.toMatch(/ON DELETE SET NULL/);
    expect(migration).toMatch(/ALTER TABLE public\.qbo_invoice_commands ENABLE ROW LEVEL SECURITY;[\s\S]*ALTER TABLE public\.qbo_invoice_commands FORCE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.qbo_invoice_commands FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/CREATE POLICY qbo_invoice_commands_service_role_only[\s\S]*FOR ALL TO service_role/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX qbo_invoice_commands_one_active_per_invoice[\s\S]*WHERE status IN \([\s\S]*'prepared'[\s\S]*'needs_reconciliation'/);
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX[^\n]*qbo_invoice_id/i);
  });

  it('freezes exact identity and intent on same-key replay and bounded active-command resume', () => {
    expect(migration).toMatch(/initiator = 'browser' AND actor_auth_user_id IS NOT NULL/);
    expect(migration).toMatch(/initiator = 'webhook'[\s\S]*actor_auth_user_id IS NULL[\s\S]*actor_employee_id IS NULL/);
    expect(migration).toMatch(/p_initiator = 'browser' AND p_actor_auth_user_id IS NULL/);
    expect(migration).toMatch(/p_initiator = 'webhook'[\s\S]*p_actor_auth_user_id IS NOT NULL OR p_actor_employee_id IS NOT NULL/);
    expect(migration).toMatch(/actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id[\s\S]*actor_employee_id IS DISTINCT FROM p_actor_employee_id/);
    expect(migration).toMatch(/intent_hash IS DISTINCT FROM p_intent_hash[\s\S]*intent_payload IS DISTINCT FROM p_intent_payload/);
    expect(migration).toMatch(/'reason', 'idempotency-key-mismatch'/);
    expect(migration).toMatch(/'resumed', true[\s\S]*'command_id', v_active\.id/);
    expect(migration).toMatch(/'reason', 'active-command-conflict'/);
  });

  it('allows provider-succeeded recovery both before and after CAS but rejects a third link', () => {
    expect(migration).toMatch(/v_active\.provider_result \? 'local_target_qbo_invoice_id'/);
    expect(migration).toMatch(/qbo_invoice_id IS DISTINCT FROM v_active\.expected_qbo_invoice_id[\s\S]*qbo_invoice_id IS DISTINCT FROM v_local_target/);
    expect(migration).toMatch(/'reason', 'provider-result-link-mismatch'/);
  });

  it('pins immutable provider-attempt start/advance contracts and nullable create targets', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.start_qbo_invoice_command_attempt\([\s\S]*IF v_command\.status <> 'prepared'/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.advance_qbo_invoice_command_attempt\([\s\S]*v_command\.status <> 'provider_started'[\s\S]*provider_stage IS DISTINCT FROM p_expected_provider_stage/);
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.advance_qbo_invoice_command_attempt\(\s*p_command_id uuid,\s*p_expected_provider_stage text,\s*p_provider_stage text,\s*p_provider_action text,\s*p_provider_target_id text,\s*p_provider_request_id text,\s*p_provider_payload jsonb,\s*p_provider_payload_hash text\s*\)/,
    );
    expect((migration.match(/p_provider_target_id IS NULL AND p_provider_action <> 'create'/g) || [])).toHaveLength(2);
    expect(migration).toMatch(/'reason', 'attempt-mismatch'/);
  });

  it('enforces legal state changes, provider result persistence, and provider-free delete completion', () => {
    expect(migration).toMatch(/v_command\.status = 'prepared' AND p_status IN \('succeeded', 'rejected'\)/);
    expect(migration).toMatch(/v_command\.status = 'provider_started'[\s\S]*p_status IN \('ambiguous', 'provider_succeeded', 'rejected'\)/);
    expect(migration).toMatch(/provider_result = COALESCE\(p_provider_result, provider_result\)/);
    expect(migration).toMatch(/v_command\.status = 'prepared'[\s\S]*p_status = 'succeeded'[\s\S]*p_response_status IS NULL OR p_response_payload IS NULL[\s\S]*'terminal-response-required'/);
  });

  it('keeps all ledger RPCs service-only with signatures used by the worker helper', () => {
    for (const fn of [
      'prepare_qbo_invoice_command',
      'start_qbo_invoice_command_attempt',
      'advance_qbo_invoice_command_attempt',
      'set_qbo_invoice_command_state',
      'get_qbo_invoice_command',
    ]) {
      expect(migration).toMatch(new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*FROM PUBLIC, anon, authenticated;[\\s\\S]*GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*TO service_role;`,
      ));
    }
  });

  it('adds idempotent already-applied CAS and rollback restores migration 1 CAS only', () => {
    expect(migration).toMatch(/qbo_invoice_id IS NOT DISTINCT FROM p_new_qbo_invoice_id[\s\S]*'idempotent', true/);
    expect(rollback).toMatch(/HIGH-RISK DATA LOSS/);
    expect(rollback).toMatch(/DROP TABLE IF EXISTS public\.qbo_invoice_commands/);
    expect(rollback).not.toMatch(/(?:CREATE OR REPLACE|DROP) FUNCTION public\.(?:convert_estimate|apply_qbo_estimate|derive_invoice)/);
    expect(rollback).not.toMatch(/(?:CREATE|DROP) (?:OR REPLACE )?TRIGGER/i);
    expect(rollback).toMatch(/qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id[\s\S]*'qbo-invoice-mismatch'/);
    expect(rollback).not.toMatch(/'idempotent', true/);
    const casPattern = /CREATE OR REPLACE FUNCTION public\.cas_qbo_invoice_link\([\s\S]*?END;\r?\n\$\$;/;
    expect(rollback.match(casPattern)?.[0]).toBe(
      estimateMigration.match(casPattern)?.[0],
    );
  });
});
