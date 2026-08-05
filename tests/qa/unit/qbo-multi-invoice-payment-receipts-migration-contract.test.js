/**
 * ════════════════════════════════════════════════
 * FILE: qbo-multi-invoice-payment-receipts-migration-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the new payment-receipt database change without needing database
 *   credentials. The separate isolated database test proves the live behavior.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  the receipt migration, rollback, and isolated database test
 *   Data:      reads  → repository SQL files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These checks prove source contracts, not that the migration was applied.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260731045407_qbo_multi_invoice_payment_receipts.sql');
const rollback = read('supabase/rollbacks/20260731045407_qbo_multi_invoice_payment_receipts.rollback.sql');
const grantContainment = read('supabase/migrations/20260731231000_qbo_receipt_service_grant_containment.sql');
const grantContainmentRollback = read('supabase/rollbacks/20260731231000_qbo_receipt_service_grant_containment.rollback.sql');
const behavior = read('supabase/tests/qbo_multi_invoice_payment_receipts.test.sql');
const claimUtils = read('src/lib/claimUtils.js');
const executable = (sql) => sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n').replace(/\s+/g, ' ');
const functionBlock = (name) => {
  const match = migration.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$function\\$;`,
  ));
  expect(match, `${name} function source`).not.toBeNull();
  return match[0];
};

describe('QBO multi-invoice payment receipts migration contract', () => {
  it('is additive and retains the existing QBO per-invoice dedup contract', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.payment_receipts(id) ON DELETE RESTRICT');
    expect(migration).toContain('payments_receipt_invoice_uniq');
    expect(migration).not.toMatch(/\b(?:DROP|RENAME)\s+(?:TABLE|COLUMN|INDEX)\b/i);
    expect(migration).toContain('payments_qbo_payment_invoice_uniq');
    expect(migration).not.toMatch(/DROP INDEX[^;]*payments_qbo_payment_invoice_uniq/i);
  });

  it('closes broad payment access, scopes browser operations, and makes receipt linkage service-only', () => {
    const sql = executable(migration);
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.payments FROM anon;');
    for (const policy of [
      'allow_anon_select_payments',
      'allow_anon_insert_payments',
      'allow_anon_update_payments',
      'allow_anon_delete_payments',
    ]) {
      expect(migration).toContain(`DROP POLICY IF EXISTS ${policy} ON public.payments;`);
      expect(rollback).not.toContain(policy);
    }
    expect(migration).toContain('DROP POLICY IF EXISTS allow_authenticated_payments ON public.payments;');
    expect(migration).toContain('CREATE POLICY payments_internal_select ON public.payments');
    expect(migration).toContain('CREATE POLICY payments_billing_insert ON public.payments');
    expect(migration).toContain('CREATE POLICY payments_billing_update ON public.payments');
    expect(migration).toContain('CREATE POLICY payments_billing_delete ON public.payments');
    expect(migration).toContain('AND employee.is_active');
    expect(migration).toContain('AND NOT employee.is_external');
    expect(migration).toContain("employee.role::text = 'admin'");
    expect(migration).not.toContain("employee.role::text IN ('admin', 'office', 'project_manager')");
    expect(migration).toContain("AND COALESCE(source, 'manual') = 'manual'");
    expect(migration).toContain('AND employee.id = recorded_by');
    expect(rollback).not.toContain('allow_authenticated_payments');
    for (const policy of [
      'payments_internal_select',
      'payments_billing_insert',
      'payments_billing_update',
      'payments_billing_delete',
    ]) {
      expect(rollback).not.toContain(`DROP POLICY IF EXISTS ${policy}`);
    }
    expect(migration.indexOf('REVOKE ALL PRIVILEGES ON TABLE public.payments FROM anon;'))
      .toBeLessThan(migration.indexOf('ADD COLUMN IF NOT EXISTS receipt_id'));
    expect(migration.indexOf('DROP POLICY IF EXISTS allow_anon_delete_payments ON public.payments;'))
      .toBeLessThan(migration.indexOf('ADD COLUMN IF NOT EXISTS receipt_id'));
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.guard_payment_receipt_link_write()');
    expect(migration).toContain("TG_OP = 'INSERT' AND NEW.receipt_id IS NOT NULL");
    expect(migration).toContain("TG_OP = 'UPDATE' AND NEW.receipt_id IS DISTINCT FROM OLD.receipt_id");
    expect(migration).toContain("current_setting('request.jwt.claim.role', true), '') <> 'service_role'");
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.guard_payment_receipt_link_write() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.guard_payment_receipt_link_write() TO service_role;');
    expect(migration).toContain('CREATE TRIGGER guard_payment_receipt_link_insert');
    expect(migration).toContain('CREATE TRIGGER guard_payment_receipt_link_update');
    expect(rollback).not.toContain('DROP FUNCTION IF EXISTS public.guard_payment_receipt_link_write');
    expect(rollback).not.toContain('DROP TRIGGER IF EXISTS guard_payment_receipt_link');
  });

  it('keeps payment mutation RLS aligned with the effective billing UI role gate', () => {
    // THIS migration's own inline predicate is unchanged and still admin-only —
    // it is applied (production ledger 20260731225654) and must not be edited.
    expect(migration).toContain("employee.role::text = 'admin'");
    // The LIVE boundary moved on 2026-08-04: 20260804120000_billing_editor_role_boundary
    // supersedes these three policies with public.billing_edit_access(), which the
    // owner widened to office + project_manager. Alignment with the UI gate is
    // therefore asserted against the successor, not against this file.
    expect(claimUtils).toContain("export const BILLING_EDIT_ROLES = ['admin', 'office', 'project_manager']");
    const successor = read('supabase/migrations/20260804120000_billing_editor_role_boundary.sql');
    for (const policy of ['payments_billing_insert', 'payments_billing_update', 'payments_billing_delete']) {
      expect(successor).toContain(`DROP POLICY IF EXISTS ${policy} ON public.payments;`);
      expect(successor).toContain(`CREATE POLICY ${policy} ON public.payments`);
    }
    expect(successor).toContain("AND e.role::text IN ('admin', 'office', 'project_manager')");
  });

  it('creates private header, attempt, and audit tables with forced RLS and no browser grant', () => {
    for (const table of ['payment_receipts', 'payment_receipt_attempts', 'payment_receipt_events']) {
      expect(migration).toContain(`CREATE TABLE public.${table}`);
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
      expect(migration).not.toMatch(new RegExp(`GRANT\\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)[^;]*ON TABLE public\\.${table}[^;]*TO\\s+(?:anon|authenticated)`, 'i'));
    }
    expect(migration).toContain("'feature:qbo_receive_payment', false");
  });

  it('closes managed-default direct receipt writes while retaining service reads', () => {
    for (const table of ['payment_receipts', 'payment_receipt_attempts', 'payment_receipt_events']) {
      for (const source of [grantContainment, grantContainmentRollback]) {
        expect(source).toContain(
          `REVOKE ALL PRIVILEGES ON TABLE public.${table}\n`
            + '  FROM PUBLIC, anon, authenticated, service_role;',
        );
        expect(source).not.toMatch(new RegExp(
          `GRANT\\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^;]*public\\.${table}`,
          'i',
        ));
      }
    }
    for (const table of ['payment_receipts', 'payment_receipt_attempts']) {
      expect(grantContainment).toContain(`GRANT SELECT ON TABLE public.${table} TO service_role;`);
      expect(grantContainmentRollback).toContain(`GRANT SELECT ON TABLE public.${table} TO service_role;`);
    }
    expect(grantContainment).not.toContain('GRANT SELECT ON TABLE public.payment_receipt_events');
    expect(grantContainmentRollback).not.toContain('GRANT SELECT ON TABLE public.payment_receipt_events');
    expect(grantContainment).toContain("v_should_select := v_table <> 'payment_receipt_events'");
    expect(grantContainment).toContain("has_table_privilege('service_role', format('public.%I', v_table), 'INSERT')");
    expect(grantContainment).toContain('QBO receipt service-role grant containment failed');
    expect(grantContainment).toContain("key = 'feature:qbo_receive_payment'");
    expect(grantContainment).toContain('AND NOT enabled');
  });

  it('requires stable idempotency, cents, receipt/invoice uniqueness, and the receipt state vocabulary', () => {
    expect(migration).toContain('payment_receipt_attempts_client_request_uniq');
    expect(migration).toContain('payment_receipt_attempts_intuit_request_uniq');
    expect(executable(migration)).toContain(
      'CREATE UNIQUE INDEX payment_receipt_attempts_qbo_payment_uniq ON public.payment_receipt_attempts (qbo_realm_id, qbo_payment_id) WHERE qbo_payment_id IS NOT NULL;',
    );
    expect(migration).toContain('payment_receipts_qbo_payment_uniq');
    expect(migration).toContain('payment_receipts_actor_employee_idx');
    expect(migration).toContain('payment_receipt_attempts_actor_employee_idx');
    expect(migration).toContain('payment_receipt_events_attempt_idx');
    expect(migration).toContain('payment_receipts_cents_balance');
    expect(migration).toContain("'unknown_outcome', 'rejected', 'conflict', 'voided', 'deleted'");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS qbo_entity_id text');
    expect(migration).toContain('qbo_events_retry_due_idx');
    expect(migration).toContain('qbo_events_receipt_processing_idx');
    expect(migration).toContain("'conflict', 'voided', 'deleted'");
    expect((migration.match(/jsonb_array_length\(p_allocations\) > 100/g) || []).length).toBe(2);
    expect(migration).toContain("'ignored_stale', true");
    expect(migration).toContain("'upr_reconciliation_result', 'ignored_stale'");
  });

  it('serializes provider identity before row locks and prevents terminal state downgrades', () => {
    for (const name of [
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
    ]) {
      const source = functionBlock(name);
      expect(source.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1);
      expect(source.indexOf('FOR UPDATE')).toBeGreaterThan(-1);
      expect(source.indexOf('pg_advisory_xact_lock')).toBeLessThan(source.indexOf('FOR UPDATE'));
    }
    const fail = functionBlock('fail_qbo_payment_receipt_attempt');
    expect(fail).toContain("'conflict', 'locally_finalized', 'reconciled', 'voided', 'deleted'");
    expect(fail).toContain("'ignored_downgrade', true");
    const mark = functionBlock('mark_qbo_payment_receipt_created');
    expect(mark).toContain("'absorbed_tombstone', true");
    expect(mark).toContain("'ignored_terminal', true");
  });

  it('serializes same-customer projections before trigger-owned invoice and job rollups', () => {
    for (const name of [
      'finalize_qbo_payment_receipt',
      'reconcile_qbo_payment_receipt',
    ]) {
      const source = functionBlock(name);
      const customerLock = source.indexOf("'qbo-receipt-customer:'");
      expect(customerLock).toBeGreaterThan(-1);
      expect(customerLock).toBeLessThan(source.indexOf('FOR SHARE'));
      expect((source.match(/pg_advisory_xact_lock/g) || []).length).toBeGreaterThanOrEqual(2);
    }
    const remove = functionBlock('remove_qbo_payment_receipt');
    expect(remove.indexOf("'qbo-receipt-customer:'")).toBeGreaterThan(-1);
    expect(remove.indexOf("'qbo-receipt-customer:'")).toBeLessThan(
      remove.indexOf('DELETE FROM public.payments'),
    );
    expect(remove).toContain('UPDATE public.payment_receipt_attempts');
    expect(remove).toContain('status = v_effective_status');
  });

  it('locks every service RPC to the service JWT role and never grants browser execution', () => {
    const sql = executable(migration);
    const signatures = [
      'claim_qbo_receipt_event(text, text, text, text, text, timestamptz)',
      'reserve_qbo_payment_receipt(text, text, text, text, jsonb, uuid)',
      'mark_qbo_payment_receipt_created(uuid, text, jsonb)',
      'finalize_qbo_payment_receipt(uuid, jsonb, jsonb)',
      'reconcile_qbo_payment_receipt(jsonb, jsonb, text, text)',
      'remove_qbo_payment_receipt(text, text, text, text)',
      'fail_qbo_payment_receipt_attempt(uuid, text, text, text)',
    ];
    for (const signature of signatures) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect((migration.match(/current_setting\('request\.jwt\.claim\.role', true\).*service_role/g) || []).length).toBeGreaterThanOrEqual(8);
    expect((migration.match(/-- worker-only:/g) || []).length).toBeGreaterThanOrEqual(8);
  });

  it('uses payments projections instead of direct invoice/job rollup writes', () => {
    const sql = executable(migration);
    expect(sql).toContain('INSERT INTO public.payments');
    expect(sql).not.toMatch(/UPDATE\s+public\.(?:invoices|jobs)\s+SET/i);
    expect(sql).not.toMatch(/INSERT INTO public\.(?:invoices|jobs)/i);
  });

  it('ships isolated behavioral coverage and a containment-only rollback', () => {
    expect(behavior).toContain('same client request id returns the original attempt');
    expect(behavior).toContain('atomic receipt event claim retains all retry identity');
    expect(behavior).toContain('one QBO Payment identity cannot bind to two receipt attempts');
    expect(behavior).toContain('direct QBO reconcile has no outbound attempt prerequisite');
    expect(behavior).toContain('two allocation rows share one receipt');
    expect(behavior).toContain('webhook-first mark is a replay and cannot downgrade reconciled');
    expect(behavior).toContain('webhook-first finalize is a replay and cannot downgrade reconciled');
    expect(behavior).toContain('webhook-first generic failure is ignored after reconciliation');
    expect(behavior).toContain('webhook-first same-attempt state remains monotonic');
    expect(behavior).toContain('reconcile removes stale allocation projection');
    expect(behavior).toContain('receipt RPC rejects more than 100 allocations');
    expect(behavior).toContain('an older provider snapshot cannot roll back an allocation');
    expect(behavior).toContain('a browser-role claim cannot directly change a payment receipt link');
    expect(behavior).toContain('the rejected browser receipt-link write leaves the projection intact');
    expect(behavior).toContain('preserves an outbound UPR receipt source and human-selected payer');
    expect(behavior).toContain('an unsupported QBO update removes stale active projections');
    expect(behavior).toContain('a QBO conflict propagates to the original durable attempt');
    expect(behavior).toContain('a corrected QBO receipt restores its active projection');
    expect(behavior).toContain('a QBO delete propagates to the original durable attempt');
    expect(behavior).toContain('a same-request retry returns the durable deleted state');
    expect(behavior).toContain('a delete before finalization terminates the provider-matched attempt');
    expect(behavior).toContain('a pre-finalization terminal attempt returns its deleted state on retry');
    expect(behavior).toContain('a provider tombstone before binding is absorbed by the mark attempt');
    expect(behavior).toContain('a pre-binding tombstone durably binds the attempt to its terminal state');
    expect(behavior).toContain('a tombstone-before-bind same-request retry remains terminal');
    expect(behavior).toContain('a terminal tombstone refuses a delayed create reconciliation');
    expect(behavior).toContain('void removes payment projections but retains receipt audit');
    expect(rollback).toContain("WHERE key = 'feature:qbo_receive_payment'");
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.claim_qbo_receipt_event');
    expect(rollback).not.toMatch(/DROP TABLE|DROP COLUMN|DELETE FROM public\.payment_receipt/i);
  });
});
