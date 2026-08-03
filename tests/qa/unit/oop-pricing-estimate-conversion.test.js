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

  it('saves the current quote, calls only the conversion RPC, and opens the existing estimate editor', () => {
    expect(calculator).toContain("db.rpc('convert_oop_quote_to_estimate'");
    expect(calculator).toContain('await saveQuote()');
    expect(calculator).toContain("includes('oop_quote_already_converted')");
    expect(calculator).toContain('canEditBilling(employee?.role)');
    expect(calculator).toContain('linkedJob?.id');
    expect(calculator).toContain('navigate(`/estimates/${result.estimate_id}`)');
    expect(calculator).toContain('if (converting) return;');
    expect(calculator).toContain('conversionRequestRef.current === requestVersion');
    expect(calculator).toContain('locationRef.current === requestedLocationKey');
    expect(calculator).toContain('? <span aria-disabled="true">');
    expect(calculator).toContain('disabled={Boolean(convertedEstimateId) || converting}');
    expect(calculator).toContain('disabled={deleting || converting}');
    expect(calculator).not.toContain("fetch('/api/qbo-estimate'");
    expect(calculator).not.toContain("fetch('/api/qbo-invoice'");
  });
});
