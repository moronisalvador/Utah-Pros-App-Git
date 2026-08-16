/**
 * ════════════════════════════════════════════════
 * FILE: crm-lead-read-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the migration which stops everyone in the company from reading
 *   and rearranging the sales pipeline says what it claims to, and that the undo
 *   file puts back exactly what was there before.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  supabase/migrations/20260809000000_crm_lead_read_boundary.sql,
 *              its paired rollback
 *   Data:      reads  → source text only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. The behavioural proof is
 *     scripts/qa/qualify-crm-lead-boundary-local.mjs, which runs on a disposable
 *     local stack — the db lane is not one of the three credential-free lanes,
 *     so never present it as CI coverage (close-out-standard.md §2b).
 *   - The crm_partner case is the one that matters most. Gating the two shared
 *     RPCs on billing_edit_access() would have locked 6 active CRM partners out
 *     of the desktop kanban they work daily; this file fails if that predicate
 *     ever appears here.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20260809000000_crm_lead_read_boundary.sql';
const ROLLBACK = 'supabase/rollbacks/20260809000000_crm_lead_read_boundary.rollback.sql';

/** Source with `--` comment lines stripped, so prose cannot satisfy a code assertion. */
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const GATED_RPCS = [
  { name: 'get_pipeline_stages', args: 'uuid' },
  { name: 'move_lead_to_stage', args: 'uuid, uuid, uuid, text' },
  { name: 'get_lead_activity', args: 'uuid' },
  { name: 'get_lead_notes', args: 'uuid' },
  { name: 'add_lead_note', args: 'uuid, text, uuid' },
];

/** The five reviewed live body hashes the drift guard pins. */
const PINNED_MD5 = {
  add_lead_note: 'a60fba7b2d1f2b6e9d1dd54d701ff923',
  get_lead_activity: '1c490cbf16b5a04f548282bdfd4362f6',
  get_lead_notes: '26ff69a26f9faaa6e3d5b6690993cf7e',
  get_pipeline_stages: '977cebe1be0e548297d8180ef6b1830b',
  move_lead_to_stage: 'b56fa64c1ee916c075bab69c0a23dd00',
};

describe('CRM lead read boundary — migration source contract', () => {
  it('gates all five RPCs on the one shared predicate', () => {
    const sql = code(MIGRATION);
    for (const { name } of GATED_RPCS) {
      const fn = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`));
      expect(fn, `${name} is not replaced by this migration`).toBeTruthy();
      const body = fn.slice(0, fn.indexOf('$fn$;') + 5);
      expect(body, `${name} does not consume crm_lead_access()`).toContain('public.crm_lead_access()');
      expect(body, `${name} does not raise 42501`).toContain("ERRCODE = '42501'");
    }
  });

  it('never reaches for billing_edit_access(), which would lock out crm_partner', () => {
    // 6 active crm_partner users work the desktop kanban, and it calls
    // get_pipeline_stages + move_lead_to_stage. billing_edit_access() is
    // {admin, office, project_manager} — it does not contain them.
    expect(code(MIGRATION)).not.toContain('billing_edit_access');
  });

  it('inlines no role literal — the predicate is the single definition', () => {
    const sql = code(MIGRATION);
    const guarded = GATED_RPCS.map(({ name }) => {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      return sql.slice(start, sql.indexOf('$fn$;', start));
    }).join('\n');
    for (const role of ['field_tech', 'crm_partner', 'estimator', 'supervisor', 'project_manager']) {
      expect(guarded, `a role literal '${role}' leaked into a gated body`).not.toContain(`'${role}'`);
    }
  });

  it('uses IS DISTINCT FROM for the service_role bypass, never <>', () => {
    const sql = code(MIGRATION);
    // auth.role() is NULL outside a PostgREST request, and `NULL <> 'x'` is NULL,
    // which PL/pgSQL's IF treats as false — silently skipping the guard.
    expect(sql).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(sql).not.toContain("auth.role() <> 'service_role'");
  });

  it('pins every live body it replaces with a drift guard', () => {
    const sql = code(MIGRATION);
    for (const [name, md5] of Object.entries(PINNED_MD5)) {
      expect(sql, `${name} has no pinned md5`).toContain(md5);
      expect(sql).toContain(`'${name}'`);
    }
  });

  it('revokes from PUBLIC and anon before granting, for every function it defines', () => {
    const sql = code(MIGRATION);
    const defined = [...GATED_RPCS, { name: 'crm_lead_access', args: '' }];
    for (const { name, args } of defined) {
      const revoke = `REVOKE EXECUTE ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon;`;
      const grant = `GRANT  EXECUTE ON FUNCTION public.${name}(${args}) TO authenticated;`;
      expect(sql, `${name} is missing its explicit revoke`).toContain(revoke);
      expect(sql, `${name} is missing its grant`).toContain(grant);
      // This managed project re-applies EXECUTE TO PUBLIC at ddl_command_end,
      // so the order is load-bearing (database-standard.md §1).
      expect(sql.indexOf(revoke)).toBeLessThan(sql.indexOf(grant));
    }
  });

  it('grants no browser role anything under the anon boundary', () => {
    const sql = code(MIGRATION);
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.lead_pipeline_stage FROM anon;/);
  });

  it('closes the always-true policies the RPC gate would otherwise sit on top of', () => {
    const sql = code(MIGRATION);
    // Without this the gate is theatre: a field tech could UPDATE
    // lead_pipeline_stage directly and move a lead with no history row.
    for (const table of ['lead_pipeline_stage', 'pipeline_stages', 'lead_stage_history']) {
      expect(sql, `${table}'s always-true policy is not dropped`)
        .toContain(`DROP POLICY IF EXISTS ${table}_all ON public.${table};`);
    }
    // What replaces them is SELECT-only, on the same predicate.
    expect(sql).toContain('CREATE POLICY lead_pipeline_stage_read ON public.lead_pipeline_stage');
    expect(sql).toContain('CREATE POLICY pipeline_stages_read ON public.pipeline_stages');
    expect(sql).toMatch(/FOR SELECT TO authenticated\s+USING \(public\.crm_lead_access\(\)\)/);
    // No new write policy for a browser role anywhere.
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]{0,200}FOR (ALL|INSERT|UPDATE|DELETE) TO authenticated/);
  });

  it('grants the two nav rows a project_manager needs, idempotently', () => {
    const sql = code(MIGRATION);
    expect(sql).toContain("('crm_leads', 'project_manager', true)");
    expect(sql).toContain("('crm_call_log', 'project_manager', true)");
    expect(sql).toContain('ON CONFLICT (nav_key, role) DO NOTHING');
    // Never an UPDATE — an existing explicit false is somebody's decision.
    expect(sql).not.toMatch(/nav_permissions[\s\S]{0,400}DO UPDATE/);
  });

  it('keeps every deployed signature and default callable', () => {
    const sql = code(MIGRATION);
    expect(sql).toContain('public.get_pipeline_stages(p_org_id uuid DEFAULT NULL::uuid)');
    expect(sql).toContain('p_moved_by uuid DEFAULT NULL::uuid');
    expect(sql).toContain('p_lost_reason text DEFAULT NULL::text');
    expect(sql).toContain('p_created_by uuid DEFAULT NULL::uuid');
    // Return shapes the deployed frontends read.
    expect(sql).toContain('RETURNS SETOF public.pipeline_stages');
    expect(sql).toContain('RETURNS public.lead_pipeline_stage');
    expect(sql).toContain('RETURNS SETOF json');
    for (const col of [
      'activity_type text', 'occurred_at timestamp with time zone',
      'title text', 'body text', 'meta jsonb',
    ]) {
      expect(sql, `get_lead_activity lost the ${col} column`).toContain(col);
    }
  });

  it('states the plpgsql row type rather than letting UNION resolution infer it', () => {
    const sql = code(MIGRATION);
    // The 20260807 near-miss: LANGUAGE sql assignment-casts at the result
    // boundary, plpgsql's RETURN QUERY does not.
    expect(sql).toContain("(CASE WHEN il.source_type = 'call' THEN 'Call' ELSE 'Web form' END)::text");
    expect(sql).toContain("('Moved to ' || ps.name)::text");
    expect(sql).toContain('t.title::text');
  });

  it('leaves get_inbound_leads alone', () => {
    // It already resolves the same nav keys; re-replacing it would be blast
    // radius for nothing, and the CRM owns it.
    expect(code(MIGRATION)).not.toContain('CREATE OR REPLACE FUNCTION public.get_inbound_leads');
  });

  it('is additive-only — no table, column or constraint DDL', () => {
    const sql = code(MIGRATION);
    expect(sql).not.toMatch(/\bDROP (TABLE|COLUMN|CONSTRAINT)\b/i);
    expect(sql).not.toMatch(/\bALTER TABLE\b/i);
    expect(sql).not.toMatch(/-- destructive-approved:/);
  });
});

describe('CRM lead read boundary — rollback contract', () => {
  it('restores all five bodies to the language they had', () => {
    const sql = code(ROLLBACK);
    for (const { name } of GATED_RPCS) {
      expect(sql, `${name} is not restored`).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    // Three were LANGUAGE sql before the boundary; if the rollback leaves them
    // plpgsql, re-applying the forward migration fails its own drift guard.
    expect(sql.match(/LANGUAGE sql/g) || []).toHaveLength(3);
    expect(sql.match(/LANGUAGE plpgsql/g) || []).toHaveLength(2);
    // No restored body may still reach for the predicate the rollback deletes —
    // the DROP at the end is the only legitimate mention.
    const bodies = [...sql.matchAll(/AS \$(\w*)\$([\s\S]*?)\$\1\$;/g)].map((m) => m[2]);
    expect(bodies).toHaveLength(5);
    for (const body of bodies) expect(body).not.toContain('crm_lead_access()');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.crm_lead_access();');
  });

  it('puts the three always-true policies back', () => {
    const sql = code(ROLLBACK);
    for (const table of ['lead_pipeline_stage', 'pipeline_stages', 'lead_stage_history']) {
      expect(sql).toContain(`CREATE POLICY ${table}_all ON public.${table}`);
    }
    expect(sql).toContain('FOR ALL TO authenticated USING (true) WITH CHECK (true)');
  });

  it('deliberately keeps the project_manager grant instead of silently revoking it', () => {
    const sql = code(ROLLBACK);
    expect(sql).not.toMatch(/DELETE FROM public\.nav_permissions/);
    // The hand-run statement is documented in the header, in a comment, on purpose.
    expect(read(ROLLBACK)).toContain('DELETE FROM public.nav_permissions');
  });

  it('runs as one transaction so a partial restore cannot half-gate the surface', () => {
    const sql = code(ROLLBACK);
    expect(sql.trim().startsWith('BEGIN;')).toBe(true);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  });
});
