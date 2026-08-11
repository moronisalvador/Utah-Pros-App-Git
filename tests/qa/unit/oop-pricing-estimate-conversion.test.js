/**
 * ════════════════════════════════════════════════
 * FILE: oop-pricing-estimate-conversion.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the OOP quote-to-estimate handoff to one atomic, retry-safe database
 *   operation and checks that the calculator opens the existing estimate editor.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, Vitest
 *   Internal:  OOP calculator, migration, rollback
 *   Data:      reads  → local source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is CI-visible source-contract coverage, not live database proof.
 *   - QuickBooks must remain behind the estimate editor's human Save action.
 * ════════════════════════════════════════════════
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migrationName = readdirSync(join(root, 'supabase/migrations'))
  .find((name) => name.endsWith('_oop_quote_to_estimate.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase/migrations', migrationName), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase()
  : '';
const rollback = migrationName
  ? readFileSync(join(root, 'supabase/rollbacks', migrationName.replace('.sql', '.rollback.sql')), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase()
  : '';
const calculator = readFileSync(join(root, 'src/components/oop/ConfiguredOopPricingCalculator.jsx'), 'utf8');
const nativeReview = readFileSync(join(root, 'src/pages/tech/NativeOopEstimateReview.jsx'), 'utf8');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');

describe('OOP quote to estimate conversion', () => {
  it('ships one additive migration with a guarded rollback', () => {
    expect(migrationName).toBeTruthy();
    expect(migration).toContain('add column if not exists converted_estimate_id uuid references public.estimates(id) on delete restrict');
    expect(migration).toContain('create unique index if not exists oop_quotes_converted_estimate_unique');
    expect(rollback).toContain('oop_quote_estimate_rollback_blocked');
    expect(rollback).toContain('drop function if exists public.convert_oop_quote_to_estimate(uuid)');
    expect(rollback).toContain('drop column if exists converted_estimate_id');
  });

  it('creates one estimate atomically from the saved canonical customer lines', () => {
    expect(migration).toContain('create or replace function public.convert_oop_quote_to_estimate(p_quote_id uuid)');
    expect(migration).toContain("security definer set search_path to ''");
    expect(migration).toContain('public.oop_pricing_active_employee(false)');
    expect(migration).toContain("v_role not in ('admin','manager')");
    expect(migration).toContain('for update');
    expect(migration).toContain('oop_quote_job_required');
    expect(migration).toContain('oop_quote_snapshot_required');
    expect(migration).toContain("current_setting('oop_pricing.estimate_conversion', true) is distinct from 'on'");
    expect(migration).toContain("to_jsonb(new) - 'converted_estimate_id'");
    expect(migration).toContain('oop_quote_conversion_link_only');
    expect(migration).toContain("set_config('oop_pricing.estimate_conversion', 'on', true)");
    expect(migration).toContain("set_config('oop_pricing.v2_write', 'on', true)");
    expect(migration).toContain("coalesce((v_line->>'customervisible')::boolean,false)");
    expect(migration).toContain('insert into public.estimate_line_items');
    expect(migration).not.toMatch(/insert into public\.estimate_line_items\s*\([^)]*line_total/);
    expect(migration).toMatch(/update public\.oop_quotes set converted_estimate_id\s*=\s*v_estimate\.id/);
    expect(migration).toContain("jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',false)");
    expect(migration).toContain("jsonb_build_object('ok',true,'estimate_id',v_estimate.id,'created',true)");
  });

  it('keeps the RPC browser-authenticated, billing-role gated, and unavailable to public callers', () => {
    expect(migration).toContain('revoke execute on function public.convert_oop_quote_to_estimate(uuid) from public, anon, authenticated, service_role');
    expect(migration).toContain('grant execute on function public.convert_oop_quote_to_estimate(uuid) to authenticated');
    expect(migration).not.toContain('grant execute on function public.convert_oop_quote_to_estimate(uuid) to service_role');
    expect(migration).not.toContain('grant execute on function public.convert_oop_quote_to_estimate(uuid) to anon');
  });

  it('atomically corrects only an admin-owned, unconverted OOP estimate at the expected version', () => {
    expect(migration).toContain('create or replace function public.correct_oop_estimate(');
    expect(migration).toContain("v_role is distinct from 'admin'");
    expect(migration).toContain('where q.converted_estimate_id = v_estimate.id');
    expect(migration).toContain('if v_estimate.converted_invoice_id is not null');
    expect(migration).toContain('oop_estimate_already_converted');
    expect(migration).toContain('for update');
    expect(migration).toContain('v_estimate.updated_at is distinct from p_expected_updated_at');
    expect(migration).toContain('oop_estimate_correction_conflict');
    expect(migration).toContain('oop_estimate_correction_line_set_mismatch');
    expect(migration).toContain('update public.estimate_line_items li');
    expect(migration).not.toMatch(/update public\.estimate_line_items li set[^;]*line_total\s*=/);
    expect(migration).toContain('revoke execute on function public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated, service_role');
    expect(migration).toContain('grant execute on function public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb) to authenticated');
    expect(rollback).toContain('drop function if exists public.correct_oop_estimate(uuid, timestamptz, jsonb, jsonb)');
  });

  it('preserves internal estimate reads but narrows direct writes to billing editors', () => {
    expect(migration).toContain('create or replace function public.billing_edit_access()');
    expect(migration).toContain('revoke execute on function public.billing_edit_access() from public, anon, authenticated, service_role');
    expect(migration).toContain('grant execute on function public.billing_edit_access() to authenticated');
    expect(migration).not.toContain('grant execute on function public.billing_edit_access() to authenticated, service_role');
    expect(migration).toContain('create policy "oop_estimates_internal_read" on public.estimates for select to authenticated');
    expect(migration).toContain('create policy "oop_estimates_billing_write" on public.estimates for all to authenticated');
    expect(migration).toContain('create policy "oop_estimate_lines_internal_read" on public.estimate_line_items for select to authenticated');
    expect(migration).toContain('create policy "oop_estimate_lines_billing_write" on public.estimate_line_items for all to authenticated');
    expect(migration).toContain('revoke execute on function public.save_estimate_lines(uuid, jsonb, text) from authenticated');
    expect(rollback).toContain('create policy "allow_authenticated_estimates" on public.estimates');
    expect(rollback).toContain('create policy "allow_authenticated_estimate_line_items" on public.estimate_line_items');
    expect(rollback).toContain('grant execute on function public.save_estimate_lines(uuid, jsonb, text) to authenticated');
  });

  it('saves the current quote, calls only the conversion RPC, and opens the target-specific estimate review route', () => {
    expect(calculator).toContain("db.rpc('convert_oop_quote_to_estimate'");
    expect(calculator).toContain('await saveQuote()');
    expect(calculator).toContain("includes('oop_quote_already_converted')");
    expect(calculator).toContain('canEditBilling(employee?.role)');
    expect(calculator).toContain('linkedJob?.id');
    expect(calculator).toContain('estimateHref(result.estimate_id)');
    expect(calculator).toMatch(/IS_NATIVE_BUILD\s*\?\s*`\$\{basePath\}\/estimate\/\$\{estimateId\}`/);
    expect(calculator).toContain('if (converting) return;');
    expect(calculator).toContain('conversionRequestRef.current === requestVersion');
    expect(calculator).toContain('locationRef.current === requestedLocationKey');
    expect(calculator).toContain('? <span aria-disabled="true">');
    expect(calculator).toContain('disabled={Boolean(convertedEstimateId) || converting}');
    expect(calculator).toContain('disabled={deleting || converting}');
    expect(calculator).not.toContain("fetch('/api/qbo-estimate'");
    expect(calculator).not.toContain("fetch('/api/qbo-invoice'");
  });

  it('keeps native review admin-only, OOP-only, and safe-column editable', () => {
    expect(app).toContain('path="tech/tools/oop-pricing/estimate/:estimateId"');
    expect(app).toContain('<AdminRoute><FeatureRoute flag="tool:oop_pricing">');
    expect(nativeReview).toContain("converted_estimate_id=eq.${estimateId}");
    expect(nativeReview).toContain('This estimate was not created by the OOP calculator.');
    expect(nativeReview).toContain("dbRef.current.rpc('correct_oop_estimate'");
    expect(nativeReview).toContain('p_expected_updated_at: estimate.updated_at');
    expect(nativeReview).toContain('converted_invoice_id');
    expect(nativeReview).toContain('Converted to invoice');
    expect(nativeReview).toContain('description: line.description');
    expect(nativeReview).toContain('quantity: line.quantity');
    expect(nativeReview).toContain('unit_price: line.unit_price');
    expect(nativeReview).toContain('Edit estimate');
    expect(nativeReview).toContain('Save changes');
    expect(nativeReview).toContain('useUnsavedNavigationGuard');
    expect(nativeReview).toContain('Confirm discard');
    expect(nativeReview).toContain('navigator.onLine === false');
    expect(nativeReview).not.toContain("dbRef.current.update('estimates'");
    expect(nativeReview).not.toContain("dbRef.current.update('estimate_line_items'");
    expect(nativeReview).not.toContain('useResumeRefetch');
    expect(nativeReview).not.toContain('convert_estimate_to_invoice');
    expect(nativeReview).not.toContain("fetch('/api/qbo-invoice'");
    expect(nativeReview).not.toContain('@/components/admin-mobile');
  });

  // Reversed 2026-08-07 by owner decision: the first thing found when the OOP
  // calculator was tested in the field was that an estimate built on a phone had
  // no way to reach the customer — the page said "open it on the web". Save and
  // send now work from the phone. What did NOT change is the boundary underneath:
  // the page posts to the same Worker the web editor uses, and no invoice,
  // payment, collections or Admin Mobile module enters the native bundle.
  it('lets the phone save the estimate to QuickBooks and email the customer', () => {
    expect(nativeReview).toContain("import { callQboEstimateWorker } from '@/lib/qboEstimateWorker'");
    expect(nativeReview).toContain('callQboEstimateWorker({ ownerId: user?.id, estimateId, authHeaders, body })');
    expect(nativeReview).not.toContain("fetch('/api/qbo-estimate'");
    expect(nativeReview).toContain("callEstimateWorker({ action: 'send' })");
    expect(nativeReview).toContain('Save to QuickBooks');
    expect(nativeReview).toContain('Update QuickBooks');
    expect(nativeReview).toContain('Send to customer');
    // The Worker owns every Intuit call — no token, realm or provider retry here.
    expect(nativeReview).not.toContain('quickbooks.api.intuit.com');
    expect(nativeReview).not.toContain('QBO_WEBHOOK_SECRET');
  });

  it('makes emailing a real customer a deliberate second tap, never a modal', () => {
    expect(nativeReview).toContain('useTwoClickConfirm');
    expect(nativeReview).toContain("isArmed('send')");
    expect(nativeReview).toContain("arm('send')");
    expect(nativeReview).toContain('Confirm — email');
    expect(nativeReview).not.toContain('confirm(');
    expect(nativeReview).not.toContain('alert(');
    // Send is impossible without a destination, and refuses offline.
    expect(nativeReview).toContain('!contact?.email');
    expect(nativeReview).toContain('An internet connection is required to reach QuickBooks.');
  });

  it('imports no collections module into the native bundle', () => {
    expect(nativeReview).not.toContain('@/components/collections');
    expect(nativeReview).not.toContain('qboInvoiceWorker');
    expect(nativeReview).not.toContain('QboAttachments');
  });
});
