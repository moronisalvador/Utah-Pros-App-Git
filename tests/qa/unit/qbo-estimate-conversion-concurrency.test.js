/**
 * Database-source contract for QBO estimate conversion concurrency.
 * This credential-free CI guard pins the safety design without contacting
 * Supabase or QuickBooks. Applying the companion migration is governed
 * separately and is never implied by this source test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '20260731180000_qbo_estimate_conversion_concurrency.sql'),
  'utf8',
);
const rollback = readFileSync(
  join(root, 'supabase', 'rollbacks', '20260731180000_qbo_estimate_conversion_concurrency.rollback.sql'),
  'utf8',
);

describe('QBO estimate conversion concurrency migration', () => {
  it('atomically reclaims only retryable QBO events and keeps the claim service-only', () => {
    expect(migration).toMatch(/INSERT INTO public\.qbo_events AS existing[\s\S]*ON CONFLICT \(id\) DO UPDATE/);
    expect(migration).toMatch(/WHERE existing\.status = 'retry'[\s\S]*RETURNING true INTO v_claimed/);
    expect(migration).toMatch(/status = 'processing',[\s\S]*error = NULL,[\s\S]*processed_at = NULL/);
    expect(migration).toMatch(/not_authorized: service role required[\s\S]*ERRCODE = '42501'/);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_qbo_event\(text, text, text\) FROM PUBLIC, anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_qbo_event\(text, text, text\) TO service_role;/,
    );
  });

  it('documents canonical combined billing without a false external-id uniqueness rule', () => {
    expect(migration).toMatch(/QBO Invoice Id is intentionally many-to-many/i);
    expect(migration).toMatch(/multiple invoices[\s\S]*for a job/i);
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it('preserves combined billing instead of asserting false global uniqueness', () => {
    expect(migration).not.toMatch(/qbo_invoice_commands/);
    expect(migration).toMatch(/combined.billing/i);
    expect(migration).toMatch(/no realm_id column/i);
  });

  it('locks the estimate before state reads and makes a successful retry a no-copy result', () => {
    const lock = migration.indexOf('FROM public.estimates\n  WHERE id = p_estimate_id\n  FOR UPDATE;');
    const converted = migration.indexOf('IF v_est.converted_invoice_id IS NOT NULL THEN');
    const copy = migration.indexOf('INSERT INTO public.invoice_line_items');
    expect(lock).toBeGreaterThan(-1);
    expect(converted).toBeGreaterThan(lock);
    expect(copy).toBeGreaterThan(converted);
    expect(migration).toMatch(/'lines_copied', 0,[\s\S]*'appended', false/);
  });

  it('serializes same-job draft creation with a job-row lock and retains executable roles', () => {
    expect(migration).toMatch(/FROM public\.jobs WHERE id = p_job_id FOR UPDATE/);
    for (const fn of ['create_invoice_for_job', 'convert_estimate_to_invoice']) {
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*FROM PUBLIC, anon`));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]*TO authenticated, service_role`));
    }
  });

  it('gates both SECURITY DEFINER money writers to service role or the shipped billing roles', () => {
    expect((migration.match(/NOT public\.is_active_internal_admin\(\)/g) || [])).toHaveLength(2);
    expect((migration.match(/e\.role::text = 'manager'/g) || [])).toHaveLength(2);
    expect((migration.match(/NOT COALESCE\(e\.is_external, false\)/g) || [])).toHaveLength(2);
    expect(migration).toMatch(/not_authorized: active internal billing editor required[\s\S]*ERRCODE = '42501'/);
  });

  it('provides the locked service-only QBO decision boundary with the worker JSON contract', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_qbo_estimate_decision\([\s\S]*RETURNS jsonb[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/);
    expect(migration).toMatch(/IF auth\.role\(\) <> 'service_role'[\s\S]*not_authorized: service role required/);
    const decisionLock = migration.indexOf('FROM public.estimates\n  WHERE id = p_estimate_id\n  FOR UPDATE;', migration.indexOf('apply_qbo_estimate_decision'));
    const actionCheck = migration.indexOf("v_action NOT IN ('accept', 'reject', 'convert', 'approve_only')");
    expect(decisionLock).toBeGreaterThan(actionCheck);
    expect(migration).toMatch(/v_action = 'accept'[\s\S]*NOT IN \('draft', 'submitted', 'under_review', 'revised'\)/);
    expect(migration).toMatch(/v_action = 'convert'[\s\S]*NOT IN \('draft', 'submitted', 'under_review', 'revised', 'approved'\)/);
    expect(migration).toMatch(/COALESCE\(approved_at, p_approved_at, now\(\)\)[\s\S]*COALESCE\(approved_amount, p_approved_amount, amount\)/);
    expect(migration).toMatch(/public\.convert_estimate_to_invoice\(v_est\.id, false, NULL\)/);
    expect(migration).toMatch(/'action', 'approved-and-converted'[\s\S]*'lines_copied'[\s\S]*'appended'/);
    expect(migration).toMatch(/'action', 'approved-needs-manual-convert'[\s\S]*'invoice_id'/);
    expect(migration).toMatch(/'action', 'denied'/);
    expect(migration).toMatch(/'skipped', 'already-converted'[\s\S]*'status'/);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.apply_qbo_estimate_decision\(uuid, text, timestamptz, numeric\) FROM PUBLIC, anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.apply_qbo_estimate_decision\(uuid, text, timestamptz, numeric\) TO service_role;/,
    );
  });

  it('provides a locked compare-and-swap invoice link without a combined-billing uniqueness constraint', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.cas_qbo_invoice_link\([\s\S]*RETURNS jsonb[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/);
    const casLock = migration.indexOf('FROM public.invoices\n  WHERE id = p_invoice_id\n  FOR UPDATE;', migration.indexOf('cas_qbo_invoice_link'));
    const compare = migration.indexOf('v_invoice.qbo_invoice_id IS DISTINCT FROM p_expected_qbo_invoice_id');
    expect(casLock).toBeGreaterThan(-1);
    expect(compare).toBeGreaterThan(casLock);
    expect(migration).toMatch(
      /qbo_invoice_id = p_new_qbo_invoice_id,[\s\S]*qbo_synced_at = CASE[\s\S]*qbo_doc_number = CASE[\s\S]*qbo_emailed_at = CASE[\s\S]*qbo_email_status = CASE[\s\S]*sent_to_email = CASE[\s\S]*qbo_sync_error = NULL/,
    );
    expect(migration).toMatch(/'reason', 'qbo-invoice-mismatch'[\s\S]*'current_qbo_invoice_id'/);
    expect(migration).not.toMatch(/'idempotent', true/);
    expect(migration).toMatch(/'ok', true, 'id', v_invoice\.id, 'job_id', v_invoice\.job_id,[\s\S]*'qbo_invoice_id', v_invoice\.qbo_invoice_id/);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cas_qbo_invoice_link\(uuid, text, text, text, timestamptz, text, text, boolean\) FROM PUBLIC, anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.cas_qbo_invoice_link\(uuid, text, text, text, timestamptz, text, text, boolean\) TO service_role;/,
    );
  });

  it('keeps invoice lifecycle status database-owned and clears send metadata on relink', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.derive_invoice_qbo_lifecycle_status\(\)[\s\S]*RETURNS trigger[\s\S]*SECURITY INVOKER[\s\S]*SET search_path = public/,
    );
    expect(migration).toMatch(/COALESCE\(NEW\.amount_paid, 0\) > 0[\s\S]*NEW\.status IN \('paid', 'partially_paid', 'voided', 'disputed', 'viewed', 'overdue'\)/);
    expect(migration).toMatch(/NEW\.qbo_invoice_id IS NULL[\s\S]*NEW\.status := 'draft'[\s\S]*NEW\.qbo_emailed_at IS NOT NULL[\s\S]*IS DISTINCT FROM OLD\.qbo_emailed_at[\s\S]*NEW\.status := 'sent'[\s\S]*OLD\.status = 'draft'[\s\S]*NEW\.status := 'saved'[\s\S]*NEW\.qbo_emailed_at IS NOT NULL[\s\S]*NEW\.status := 'sent'/);
    expect(migration).toMatch(
      /CREATE OR REPLACE TRIGGER trg_invoice_qbo_lifecycle_status[\s\S]*BEFORE UPDATE OF qbo_invoice_id, qbo_emailed_at ON public\.invoices[\s\S]*EXECUTE FUNCTION public\.derive_invoice_qbo_lifecycle_status\(\)/,
    );
    expect(migration).not.toMatch(/DROP TRIGGER/i);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.derive_invoice_qbo_lifecycle_status\(\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it('marks rollback emergency-only and faithfully restores the recorded legacy bodies and ACLs', () => {
    expect(rollback).toContain('SELECT * INTO v_est FROM public.estimates WHERE id = p_estimate_id;');
    expect(rollback).not.toContain('WHERE id = p_estimate_id\n  FOR UPDATE;');
    expect(rollback).not.toMatch(/qbo_invoice_commands/);
    expect(rollback).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(rollback).not.toMatch(/WHERE existing\.status = 'retry'/);
    expect(rollback).toMatch(/EMERGENCY \/ HIGH-RISK ONLY/);
    expect(rollback).toMatch(/reopens authenticated execution[\s\S]*without their internal caller checks/i);
    expect(rollback).not.toMatch(/NOT public\.is_active_internal_admin\(\)/);
    expect(rollback).not.toMatch(/not_authorized: service role required/);
    for (const [fn, signature] of [
      ['claim_qbo_event', 'text, text, text'],
      ['create_invoice_for_job', 'uuid, uuid'],
      ['convert_estimate_to_invoice', 'uuid, boolean, uuid'],
    ]) {
      expect(rollback).toMatch(new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(${signature.replaceAll(', ', ', ')}\\) FROM PUBLIC, anon;[\\s\\S]*GRANT EXECUTE ON FUNCTION public\\.${fn}\\(${signature.replaceAll(', ', ', ')}\\) TO authenticated, service_role;`,
      ));
    }
    expect(rollback).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_qbo_event\(text, text, text\) FROM PUBLIC, anon;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_qbo_event\(text, text, text\) TO authenticated, service_role;/,
    );
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.apply_qbo_estimate_decision\(uuid, text, timestamptz, numeric\);/);
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.cas_qbo_invoice_link\(uuid, text, text, text, timestamptz, text, text, boolean\);/);
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_invoice_qbo_lifecycle_status ON public\.invoices;/);
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.derive_invoice_qbo_lifecycle_status\(\);/);
  });
});
