/**
 * ════════════════════════════════════════════════
 * FILE: oop-pricing-builder-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the calculator database change and checks its safety promises.
 *   It guards private snapshots, permissions, compatibility, rollback, and local proof wiring.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, Vitest
 *   Internal:  oopPricingConfig.js, paired migration/rollback, database proofs
 *   Data:      reads  → local source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is source-contract coverage, not proof against the live database catalog.
 *   - Exact text checks intentionally make permission and compatibility drift visible.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGACY_PRICING_CONFIG } from '../../../src/lib/oopPricingConfig.js';

const migrationPath = new URL('../../../supabase/migrations/20260730150000_oop_pricing_builder.sql', import.meta.url);
const rollbackPath = new URL('../../../supabase/rollbacks/20260730150000_oop_pricing_builder.rollback.sql', import.meta.url);
const wrapperPath = new URL('../../../supabase/tests/oop_pricing_builder.test.sql', import.meta.url);
const isolatedProofPath = new URL('../../../supabase/tests/oop_pricing_builder_isolated.sql', import.meta.url);
const rollbackProofPath = new URL('../../../supabase/tests/oop_pricing_builder_rollback_isolated.sql', import.meta.url);
const localRunnerPath = new URL('../../../scripts/qa/run-local-db-tests.mjs', import.meta.url);
const raw = readFileSync(migrationPath, 'utf8');
const code = raw.replace(/--[^\n]*/g, '');
const sql = code.replace(/\s+/g, ' ').toLowerCase();

describe('OOP pricing builder migration source contract', () => {
  it('preserves the deployed schema and table grants while replacing only the broad oop_quotes policies', () => {
    expect(sql).not.toMatch(/alter table (?:public\.)?oop_quotes[\s\S]*?add column/);
    expect(sql).not.toMatch(/(?:grant|revoke) [^;]+ on table public\.oop_quotes/);
    expect(sql).not.toMatch(/drop (?:table|column|function) public\.(?:oop_quotes|upsert_oop_quote)/);
    const policyStart = sql.indexOf('drop policy if exists "oop_quotes authenticated read" on public.oop_quotes');
    const policyEnd = sql.indexOf('create or replace function public.oop_pricing_assert_job_exists', policyStart);
    const policies = sql.slice(policyStart, policyEnd);
    expect(policyStart).toBeGreaterThan(-1);
    expect(policies).toContain('drop policy if exists "oop_quotes authenticated write" on public.oop_quotes');
    expect(policies).toContain('create policy "oop_quotes authenticated read" on public.oop_quotes for select to authenticated using (public.oop_pricing_calculator_access())');
    expect(policies).toContain('create policy "oop_quotes authenticated insert" on public.oop_quotes for insert to authenticated with check (public.oop_pricing_calculator_access())');
    expect(policies).toContain('create policy "oop_quotes authenticated update" on public.oop_quotes for update to authenticated using (public.oop_pricing_calculator_access()) with check (public.oop_pricing_calculator_access())');
    expect(policies).toContain('create policy "oop_quotes authenticated delete" on public.oop_quotes for delete to authenticated using (public.oop_pricing_calculator_access())');
    expect(policies).not.toMatch(/to (?:anon|public)/);
    expect(sql).toContain('create or replace function public.upsert_oop_quote( p_id uuid,p_job_id uuid,p_job_type text');
    expect(sql).toContain('p_quote_total numeric, p_net_margin_pct numeric,p_notes text,p_created_by uuid');
    const legacyStart = sql.indexOf('create or replace function public.upsert_oop_quote(');
    const legacyEnd = sql.indexOf('create or replace function public.upsert_oop_quote_v2(');
    const legacy = sql.slice(legacyStart, legacyEnd);
    expect(legacyStart).toBeGreaterThan(-1);
    expect(legacyEnd).toBeGreaterThan(legacyStart);
    expect(legacy).toContain('returns public.oop_quotes');
    expect(legacy).toContain('return v_row; end; $function$;');
  });

  it('creates forced-RLS revision, audit, request, and snapshot storage with no browser grants', () => {
    for (const table of ['oop_pricing_revisions', 'oop_pricing_audit', 'oop_quote_save_requests', 'oop_quote_pricing_snapshots']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toContain(`create policy ${table}_service_role on public.${table} for all to service_role`);
    }
    expect(sql).toContain('quote_id uuid primary key references public.oop_quotes(id) on delete cascade');
    expect(sql).toContain('cleared_at timestamptz');
    expect(sql).toContain('revoke all on table public.oop_pricing_revisions, public.oop_pricing_audit, public.oop_quote_save_requests, public.oop_quote_pricing_snapshots from public, anon, authenticated');
    for (const grant of code.match(/^GRANT\s+[^;]+;/gim) || []) {
      expect(grant.toLowerCase()).not.toContain('anon');
      expect(grant.toLowerCase()).not.toContain('to public');
    }
  });

  it('shares one exact company-role and rollout predicate across RLS and RPCs while keeping admin configuration independent', () => {
    const accessStart = sql.indexOf('create or replace function public.oop_pricing_calculator_access()');
    const activeStart = sql.indexOf('create or replace function public.oop_pricing_active_employee', accessStart);
    const access = sql.slice(accessStart, activeStart);
    const activeEnd = sql.indexOf('drop policy if exists "oop_quotes authenticated read"', activeStart);
    const active = sql.slice(activeStart, activeEnd);
    expect(accessStart).toBeGreaterThan(-1);
    expect(activeStart).toBeGreaterThan(accessStart);
    expect(access).toContain('returns boolean language sql stable security definer set search_path to');
    expect(access).toContain('auth.uid()');
    expect(access).toContain('e.is_active is true');
    expect(access).toContain('e.is_external is false');
    expect(access).toContain("e.role::text in ('admin','office','supervisor','estimator','project_manager')");
    expect(access).not.toContain("'field_tech'");
    expect(access).not.toContain("'crm_partner'");
    expect(access).toContain("join public.feature_flags f on f.key='tool:oop_pricing'");
    expect(access).toContain('f.force_disabled is not true');
    expect(access).toContain('(f.enabled is true or f.dev_only_user_id=e.id)');
    expect(active).toContain("if p_admin then select e.id into v_employee_id from public.employees e where e.auth_user_id=auth.uid() and e.is_active is true and e.is_external is false and e.role::text='admin'");
    expect(active).toContain('if v_employee_id is null or not public.oop_pricing_calculator_access() then');
    expect(sql).toContain('revoke execute on function public.oop_pricing_calculator_access() from public, anon, authenticated, service_role; grant execute on function public.oop_pricing_calculator_access() to authenticated;');
    expect(sql).not.toContain('grant execute on function public.oop_pricing_calculator_access() to service_role');

    for (const name of ['get_oop_pricing_admin_state', 'save_oop_pricing_draft', 'publish_oop_pricing_draft']) {
      const start = sql.indexOf(`create or replace function public.${name}`);
      const end = sql.indexOf('$function$;', start);
      expect(sql.slice(start, end), name).toContain('oop_pricing_active_employee(true)');
    }
    for (const name of ['get_oop_pricing_config', 'upsert_oop_quote(', 'upsert_oop_quote_v2', 'oop_require_active_internal_quote_write', 'get_oop_quote(', 'get_oop_quote_v2', 'get_oop_quotes', 'delete_oop_quote']) {
      const start = sql.indexOf(`create or replace function public.${name}`);
      const end = sql.indexOf('$function$;', start);
      expect(start, name).toBeGreaterThan(-1);
      expect(sql.slice(start, end), name).toContain('oop_pricing_active_employee(false)');
    }

    expect(sql).toContain("pg_advisory_xact_lock(hashtext('oop_pricing_publish'))");
    expect(sql).toContain('request_id uuid not null unique');
    expect(sql).toContain('p_request_id is null then raise exception');
    expect(sql).toContain('pricing_draft_missing');
    expect(sql).toContain('pricing_draft_conflict');
    expect(sql).toContain('quote_conflict');
    expect(sql).toContain("p_config is null or jsonb_typeof(p_config)<>'object'");
    expect(sql).toContain("p_job_type is null or p_job_type not in ('water','mold')");
    expect(sql).toContain("p_inputs is null or jsonb_typeof(p_inputs)<>'object'");
    expect(sql).toContain("'expectedupdatedat',p_expected_updated_at");
  });

  it('validates supplied job IDs without assignment-scoping company-wide quote access', () => {
    const helperStart = sql.indexOf('create or replace function public.oop_pricing_assert_job_exists');
    const helperEnd = sql.indexOf('create or replace function public.oop_pricing_validate_config', helperStart);
    const helper = sql.slice(helperStart, helperEnd);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helper).toContain('p_job_id is not null and not exists(select 1 from public.jobs j where j.id=p_job_id)');
    expect(helper).toContain("raise exception 'oop_job_not_found'");
    expect(helper).not.toContain('project_manager_id');
    expect(helper).not.toContain('lead_tech_id');
    expect(sql.match(/perform public\.oop_pricing_assert_job_exists\(p_job_id\)/g)).toHaveLength(3);
    expect(sql).toContain('perform public.oop_pricing_assert_job_exists(new.job_id)');
    expect(sql).toContain('public.oop_pricing_assert_job_exists(uuid)');
  });

  it('keeps the v2 upsert composite contract and persists snapshots only in the private table', () => {
    expect(sql).toContain('upsert_oop_quote_v2(p_id uuid default null, p_job_id uuid default null, p_job_type text default null, p_insured_name text default null, p_address text default null, p_notes text default null, p_pricing_revision_id uuid default null, p_inputs jsonb default');
    const v2Start = sql.indexOf('create or replace function public.upsert_oop_quote_v2(');
    const v2End = sql.indexOf('create or replace function public.oop_clear_v2_snapshot_on_legacy_update', v2Start);
    const v2 = sql.slice(v2Start, v2End);
    expect(v2).toContain('returns public.oop_quotes');
    expect(v2).toContain('insert into public.oop_quote_pricing_snapshots(');
    expect(v2).toContain('on conflict (quote_id) do update set');
    expect(v2).toContain('cleared_at=null');
    expect(v2).toContain('pricing_inputs=excluded.pricing_inputs');
    const quoteInsertAt = v2.indexOf('insert into public.oop_quotes(');
    const quoteInsertEnd = v2.indexOf(') values(', quoteInsertAt);
    const quoteUpdateAt = v2.indexOf('update public.oop_quotes set');
    const quoteUpdateEnd = v2.indexOf('where id=p_id returning * into v_row', quoteUpdateAt);
    expect(v2.slice(quoteInsertAt, quoteInsertEnd)).not.toContain('pricing_');
    expect(v2.slice(quoteUpdateAt, quoteUpdateEnd)).not.toContain('pricing_');
    expect(v2).toContain("set_config('oop_pricing.v2_write','on',true)");
    expect(v2).toContain("set_config('oop_pricing.v2_write','off',true)");
  });

  it('provides a flat merged read contract and soft-clears snapshots on non-v2 updates', () => {
    const getStart = sql.indexOf('create or replace function public.get_oop_quote_v2(p_id uuid)');
    const getEnd = sql.indexOf('create or replace function public.get_oop_quotes', getStart);
    const getV2 = sql.slice(getStart, getEnd);
    expect(getV2).toContain('returns jsonb');
    expect(getV2).toContain("select to_jsonb(q)||case when s.quote_id is null then '{}'::jsonb else jsonb_build_object(");
    for (const key of ['pricing_revision_id', 'pricing_inputs', 'pricing_config_snapshot', 'pricing_evaluated_lines', 'pricing_engine_version', 'pricing_minimum_adjustment']) {
      expect(getV2).toContain(`'${key}'`);
    }
    expect(getV2).toContain('on s.quote_id=q.id and s.cleared_at is null');
    const clearStart = sql.indexOf('create or replace function public.oop_clear_v2_snapshot_on_legacy_update()');
    const clearEnd = sql.indexOf('create or replace function public.oop_require_active_internal_quote_write()', clearStart);
    const clear = sql.slice(clearStart, clearEnd);
    expect(clear).toContain("current_setting('oop_pricing.v2_write',true) is distinct from 'on'");
    expect(clear).toContain('update public.oop_quote_pricing_snapshots set cleared_at=now(), updated_at=now() where quote_id=new.id and cleared_at is null');
    expect(clear).not.toContain('delete from public.oop_quote_pricing_snapshots');
    expect(clear).toContain('after update on public.oop_quotes');
  });

  it('calculates canonical money with frozen ordering, bounds, and compatibility shadows', () => {
    expect(sql).toContain('unknown_pricing_input');
    expect(sql).toContain('invalid_pricing_input_bounds');
    expect(sql).toContain('invalid_pricing_input_precision');
    expect(sql).toContain('final_total_percentage_customer_rate_must_be_zero');
    expect(sql).toContain('pricing_revision_immutable');
    expect(sql).toContain('pricing_legacy_revision_missing');
    expect(sql).toContain('pricing_revision_not_found_or_not_published');
    expect(sql.split("for v_item in select value from jsonb_array_elements(v_revision.config->'items')").length - 1).toBe(1);
    expect(sql).toContain("order by (value->>'sortorder')::integer,value->>'key'");
    expect(sql).toContain("when 'percentage' then coalesce(v_base,0)*v_rate");
    expect(sql).toContain("when v_item->>'percentagebase'='prior_subtotal' then v_subtotal");
    expect(sql).toContain("x->>'key'=substring(v_item->>'percentagebase' from 6) and coalesce((x->>'customervisible')::boolean,false)");
    expect(sql).toContain("if (v_item->>'customervisible')::boolean then v_subtotal:=round(v_subtotal+v_customer,2)");
    expect(sql).toContain('if v_customer_raw>0 then v_customer:=round(greatest');
    expect(sql).toContain("v_item->>'internalcostbasis' when 'units'");
    expect(sql).toContain("when 'input' then v_raw_qty*(v_item->>'internalrate')::numeric");
    const minimumAt = sql.indexOf("v_minimum:=coalesce((v_revision.config->'projectminimums'->>p_job_type)::numeric,0)");
    const deferredAt = sql.indexOf('for v_deferred_item in select value from jsonb_array_elements(v_deferred)');
    expect(minimumAt).toBeGreaterThan(-1);
    expect(deferredAt).toBeGreaterThan(minimumAt);
    expect(sql).toContain("v_internal:=round(v_subtotal*(v_deferred_item->>'internalrate')::numeric,2)");
    expect(sql).toContain("'techhours',round(coalesce((p_inputs->'labor'->>'quantity')::numeric,0),2)");
    expect(sql).toContain("'airmovercount',round(coalesce((p_inputs->'air_mover'->>'quantity')::numeric,0))");
    expect(sql).not.toMatch(/\(p_inputs->'[^']+'->>'(?:quantity|days)'\)::integer/);
    expect(sql).toContain('oop_pricing_assert_storage_bounds');
    expect(sql).toContain('oop_pricing_line_out_of_range');
    expect(sql).toContain('oop_net_margin_pct_out_of_range');
  });

  it('hardens legacy money, actor, deletion, and quote-number behavior without changing signatures', () => {
    const generator = sql.slice(sql.indexOf('create or replace function public.generate_oop_quote_number()'), sql.indexOf('create or replace function public.oop_pricing_active_employee'));
    expect(generator).toContain("set search_path to ''");
    expect(generator).toContain("to_char(now() at time zone 'america/denver', 'yymm')");
    expect(generator).toContain("pg_advisory_xact_lock(hashtext('oop_quote_number:america/denver:' || v_month))");
    expect(sql).toContain('revoke execute on function public.generate_oop_quote_number() from public, anon, authenticated, service_role');
    expect(sql).not.toContain('grant execute on function public.generate_oop_quote_number()');
    const deleteStart = sql.indexOf('create or replace function public.delete_oop_quote(p_id uuid)');
    const deleteEnd = sql.indexOf('insert into public.oop_pricing_revisions', deleteStart);
    const guardedDelete = sql.slice(deleteStart, deleteEnd);
    expect(guardedDelete).toContain('perform public.oop_pricing_active_employee(false); delete from public.oop_quotes where id=p_id; return found;');
    expect(sql).toContain('new.created_by:=v_actor');
    expect(sql).toContain('new.created_by:=old.created_by');
    expect(raw.toLowerCase()).toContain('client-supplied total/margin is replaced');
    expect(sql).toContain("set_config('oop_pricing.legacy_canonical_write','on',true)");
    expect(sql).toContain("current_setting('oop_pricing.legacy_canonical_write',true) is distinct from 'on'");
    expect(sql).toContain('grant execute on function public.get_oop_quote(uuid), public.get_oop_quotes(integer,uuid), public.delete_oop_quote(uuid), public.upsert_oop_quote(uuid,uuid,text,text,text,numeric,numeric,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,text,uuid) to authenticated, service_role');
  });

  it('seeds published revision 1 and a draft clone with the frozen config shape', () => {
    expect(raw).toContain('"schemaVersion":1');
    expect(raw).toContain('"projectMinimums":{"water":0,"mold":0}');
    for (const key of ['labor', 'air_mover', 'lgr', 'xlgr', 'air_scrubber', 'negative_air', 'materials', 'antimicrobial', 'disposal', 'containment', 'ppe', 'prv', 'overhead']) expect(raw).toContain(`"key":"${key}"`);
    expect(sql).toContain("(1,'published'");
    expect(sql).toContain("select 2,'draft',config");
    const seedMatch = raw.match(/\(1,'published','([\s\S]*?)'::jsonb,now\(\)\)/);
    expect(seedMatch).not.toBeNull();
    expect(JSON.parse(seedMatch[1])).toEqual(LEGACY_PRICING_CONFIG);
  });

  it('wires guarded forward and rollback behavior proofs into the governed local DB lane', () => {
    const wrapper = readFileSync(wrapperPath, 'utf8');
    const isolatedProof = readFileSync(isolatedProofPath, 'utf8');
    const rollbackProof = readFileSync(rollbackProofPath, 'utf8');
    const runner = readFileSync(localRunnerPath, 'utf8');
    expect(wrapper).toContain('\\set ON_ERROR_STOP on');
    expect(wrapper).toContain('GRANT SELECT ON oop_pricing_cross_tier_fixture TO authenticated');
    expect(wrapper).toContain('\\ir oop_pricing_builder_isolated.sql');
    expect(wrapper).toContain('\\ir oop_pricing_builder_rollback_isolated.sql');
    expect(wrapper).toContain('SELECT plan(1)');
    expect(wrapper).toContain('SELECT * FROM finish()');
    expect(isolatedProof).toContain('authenticated unexpectedly read private pricing snapshots');
    expect(isolatedProof).toContain('direct legacy update left an active configurable-pricing snapshot');
    expect(isolatedProof).toContain('soft-cleared snapshot data was not retained privately');
    expect(isolatedProof).toContain('v_fractional.air_mover_count<>1');
    expect(isolatedProof).toContain('eligible role did not receive calculator config');
    expect(isolatedProof).toContain("'OOP Field Tech','field_tech'");
    expect(isolatedProof).toContain("'OOP CRM Partner','crm_partner'");
    expect(isolatedProof).toContain('company-wide list hid a cross-creator quote');
    expect(isolatedProof).toContain('eligible role could not directly select all company quotes');
    expect(isolatedProof).toContain('denied caller bypassed RLS with direct SELECT');
    expect(isolatedProof).toContain('eligible direct INSERT did not enforce actor ownership');
    expect(isolatedProof).toContain('eligible direct DELETE was blocked by scoped RLS');
    expect(isolatedProof).toContain('denied caller bypassed RLS with direct INSERT');
    expect(isolatedProof).toContain('denied caller bypassed RLS with direct UPDATE');
    expect(isolatedProof).toContain('denied caller bypassed RLS with direct DELETE');
    expect(isolatedProof).toContain('missing rollout row allowed direct SELECT');
    expect(isolatedProof).toContain('force-disabled rollout allowed direct SELECT');
    expect(isolatedProof).toContain('non-preview eligible employee bypassed disabled rollout with direct SELECT');
    expect(isolatedProof).toContain('estimator could not manage cross-creator/cross-job quote');
    expect(isolatedProof).toContain('legacy upsert accepted a nonexistent job id');
    expect(isolatedProof).toContain('v2 upsert accepted a nonexistent job id');
    expect(isolatedProof).toContain('direct update accepted a nonexistent job id');
    expect(isolatedProof).toContain('owner preview did not enable calculator RPCs');
    expect(isolatedProof).toContain('missing rollout row unexpectedly enabled calculator RPCs');
    expect(isolatedProof).toContain('force-disabled rollout unexpectedly enabled calculator RPCs');
    expect(isolatedProof).toContain('admin draft/publish was blocked while rollout was force-disabled');
    expect(isolatedProof).toContain("current_setting('oop_pricing.test_parity_revision')::uuid");
    expect(isolatedProof).toContain('RESET ROLE');
    expect(rollbackProof).toContain("SET LOCAL app.oop_pricing_rollback = 'approved'");
    expect(rollbackProof).toContain('rollback did not retain configured quote snapshot data');
    expect(rollbackProof).toContain('rollback did not retain exact fail-closed quote policies');
    expect(rollbackProof).toContain('denied rollback identity bypassed direct SELECT');
    expect(rollbackProof).toContain('denied rollback identity reached legacy upsert');
    expect(rollbackProof).toContain('anonymous caller reached rollback legacy RPC');
    expect(rollbackProof).toContain('rollback Force Off allowed direct SELECT');
    expect(rollbackProof).toContain('rollback missing flag allowed direct SELECT');
    expect(rollbackProof).toContain('rollback legacy RPC accepted client money or actor');
    expect(rollbackProof).toContain('rollback direct INSERT bypassed canonical money or actor ownership');
    expect(runner).toContain("'supabase/tests/oop_pricing_builder.test.sql'");
  });

  it('ships an owner-gated rollback that disables the builder without reopening authorization or money holes', () => {
    expect(existsSync(rollbackPath)).toBe(true);
    const rollbackRaw = readFileSync(rollbackPath, 'utf8');
    const rollback = rollbackRaw.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
    expect(rollback).toContain("current_setting('app.oop_pricing_rollback', true) is distinct from 'approved'");
    expect(rollback).toContain('revoke execute on function public.get_oop_pricing_config');
    expect(rollback).toContain('public.get_oop_quote_v2(uuid) from public, anon, authenticated, service_role');
    expect(rollback).toContain('grant execute on function public.oop_pricing_calculator_access() to authenticated');
    expect(rollback).toContain('public.oop_pricing_assert_job_exists(uuid)');
    expect(rollback).toContain('create trigger oop_clear_v2_snapshot_on_legacy_update');
    expect(rollback).toContain('create trigger oop_require_active_internal_quote_write');
    expect(rollback).toContain('drop policy if exists "oop_quotes authenticated insert" on public.oop_quotes');
    expect(rollback).toContain('drop policy if exists "oop_quotes authenticated update" on public.oop_quotes');
    expect(rollback).toContain('drop policy if exists "oop_quotes authenticated delete" on public.oop_quotes');
    expect(rollback).toContain('create policy "oop_quotes authenticated read" on public.oop_quotes for select to authenticated using (public.oop_pricing_calculator_access())');
    expect(rollback).toContain('create policy "oop_quotes authenticated insert" on public.oop_quotes for insert to authenticated with check (public.oop_pricing_calculator_access())');
    expect(rollback).toContain('create policy "oop_quotes authenticated update" on public.oop_quotes for update to authenticated using (public.oop_pricing_calculator_access()) with check (public.oop_pricing_calculator_access())');
    expect(rollback).toContain('create policy "oop_quotes authenticated delete" on public.oop_quotes for delete to authenticated using (public.oop_pricing_calculator_access())');
    expect(rollback).not.toContain('using (true)');
    expect(rollback).not.toContain('for all to authenticated');
    expect(rollback).not.toContain('create or replace function public.upsert_oop_quote(');
    expect(rollback).not.toMatch(/drop (?:table|column) public\.oop_/);
    expect(rollback).not.toMatch(/(?:grant|revoke) [^;]+ on table public\.oop_quotes/);
    expect(rollback).not.toContain('drop function');
    expect(rollback).toContain('revoke execute on function public.generate_oop_quote_number() from public, anon, authenticated, service_role');
    expect(rollback).not.toContain('grant execute on function public.generate_oop_quote_number()');
    expect(rollback).toContain("position('oop_pricing_active_employee(false)' in v_upsert)");
    expect(rollback).toContain("position('v_quote:=round(v_quote_raw,2)' in v_upsert)");
    expect(rollback).toContain('to authenticated, service_role');
  });
});