/**
 * ════════════════════════════════════════════════
 * FILE: office-financial-read-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the migration that stops non-billing staff from pulling company money
 *   numbers out of the database, and checks it actually says what it claims to:
 *   every one of the six reports gets a permission check, none of them lose their
 *   shape, and the undo file puts all six back exactly as they were.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  supabase/migrations/20260807230000_office_financial_read_boundary.sql
 *              + its paired rollback
 *   Data:      reads → repository source only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It runs in the credential-free `qa` lane and
 *     never touches a database. The behavioural proof (per-role ALLOW/DENY on a
 *     disposable local stack, database-standard.md §5b) is a separate, required
 *     gate before this migration may be applied.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => readFileSync(path.join(repositoryRoot, relative), 'utf8');

const SLUG = '20260807230000_office_financial_read_boundary';
const migration = read(`supabase/migrations/${SLUG}.sql`);
const rollback = read(`supabase/rollbacks/${SLUG}.rollback.sql`);

// Counting assertions run against EXECUTABLE SQL only. Both files document their
// own reasoning at length, and those comments legitimately quote the very strings
// being counted ("SECURITY DEFINER", the service_role guard) — matching the raw
// file counts the prose too and makes the test lie about the SQL.
const stripComments = (sql) => sql.replace(/^\s*--.*$/gm, '');
const migrationSql = stripComments(migration);
const rollbackSql = stripComments(rollback);

// The six the migration guards, with the identity args its REVOKE/GRANT must name.
const GUARDED = [
  ['get_ar_invoices', '()'],
  ['get_payments_ledger', '(integer)'],
  ['get_payments_received', '(date, date)'],
  ['get_avg_ticket', '(date, date)'],
  ['get_revenue_by_division', '(date, date)'],
  ['get_pipeline_summary', '()'],
];

describe('office financial read boundary — migration source contract', () => {
  it('guards all six money/pipeline reports and no others', () => {
    for (const [fn] of GUARDED) {
      expect(migration, fn).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
    const replaced = [...migrationSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)]
      .map((m) => m[1]);
    expect([...new Set(replaced)].sort()).toEqual(GUARDED.map(([f]) => f).sort());
  });

  it('gives every guarded function one billing_edit_access() check that RAISEs 42501', () => {
    const guards = migrationSql.match(/IF auth\.role\(\) IS DISTINCT FROM 'service_role'/g) || [];
    expect(guards).toHaveLength(GUARDED.length);
    const raises = migrationSql.match(/ERRCODE = '42501'/g) || [];
    expect(raises).toHaveLength(GUARDED.length);
    const predicate = migrationSql.match(/NOT public\.billing_edit_access\(\)/g) || [];
    expect(predicate).toHaveLength(GUARDED.length);
  });

  it('consumes billing_edit_access() rather than inlining a second role list', () => {
    // The repository already paid for a duplicated role list once (payout had to be
    // split back out of billing). A literal list here would be that mistake again.
    expect(migrationSql).not.toMatch(/'admin'\s*,\s*'office'\s*,\s*'project_manager'/);
    expect(migration).toContain('public.billing_edit_access()');
  });

  it('uses IS DISTINCT FROM, never a bare <>, on the service_role check', () => {
    // auth.role() is NULL outside a PostgREST request; `NULL <> 'service_role'` is
    // NULL, and PL/pgSQL's IF treats NULL as false — silently skipping the guard.
    expect(migrationSql).not.toMatch(/auth\.role\(\)\s*<>\s*'service_role'/);
    expect(migration).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  });

  it('keeps every function SECURITY DEFINER with a pinned search_path', () => {
    const definer = migrationSql.match(/SECURITY DEFINER/g) || [];
    expect(definer).toHaveLength(GUARDED.length);
    const pinned = migrationSql.match(/SET search_path = public/g) || [];
    expect(pinned).toHaveLength(GUARDED.length);
  });

  it('revokes PUBLIC and anon immediately before each GRANT', () => {
    for (const [fn, args] of GUARDED) {
      const revoke = `REVOKE EXECUTE ON FUNCTION public.${fn}${args} FROM PUBLIC, anon;`;
      const grant = `GRANT  EXECUTE ON FUNCTION public.${fn}${args} TO authenticated;`;
      expect(migration, fn).toContain(revoke);
      expect(migration, fn).toContain(grant);
      expect(migration.indexOf(revoke), fn).toBeLessThan(migration.indexOf(grant));
    }
  });

  it('never grants anon and never widens beyond authenticated', () => {
    expect(migrationSql).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/);
    expect(migrationSql).not.toMatch(/GRANT[^;]*TO[^;]*\bPUBLIC\b/);
  });

  it('touches no table, policy, trigger, column or row', () => {
    for (const forbidden of [
      /\bDROP\s+TABLE\b/i, /\bALTER\s+TABLE\b/i, /\bCREATE\s+TABLE\b/i,
      /\bCREATE\s+POLICY\b/i, /\bDROP\s+POLICY\b/i, /\bCREATE\s+TRIGGER\b/i,
      /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    ]) {
      expect(migrationSql, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('adds no top-level transaction (the migration executor owns it)', () => {
    // database-standard.md §5 — a BEGIN/COMMIT here fights the executor's own
    // transaction, which also carries the schema_migrations ledger write.
    expect(migrationSql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
  });

  it('leaves get_insurance_carriers alone — a field tech needs it', () => {
    // src/pages/tech/TechNewJob.jsx calls it to create a job.
    expect(migrationSql).not.toContain('FUNCTION public.get_insurance_carriers');
  });

  it('leaves the supervisor/estimator ops reads alone', () => {
    // Every role except field_tech and crm_partner lands on the office Dashboard,
    // and get_tech_status_board additionally backs TimeTracking's Status Board for
    // supervisors. Gating these to the billing three would lock them out.
    for (const fn of [
      'get_tech_status_board', 'get_active_drying_jobs', 'get_dashboard_action_items',
      'get_jobs_closed', 'get_jobs_completed', 'get_open_estimates_summary',
    ]) {
      expect(migrationSql, fn).not.toContain(`FUNCTION public.${fn}`);
    }
  });
});

describe('office financial read boundary — rollback contract', () => {
  it('restores all six, and genuinely removes the guard', () => {
    for (const [fn] of GUARDED) {
      expect(rollback, fn).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
    expect(rollbackSql).not.toContain('billing_edit_access');
    expect(rollbackSql).not.toContain('42501');
  });

  it('returns each function to LANGUAGE sql', () => {
    const sqlLang = rollbackSql.match(/LANGUAGE sql/g) || [];
    expect(sqlLang).toHaveLength(GUARDED.length);
    expect(rollbackSql).not.toMatch(/LANGUAGE plpgsql/);
  });

  it('records the pre-migration body md5s so the restore is checkable', () => {
    for (const md5 of [
      '67f652d7b8159b24c9d4233008f97b2f', 'a7004cec5395335cb1ecdf0526fb5d29',
      'ed4b89f59aaa48a80abd3be794d27117', '706571ee4ad29f8b95139ea584330af3',
      '56959316aa6902d44dcac8945d00ff9e', 'cf692bf18799d374a1cd54f6c4c807de',
    ]) {
      expect(rollback, md5).toContain(md5);
    }
  });

  it('states plainly that rolling back re-opens the gap', () => {
    expect(rollback).toMatch(/RE-OPENS/);
  });
});
