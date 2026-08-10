/**
 * Credential-free contract for the QBO grouped-payment invoice-lock fence.
 * Repository evidence only; the disposable local-db proof exercises the same
 * reservation/manual-lock race before any shared-database apply is considered.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260810030000_qbo_payment_allocation_lock_fence.sql');
const rollback = read('supabase/rollbacks/20260810030000_qbo_payment_allocation_lock_fence.rollback.sql');
const predecessor = read('supabase/migrations/20260808070000_payments_qbo_realm_scoping.sql');
const localQualifier = read('scripts/qa/qualify-qbo-payment-allocation-lock-fence-local.mjs');
const receivePayment = read('functions/api/qbo-receive-payment.js');
const paymentSync = read('functions/lib/qbo-payment-sync.js');
const functionBody = (source, signature) => {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${signature}`);
  const end = source.indexOf('$function$;', start);
  return source.slice(start, end + '$function$;'.length);
};
const orderedLock = [
  '  -- Lock every real allocation invoice in UUID order before any projection.',
  '  PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);',
  '',
  '',
].join('\n');

describe('QBO payment allocation lock fence', () => {
  it('creates a forced-RLS service-only durable allocation fence with no expiry', () => {
    expect(migration).toMatch(/CREATE TABLE public\.qbo_payment_allocation_fences[\s\S]*attempt_id uuid[\s\S]*invoice_id uuid[\s\S]*PRIMARY KEY \(attempt_id, invoice_id\)[\s\S]*UNIQUE \(invoice_id\)/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY;[\s\S]*FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/CREATE POLICY qbo_payment_allocation_fences_service_only[\s\S]*FOR ALL TO service_role/);
    expect(migration).toContain('REVOKE ALL ON TABLE public.qbo_payment_allocation_fences FROM PUBLIC, anon, authenticated;');
    const table = migration.match(/CREATE TABLE public\.qbo_payment_allocation_fences \([\s\S]*?\n\);/)?.[0] || '';
    expect(table).not.toMatch(/expires_at|lease|ttl/i);
  });

  it('serializes manual locking with deterministic invoice locks and protects legacy active attempts', () => {
    const establish = migration.slice(
      migration.indexOf('FUNCTION public.establish_qbo_payment_allocation_fences'),
      migration.indexOf('FUNCTION public.guard_invoice_lock_during_qbo_payment'),
    );
    expect(establish).toMatch(/ORDER BY i\.id[\s\S]*FOR UPDATE OF i/);
    expect(establish).toMatch(/v_row\.locked IS TRUE[\s\S]*'INVOICE_LOCKED'/);
    expect(establish).toMatch(/a\.status IN \('submitting', 'qbo_created', 'unknown_outcome'\)/);
    expect(establish).toMatch(/'PAYMENT_ALLOCATION_BUSY'/);
    const guard = migration.slice(
      migration.indexOf('FUNCTION public.guard_invoice_lock_during_qbo_payment'),
      migration.indexOf('FUNCTION public.guard_payment_receipt_invoice_unlocked'),
    );
    expect(guard).toMatch(/NEW\.locked IS TRUE AND OLD\.locked IS FALSE/);
    expect(guard).toMatch(/qbo_payment_allocation_fences f[\s\S]*f\.invoice_id = NEW\.id/);
    expect(guard).toMatch(/payment_receipt_attempts a[\s\S]*jsonb_array_elements[\s\S]*'unknown_outcome'/);
  });

  it('keeps uncertain provider outcomes fenced and releases only known terminal states', () => {
    const release = migration.slice(
      migration.indexOf('FUNCTION public.release_qbo_payment_allocation_fences'),
      migration.indexOf('DO $trigger_preflight$'),
    );
    expect(release).toMatch(/NEW\.status IN \('rejected', 'conflict', 'locally_finalized', 'reconciled', 'voided', 'deleted'\)/);
    expect(release).toContain('DELETE FROM public.qbo_payment_allocation_fences WHERE attempt_id = NEW.id;');
    expect(release).not.toMatch(/unknown_outcome[\s\S]{0,120}DELETE FROM public\.qbo_payment_allocation_fences/);
  });

  it('makes receipt projection writes take the same invoice lock and refuse a winning manual lock', () => {
    const guard = migration.slice(
      migration.indexOf('FUNCTION public.guard_payment_receipt_invoice_unlocked'),
      migration.indexOf('FUNCTION public.release_qbo_payment_allocation_fences'),
    );
    expect(guard).toMatch(/WHERE i\.id = NEW\.invoice_id[\s\S]*FOR UPDATE/);
    expect(guard).toMatch(/v_locked IS TRUE[\s\S]*INVOICE_LOCKED_DURING_PAYMENT_FINALIZATION/);
    expect(migration).toContain('CREATE TRIGGER trg_payments_guard_qbo_payment_allocation_unlocked');
  });

  it('contains explicit, predecessor-derived finalizer bodies with an upfront deterministic FOR UPDATE set lock', () => {
    expect(migration).toMatch(/FUNCTION public\.lock_qbo_payment_allocation_invoices\(\s*p_allocations jsonb[\s\S]*ORDER BY i\.id[\s\S]*FOR UPDATE OF i/);
    const finalize = migration.slice(
      migration.indexOf('FUNCTION public.finalize_qbo_payment_receipt'),
      migration.indexOf('FUNCTION public.reconcile_qbo_payment_receipt'),
    );
    const reconcile = migration.slice(
      migration.indexOf('FUNCTION public.reconcile_qbo_payment_receipt'),
      migration.indexOf('FUNCTION public.guard_payment_receipt_invoice_unlocked'),
    );
    expect(finalize).toContain('PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);');
    expect(reconcile).toContain('PERFORM public.lock_qbo_payment_allocation_invoices(p_allocations);');
    expect(migration).toContain('FOR UPDATE OF i;');
    expect(migration).not.toContain('pg_get_functiondef');
    expect(rollback).not.toContain('pg_get_functiondef');
    expect(rollback).toContain('CREATE OR REPLACE FUNCTION public.finalize_qbo_payment_receipt');
    expect(rollback).toContain('CREATE OR REPLACE FUNCTION public.reconcile_qbo_payment_receipt');
    expect(rollback).toContain('GRANT EXECUTE ON FUNCTION public.finalize_qbo_payment_receipt(uuid, jsonb, jsonb) TO service_role;');

    for (const signature of [
      'finalize_qbo_payment_receipt(',
      'reconcile_qbo_payment_receipt(',
    ]) {
      const previous = functionBody(predecessor, signature);
      expect(functionBody(migration, signature)).toBe(previous.replace(
        '  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP',
        `${orderedLock}  FOR v_item IN SELECT value FROM jsonb_array_elements(p_allocations) LOOP`,
      ));
      expect(functionBody(rollback, signature)).toBe(previous);
    }
  });

  it('uses collision-refusing unique trigger names and denies direct execution of trigger-only helpers', () => {
    expect(migration).not.toMatch(/DROP TRIGGER IF EXISTS/);
    expect(migration).toContain('trg_invoices_guard_qbo_payment_allocation_lock');
    expect(migration).toContain('trg_payments_guard_qbo_payment_allocation_unlocked');
    expect(migration).toContain('trg_payment_receipt_attempts_release_qbo_payment_fences');
    for (const signature of [
      'lock_qbo_payment_allocation_invoices(jsonb)',
      'guard_invoice_lock_during_qbo_payment()',
      'guard_payment_receipt_invoice_unlocked()',
      'release_qbo_payment_allocation_fences()',
    ]) expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`);
    for (const signature of [
      'finalize_qbo_payment_receipt(uuid, jsonb, jsonb)',
      'reconcile_qbo_payment_receipt(jsonb, jsonb, text, text)',
    ]) {
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
  });

  it('stops a direct authenticated POST before receipt reservation/provider work and makes reconciliation explicit', () => {
    expect(receivePayment).toMatch(/async function requireUnlockedLocalAllocations[\s\S]*invoice\.locked === true[\s\S]*423/);
    const post = receivePayment.slice(receivePayment.indexOf('export async function onRequestPost'));
    expect(post.indexOf('await requireUnlockedLocalAllocations(db, input);'))
      .toBeLessThan(post.indexOf("db.rpc('reserve_qbo_payment_receipt'"));
    expect(post.indexOf('await requireUnlockedLocalAllocations(db, input);'))
      .toBeLessThan(post.indexOf('await getConnection(env)'));
    expect(paymentSync).toContain("includes('INVOICE_LOCKED_DURING_PAYMENT_FINALIZATION')");
    expect(paymentSync).toContain("skipped: 'locked-invoice-reconciliation'");
  });

  it('has a rollback that refuses every active attempt, including unfenced legacy work', () => {
    expect(rollback).toMatch(/payment_receipt_attempts[\s\S]*status IN \('submitting', 'qbo_created', 'unknown_outcome'\)/);
    expect(rollback).toContain('nonterminal payment attempt remains');
    expect(rollback).toContain('CREATE OR REPLACE FUNCTION public.reserve_qbo_payment_receipt');
    expect(rollback).toContain('DROP TABLE public.qbo_payment_allocation_fences');
    expect(rollback.indexOf('DROP TABLE public.qbo_payment_allocation_fences'))
      .toBeGreaterThan(rollback.indexOf('CREATE OR REPLACE FUNCTION public.reserve_qbo_payment_receipt'));
  });

  it('uses telemetry-disabled established CLI state so pgsodium starts correctly', () => {
    expect(localQualifier).toContain("SUPABASE_TELEMETRY_DISABLED: '1'");
    expect(localQualifier).not.toContain('SUPABASE_HOME:');
    expect(localQualifier).toContain("path.join(os.homedir(), '.cache', 'upr-qbo-payment-allocation-lock-fence-local')");
    expect(localQualifier).toContain("fs.mkdtempSync(path.join(CACHE, 'cycle-'))");
    expect(localQualifier).toContain("'-U', 'supabase_admin', '-d', 'postgres', '-c', 'GRANT supabase_admin TO postgres;'");
  });
});
