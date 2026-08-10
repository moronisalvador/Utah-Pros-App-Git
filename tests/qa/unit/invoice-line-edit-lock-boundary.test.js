/**
 * ════════════════════════════════════════════════
 * FILE: invoice-line-edit-lock-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the invoice-line editing safety rules without database credentials.
 *   It makes the browser permission, manual lock, generated total, invoice
 *   status, QuickBooks save, and rollback promises visible in CI.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  invoice-line migration and rollback, qbo-invoice worker
 *   Data:      reads  → repository source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a source contract. It does not prove a migration was applied.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260810010000_invoice_line_edit_lock_boundary.sql');
const rollback = read('supabase/rollbacks/20260810010000_invoice_line_edit_lock_boundary.rollback.sql');
const lifecycle = read('supabase/migrations/20260731180000_qbo_estimate_conversion_concurrency.sql');
const worker = read('functions/api/qbo-invoice.js');
const isolatedProof = read('supabase/tests/invoice_line_edit_lock_boundary_isolated.sql');

const stageRpcSignature = 'public.stage_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric)';
const finalizeRpcSignature = 'public.finalize_qbo_invoice_line_update(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,numeric)';
const reservationMigration = read('supabase/migrations/20260810020000_qbo_invoice_command_reservation.sql');

describe('invoice line edit lock boundary', () => {
  it('keeps 10000 browser-RPC-free and puts staging/finalization behind the service reservation', () => {
    expect(migration).not.toContain('FUNCTION public.update_invoice_line_item');
    for (const name of ['stage_qbo_invoice_line_update', 'finalize_qbo_invoice_line_update']) {
      const rpc = reservationMigration.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0] || '';
      expect(rpc).toContain('SECURITY DEFINER');
      expect(rpc).toContain("auth.role() <> 'service_role'");
      expect(rpc).toContain('FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;');
      expect(rpc).toContain('FROM public.qbo_invoice_commands WHERE id = p_command_id FOR UPDATE;');
      expect(rpc).toContain('WHERE invoice_id = p_invoice_id FOR UPDATE;');
      expect(rpc).toContain('WHERE id = p_line_id AND invoice_id = p_invoice_id FOR UPDATE;');
      expect(rpc).toContain("'invoice-locked'");
      expect(rpc).toContain("'line-not-found'");
    }
    for (const signature of [stageRpcSignature, finalizeRpcSignature]) {
      expect(reservationMigration).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
      expect(reservationMigration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
  });

  it('stages without mutation and limits finalization to source fields after provider success', () => {
    const stage = reservationMigration.match(/CREATE OR REPLACE FUNCTION public\.stage_qbo_invoice_line_update\([\s\S]*?\$function\$;/)?.[0] || '';
    const finalize = reservationMigration.match(/CREATE OR REPLACE FUNCTION public\.finalize_qbo_invoice_line_update\([\s\S]*?\$function\$;/)?.[0] || '';
    expect(stage).not.toMatch(/UPDATE public\.invoice_line_items/);
    expect(stage).toContain("'preimage'");
    expect(stage).toContain("'patch'");
    expect(finalize).toContain("v_command.status IS DISTINCT FROM 'provider_succeeded'");
    expect(finalize).toContain('SET description = p_description');
    for (const field of ['qbo_item_id', 'qbo_item_name', 'qbo_class_id', 'qbo_class_name', 'quantity', 'unit_price']) {
      expect(finalize).toContain(`${field} = p_${field}`);
    }
    expect(finalize).not.toMatch(/\bline_total\s*=/);
    expect(finalize).not.toMatch(/\bstatus\s*=/);
    expect(finalize).toContain("p_quantity IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)");
    expect(finalize).toContain("p_unit_price IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)");
    expect(finalize).not.toMatch(/p_(quantity|unit_price)\s*<\s*0/);
  });

  it('prevents direct browser REST writes during either a manual lock or active QBO reservation, while preserving ordinary drafts', () => {
    expect(migration).toMatch(/ALTER POLICY "invoice_lines_billing_write" ON public\.invoice_line_items[\s\S]*TO authenticated[\s\S]*public\.billing_edit_access\(\)[\s\S]*WHERE i\.id = invoice_id[\s\S]*i\.locked IS FALSE/);
    expect(reservationMigration).toMatch(/CREATE OR REPLACE FUNCTION public\.invoice_line_qbo_write_access\(p_invoice_id uuid\)[\s\S]*auth\.role\(\) = 'authenticated'[\s\S]*public\.billing_edit_access\(\)[\s\S]*NOT EXISTS \([\s\S]*public\.qbo_invoice_command_reservations/);
    expect(reservationMigration).toMatch(/ALTER POLICY "invoice_lines_billing_write" ON public\.invoice_line_items[\s\S]*public\.invoice_line_qbo_write_access\(invoice_id\)/);
    expect(rollback).toMatch(/ALTER POLICY "invoice_lines_billing_write" ON public\.invoice_line_items[\s\S]*TO authenticated[\s\S]*USING \(public\.billing_edit_access\(\)\)[\s\S]*WITH CHECK \(public\.billing_edit_access\(\)\)/);
    for (const denied of ['field_tech', 'estimator', 'supervisor', 'crm_partner', 'inactive_admin', 'external_admin']) {
      expect(isolatedProof).toContain(`'${denied}'`);
    }
  });

  it('makes eligible linked revisions draft in a trigger-only writer and preserves protected statuses', () => {
    const revision = migration.match(/CREATE OR REPLACE FUNCTION public\.mark_invoice_line_revision_draft\(\)[\s\S]*?\$function\$;/)?.[0] || '';
    expect(revision).toContain('SECURITY DEFINER');
    expect(revision).toContain('SET search_path = pg_catalog, public');
    expect(revision).toContain("SET status = 'draft'");
    expect(revision).toContain('qbo_invoice_id IS NOT NULL');
    expect(revision).toContain("COALESCE(invoice_type, '') <> 'collection'");
    expect(revision).toContain('COALESCE(amount_paid, 0) = 0');
    expect(revision).toMatch(/status NOT IN \([\s\S]*'draft'[\s\S]*'paid'[\s\S]*'partially_paid'[\s\S]*'voided'[\s\S]*'disputed'[\s\S]*'viewed'[\s\S]*'overdue'[\s\S]*\)/);
    expect(revision).not.toMatch(/\bline_total\s*=/);
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    expect(migration).toContain('CREATE TRIGGER trg_invoice_lines_revision_draft');
    expect(lifecycle).toMatch(/OLD\.status = 'draft'[\s\S]*NEW\.status := 'saved'/);
    expect(lifecycle).toMatch(/BEFORE UPDATE OF qbo_invoice_id, qbo_emailed_at ON public\.invoices/);
    expect(worker).toContain("db.rpc('cas_qbo_invoice_link', { p_invoice_id: invoiceId");
  });

  it('uses the durable reservation rather than a stale lock read before intent, command preparation, or provider work', () => {
    const handler = worker.slice(worker.indexOf('export async function onRequestPost'));
    const reserve = handler.indexOf('await reserveQboInvoiceCommand(db, { commandId, invoiceId, action, actor, realmId })');
    expect(reserve).toBeGreaterThan(-1);
    expect(handler.indexOf("reservation?.reason === 'invoice-locked'")).toBeGreaterThan(reserve);
    for (const operation of ['await currentIntent(', 'await prepareQboInvoiceCommand(', 'await executeProvider(']) {
      expect(handler.indexOf(operation)).toBeGreaterThan(reserve);
    }
  });

  it('has paired rollbacks that remove the service-only writer/revision trigger and restore the prior policy', () => {
    const reservationRollback = read('supabase/rollbacks/20260810020000_qbo_invoice_command_reservation.rollback.sql');
    expect(reservationRollback).toContain(`DROP FUNCTION IF EXISTS ${stageRpcSignature};`);
    expect(reservationRollback).toContain(`DROP FUNCTION IF EXISTS ${finalizeRpcSignature};`);
    expect(rollback).toContain('DROP TRIGGER IF EXISTS trg_invoice_lines_revision_draft');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.mark_invoice_line_revision_draft();');
    expect(rollback).toMatch(/DO \$rollback_order_preflight\$[\s\S]*qbo_invoice_command_reservations[\s\S]*guard_invoice_line_write_during_qbo_command[\s\S]*INVOICE_LINE_ROLLBACK_ORDER/);
    expect(rollback).not.toContain('CREATE OR REPLACE FUNCTION public.recompute_invoice_from_lines()');
  });
});
