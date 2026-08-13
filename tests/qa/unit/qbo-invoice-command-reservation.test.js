/**
 * Credential-free contract for the QBO invoice reservation/lock boundary.
 * Repository evidence only; behavior is additionally qualified on local DB.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260810020000_qbo_invoice_command_reservation.sql');
const rollback = read('supabase/rollbacks/20260810020000_qbo_invoice_command_reservation.rollback.sql');
const worker = read('functions/api/qbo-invoice.js');
const localQualifier = read('scripts/qa/qualify-qbo-invoice-command-reservation-local.mjs');

describe('QBO invoice command reservation', () => {
  it('keeps every service-only rollback guard NULL-safe regardless of spacing', () => {
    expect(rollback).not.toMatch(/auth\.role\(\)\s*<>\s*'service_role'/);
    expect(rollback).toContain("auth.role() IS DISTINCT FROM 'service_role'");
  });

  it('creates a forced-RLS service-only, no-TTL reservation keyed to the invoice', () => {
    expect(migration).toMatch(/CREATE TABLE public\.qbo_invoice_command_reservations[\s\S]*invoice_id uuid PRIMARY KEY[\s\S]*command_id uuid NOT NULL UNIQUE[\s\S]*actor_auth_user_id uuid[\s\S]*initiator text NOT NULL[\s\S]*realm_id text NOT NULL/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY;[\s\S]*FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.qbo_invoice_command_reservations FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/CREATE POLICY qbo_invoice_command_reservations_service_role_only[\s\S]*FOR ALL TO service_role/);
    expect(migration).toMatch(/FUNCTION public\.invoice_line_qbo_write_access\(p_invoice_id uuid\)[\s\S]*SECURITY DEFINER[\s\S]*auth\.role\(\) = 'authenticated'[\s\S]*NOT EXISTS \([\s\S]*qbo_invoice_command_reservations/);
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.invoice_line_qbo_write_access(uuid) TO authenticated;');
    const table = migration.match(/CREATE TABLE public\.qbo_invoice_command_reservations \([\s\S]*?\n\);/)?.[0] || '';
    expect(table).not.toMatch(/expires_at|lease|ttl/i);
  });

  it('serializes false-to-true manual lock with both new reservations and legacy active commands', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.guard_invoice_lock_during_qbo_command\(\)[\s\S]*NEW\.locked IS TRUE AND OLD\.locked IS FALSE/);
    expect(migration).toMatch(/qbo_invoice_command_reservations r[\s\S]*r\.invoice_id = NEW\.id/);
    expect(migration).toMatch(/qbo_invoice_commands c[\s\S]*'prepared'[\s\S]*'provider_started'[\s\S]*'ambiguous'[\s\S]*'provider_succeeded'[\s\S]*'needs_reconciliation'/);
    expect(migration).toContain('CREATE TRIGGER trg_invoices_guard_qbo_command_lock');
    const reserve = migration.slice(
      migration.indexOf('FUNCTION public.reserve_qbo_invoice_command'),
      migration.indexOf('FUNCTION public.release_qbo_invoice_command_reservation'),
    );
    expect(reserve).toMatch(/FROM public\.qbo_invoice_commands[\s\S]*status IN \('prepared', 'provider_started', 'ambiguous', 'provider_succeeded', 'needs_reconciliation'\)/);
    expect(reserve).toMatch(/v_active\.id IS DISTINCT FROM p_command_id[\s\S]*'active-command-conflict'/);
  });

  it('rechecks browser line writes after the line lock with a fresh parent-serialized snapshot', () => {
    const guard = migration.slice(
      migration.indexOf('FUNCTION public.guard_invoice_line_write_during_qbo_command'),
      migration.indexOf('FUNCTION public.guard_invoice_lock_during_qbo_command'),
    );
    expect(guard).toMatch(/RETURNS trigger[\s\S]*VOLATILE[\s\S]*SECURITY DEFINER/);
    expect(guard).toContain("auth.role() IS DISTINCT FROM 'authenticated'");
    expect(guard).toMatch(/FROM public\.invoices i[\s\S]*FOR UPDATE[\s\S]*qbo_invoice_command_reservations[\s\S]*qbo_invoice_commands/);
    expect(guard).toMatch(/'prepared'[\s\S]*'provider_started'[\s\S]*'ambiguous'[\s\S]*'provider_succeeded'[\s\S]*'needs_reconciliation'/);
    expect(migration).toContain('CREATE TRIGGER trg_invoice_lines_guard_qbo_command_write');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_line_items');
    expect(localQualifier).toContain('browser-update-before-reserve session');
    expect(localQualifier).toContain('reserve-during-browser-update session');
    expect(localQualifier).toMatch(/aaa_upr_qbo_browser_reserve_pause[\s\S]*UPDATE public\.invoice_line_items[\s\S]*reserve_qbo_invoice_command[\s\S]*INVOICE_QBO_COMMAND_ACTIVE/);
  });

  it('keeps rollout-compatible prepare fenced, requires ownership for attempts, and releases only terminal states', () => {
    for (const fn of ['start_qbo_invoice_command_attempt', 'advance_qbo_invoice_command_attempt']) {
      const body = migration.slice(migration.indexOf(`FUNCTION public.${fn}`));
      expect(body).toMatch(/'reason'\s*,\s*'reservation-mismatch'/);
    }
    const prepareBody = migration.slice(
      migration.indexOf('FUNCTION public.prepare_qbo_invoice_command'),
      migration.indexOf('FUNCTION public.start_qbo_invoice_command_attempt'),
    );
    expect(prepareBody).toMatch(/Rolling-deploy compatibility:[\s\S]*IF NOT FOUND THEN[\s\S]*INSERT INTO public\.qbo_invoice_command_reservations/);
    expect(prepareBody).toMatch(/IF NOT v_command_found THEN[\s\S]*active-command-conflict/);
    expect(prepareBody).toMatch(/v_invoice\.locked IS TRUE[\s\S]*'invoice-locked'/);
    expect(prepareBody).toMatch(/ELSIF v_reservation\.command_id IS DISTINCT FROM p_command_id[\s\S]*reservation-mismatch/);
    const setState = migration.slice(migration.indexOf('FUNCTION public.set_qbo_invoice_command_state'));
    expect(setState).toMatch(/IF p_status IN \('succeeded','rejected'\) THEN[\s\S]*DELETE FROM public\.qbo_invoice_command_reservations/);
    expect(setState).not.toMatch(/ambiguous[\s\S]{0,130}DELETE FROM public\.qbo_invoice_command_reservations/);
    const release = migration.slice(
      migration.indexOf('FUNCTION public.release_qbo_invoice_command_reservation'),
      migration.indexOf('FUNCTION public.guard_invoice_lock_during_qbo_command'),
    );
    expect(release).toMatch(/v_command\.status NOT IN \('succeeded', 'rejected'\)[\s\S]*'command-not-terminal'/);
    expect(release).toMatch(/IF v_command_found THEN[\s\S]*v_command\.invoice_id IS DISTINCT FROM p_invoice_id/);
    expect(release.indexOf('FROM public.qbo_invoice_commands'))
      .toBeLessThan(release.indexOf('FROM public.qbo_invoice_command_reservations'));
    const prepare = migration.slice(
      migration.indexOf('FUNCTION public.prepare_qbo_invoice_command'),
      migration.indexOf('FUNCTION public.start_qbo_invoice_command_attempt'),
    );
    expect(prepare.indexOf('FROM public.qbo_invoice_commands WHERE id = p_command_id'))
      .toBeLessThan(prepare.indexOf('FROM public.qbo_invoice_command_reservations'));
  });

  it('binds a pre-command reservation to the same actor and realm, not only a leaked UUID', () => {
    const reserve = migration.slice(migration.indexOf('FUNCTION public.reserve_qbo_invoice_command'));
    for (const field of ['actor_auth_user_id', 'actor_employee_id', 'initiator', 'realm_id']) {
      expect(reserve).toContain(`v_reservation.${field} IS NOT DISTINCT FROM p_${field}`);
    }
    const prepare = migration.slice(migration.indexOf('FUNCTION public.prepare_qbo_invoice_command'));
    expect(prepare).toContain("'reason', 'reservation-mismatch'");
  });

  it('stages without mutation, then finalizes the exact patch only after provider success', () => {
    const stage = migration.slice(
      migration.indexOf('FUNCTION public.stage_qbo_invoice_line_update'),
      migration.indexOf('FUNCTION public.finalize_qbo_invoice_line_update'),
    );
    const finalize = migration.slice(
      migration.indexOf('FUNCTION public.finalize_qbo_invoice_line_update'),
      migration.indexOf('ALTER POLICY "invoice_lines_billing_write"'),
    );
    for (const body of [stage, finalize]) {
      expect(body).toMatch(/SECURITY DEFINER[\s\S]*auth\.role\(\) IS DISTINCT FROM 'service_role'/);
      const line = body.indexOf('FROM public.invoice_line_items');
      const invoice = body.indexOf('FROM public.invoices WHERE id = p_invoice_id FOR UPDATE');
      const command = body.indexOf('FROM public.qbo_invoice_commands WHERE id = p_command_id FOR UPDATE');
      const reservation = body.indexOf('FROM public.qbo_invoice_command_reservations');
      expect(line).toBeGreaterThan(-1);
      expect(line).toBeLessThan(invoice);
      expect(invoice).toBeLessThan(command);
      expect(command).toBeLessThan(reservation);
      expect(body).toContain("v_reservation.action IS DISTINCT FROM 'save'");
      expect(body).toContain("'patch-conflict'");
    }
    expect(stage).not.toMatch(/UPDATE public\.invoice_line_items/);
    expect(stage).toMatch(/'preimage'[\s\S]*'patch'/);
    expect(finalize).toMatch(/v_command\.status IS DISTINCT FROM 'provider_succeeded'/);
    expect(finalize).toMatch(/v_current IS DISTINCT FROM v_frozen->'preimage'[\s\S]*UPDATE public\.invoice_line_items/);
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric) FROM PUBLIC, anon, authenticated;');
    expect(worker).toMatch(/lineUpdateFromBody\(body\.line_update\)[\s\S]*await reserveQboInvoiceCommand[\s\S]*await stageQboInvoiceLineUpdate[\s\S]*await currentIntent[\s\S]*await executeProvider[\s\S]*await finalizeQboInvoiceLineUpdate/);
    expect(worker).toMatch(/requestedLineUpdateMatchesCommand[\s\S]*line-update-mismatch/);
  });

  it('proves browser-exposed roles cannot execute reserve, not merely that ACL metadata says so', () => {
    const proof = read('supabase/tests/qbo_invoice_command_reservation_isolated.sql');
    expect(proof).toMatch(/SET LOCAL ROLE anon;[\s\S]*PERFORM public\.reserve_qbo_invoice_command[\s\S]*EXCEPTION WHEN insufficient_privilege/);
    expect(proof).toMatch(/SET LOCAL ROLE authenticated;[\s\S]*PERFORM public\.reserve_qbo_invoice_command[\s\S]*EXCEPTION WHEN insufficient_privilege/);
    expect(proof).toMatch(/SET LOCAL ROLE service_role;[\s\S]*service reserve failed/);
    expect(proof).toMatch(/SET LOCAL ROLE service_role;[\s\S]*request\.jwt\.claims[\s\S]*claimless_service_role_denied[\s\S]*PERFORM public\.reserve_qbo_invoice_command[\s\S]*not_authorized: service role required/);
  });

  it('defends CAS after a provider outcome and acquires reservation before intent work', () => {
    const cas = migration.slice(migration.indexOf('FUNCTION public.cas_qbo_invoice_link'));
    expect(cas).toMatch(/v_invoice\.locked IS TRUE[\s\S]*'reason','invoice-locked'/);
    const reserve = worker.indexOf('await reserveQboInvoiceCommand(db, { commandId, invoiceId, action, actor, realmId })');
    expect(reserve).toBeGreaterThan(-1);
    const afterReserve = worker.slice(reserve);
    for (const later of ['await currentIntent(', 'await findClassId(', 'await executeProvider(']) {
      expect(afterReserve.indexOf(later)).toBeGreaterThan(-1);
    }
  });

  it('runs a genuine two-session desktop-table-update versus line-finalizer lock regression', () => {
    expect(localQualifier).toContain('desktop line lock-order session');
    expect(localQualifier).toContain('line finalizer lock-order session');
    expect(localQualifier).toMatch(/BEFORE UPDATE ON public\.invoice_line_items[\s\S]*dockerAsync[\s\S]*UPDATE public\.invoice_line_items[\s\S]*await new Promise[\s\S]*finalize_qbo_invoice_line_update/);
  });

  it('has an explicit high-risk rollback that removes reservation-only objects', () => {
    expect(rollback).toContain('HIGH-RISK');
    const preflight = rollback.slice(0, rollback.indexOf('DROP TRIGGER IF EXISTS trg_invoices_guard_qbo_command_lock'));
    expect(preflight).toMatch(/DO \$rollback_preflight\$[\s\S]*EXISTS \(SELECT 1 FROM public\.qbo_invoice_command_reservations\)[\s\S]*QBO_INVOICE_RESERVATIONS_ACTIVE/);
    expect(preflight).toMatch(/qbo_invoice_commands[\s\S]*'prepared'[\s\S]*'provider_started'[\s\S]*'ambiguous'[\s\S]*'provider_succeeded'[\s\S]*'needs_reconciliation'[\s\S]*QBO_INVOICE_COMMANDS_ACTIVE/);
    expect(preflight).toMatch(/to_regprocedure\('public\.stage_qbo_invoice_line_change\(uuid,uuid,uuid,uuid,text,text,jsonb\)'\)[\s\S]*to_regprocedure\('public\.finalize_qbo_invoice_line_change\(uuid,uuid,uuid,uuid,text,text,jsonb\)'\)[\s\S]*INVOICE_DOCUMENT_LINE_ROLLBACK_ORDER/);
    expect(localQualifier).toMatch(/reservationRollbackOrderRefusalProof[\s\S]*INVOICE_DOCUMENT_LINE_ROLLBACK_ORDER[\s\S]*reservation rollback did not refuse while generic line operations remained installed/);
    expect(localQualifier).toMatch(/rollbackRefusalProof[\s\S]*QBO_INVOICE_RESERVATIONS_ACTIVE[\s\S]*QBO_INVOICE_COMMANDS_ACTIVE/);
    const qualifierMain = localQualifier.slice(localQualifier.indexOf('async function main('));
    expect(qualifierMain.indexOf('await reservationRollbackOrderRefusalProof(context,container)'))
      .toBeLessThan(qualifierMain.indexOf('await documentRollbackRefusalProof(context,container)'));
    expect(qualifierMain.indexOf('psqlFile(context,container,inside(DOCUMENT_ROLLBACK))'))
      .toBeLessThan(qualifierMain.indexOf('await rollbackRefusalProof(context,container)'));
    expect(qualifierMain.indexOf('await rollbackRefusalProof(context,container)'))
      .toBeLessThan(qualifierMain.indexOf('psqlFile(context,container,inside(ROLLBACK))'));
    expect(rollback).toContain('DROP TRIGGER IF EXISTS trg_invoices_guard_qbo_command_lock');
    expect(rollback).toContain('DROP TRIGGER IF EXISTS trg_invoice_lines_guard_qbo_command_write');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.qbo_invoice_command_reservations');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.finalize_qbo_invoice_line_update');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.stage_qbo_invoice_line_update');
    expect(rollback.indexOf('DROP TABLE IF EXISTS public.qbo_invoice_command_reservations'))
      .toBeGreaterThan(rollback.indexOf('FUNCTION public.advance_qbo_invoice_command_attempt'));
  });
});
