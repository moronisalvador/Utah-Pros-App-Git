/**
 * ════════════════════════════════════════════════
 * FILE: estimate-create-rpc-billing-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the two routines which create a blank estimate still ask who is
 *   calling before they create anything, and that they ask the same question the
 *   rest of billing asks instead of keeping their own private list of job titles.
 *   It also checks that the "+ New" menu hides "New Estimate" from anyone the
 *   database would refuse, so nobody is offered a button that only ever errors.
 *   Reads source files as text; no database required.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260805020000_estimate_create_rpc_billing_boundary.sql
 *              supabase/rollbacks/20260805020000_estimate_create_rpc_billing_boundary.rollback.sql
 *              src/components/NewMenu.jsx, src/lib/claimUtils.js
 *   Data:      reads  → migration, rollback and application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot tell you the guard is actually
 *     installed on the live functions — only that the source still asks for it.
 *     Live proof is the apply-window postflight (database-standard.md §5).
 *   - The "no inlined role list" assertion is the point of this file. The whole
 *     reason this migration waited on 20260804120100 was to avoid a second copy
 *     of ('admin','office','project_manager') drifting out of sync with
 *     billing_edit_access(). A future edit that inlines one fails here.
 *   - Grant/guard assertions read comment-stripped SQL, so an explanatory
 *     `-- ... anon ...` comment cannot read as a real grant. Same pattern as
 *     billing-editor-role-boundary.test.js.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from this file's location rather than the working directory, so the
// test resolves the same way however the lane runner is invoked.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION_PATH = 'supabase/migrations/20260805020000_estimate_create_rpc_billing_boundary.sql';
const ROLLBACK_PATH = 'supabase/rollbacks/20260805020000_estimate_create_rpc_billing_boundary.rollback.sql';

const MIGRATION = read(MIGRATION_PATH);
const ROLLBACK = read(ROLLBACK_PATH);
const NEW_MENU = read('src/components/NewMenu.jsx');
const CLAIM_UTILS = read('src/lib/claimUtils.js');

const stripComments = (sql) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

const MIGRATION_CODE = stripComments(MIGRATION);
const ROLLBACK_CODE = stripComments(ROLLBACK);

const RPCS = ['create_estimate_for_contact', 'create_estimate_for_job'];

/** The executable body of one CREATE OR REPLACE FUNCTION block, by name. */
const bodyOf = (sql, name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} block not found`).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end, `${name} block not terminated`).toBeGreaterThan(start);
  return sql.slice(start, end);
};

describe('estimate-create RPCs enforce the billing boundary', () => {
  it.each(RPCS)('%s gates on billing_edit_access() before it inserts', (name) => {
    const body = bodyOf(MIGRATION_CODE, name);
    expect(body).toContain('NOT public.billing_edit_access()');
    expect(body).toContain("ERRCODE = '42501'");
    // The guard must precede the INSERT — a check that runs after the row is
    // written is not a check at all.
    expect(body.indexOf('billing_edit_access()')).toBeLessThan(body.indexOf('INSERT INTO estimates'));
  });

  it.each(RPCS)('%s lets the service role through so workers do not fail closed', (name) => {
    // billing_edit_access() resolves an employee from auth.uid(); a service-role
    // client has none. Same short-circuit the live 20260804120100 boundary uses.
    expect(bodyOf(MIGRATION_CODE, name)).toContain("auth.role() IS DISTINCT FROM 'service_role'");
  });

  it.each(RPCS)('%s compares the role NULL-safely so the guard cannot be skipped', (name) => {
    // auth.role() returns NULL outside a PostgREST request. With `<>` the whole
    // guard expression evaluates to NULL, which PL/pgSQL's IF treats as FALSE —
    // silently skipping the check and letting the INSERT through. Verified on the
    // live database: (NULL <> 'service_role') AND TRUE => NULL. IS DISTINCT FROM
    // yields TRUE there instead, so the call is refused. Never relax this back.
    const body = bodyOf(MIGRATION_CODE, name);
    expect(body).not.toMatch(/auth\.role\(\)\s*<>/);
    expect(body).not.toMatch(/auth\.role\(\)\s*!=/);
  });

  it('never inlines a second copy of the billing role list', () => {
    // The single source of truth is public.billing_edit_access(). A duplicated
    // role list here is exactly the drift this migration was sequenced to avoid.
    expect(MIGRATION_CODE).not.toMatch(/role::text\s+IN\s*\(/);
    for (const role of ['office', 'project_manager', 'estimator', 'supervisor', 'field_tech']) {
      expect(MIGRATION_CODE, `role literal '${role}' must not appear in executable SQL`)
        .not.toContain(`'${role}'`);
    }
  });

  it('does not redefine or re-grant billing_edit_access()', () => {
    // It is applied and owned by 20260804120100. Replacing its body from here
    // would silently fork the boundary.
    expect(MIGRATION_CODE).not.toContain('CREATE OR REPLACE FUNCTION public.billing_edit_access');
    expect(MIGRATION_CODE).not.toMatch(/GRANT[\s\S]{0,120}billing_edit_access/);
  });

  it.each(RPCS)('%s revokes PUBLIC and anon before granting', (name) => {
    const revoke = MIGRATION_CODE.indexOf(`REVOKE EXECUTE ON FUNCTION public.${name}(`);
    const grant = MIGRATION_CODE.indexOf(`GRANT EXECUTE ON FUNCTION public.${name}(`);
    expect(revoke, `${name} REVOKE missing`).toBeGreaterThan(-1);
    expect(grant, `${name} GRANT missing`).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
    expect(MIGRATION_CODE.slice(revoke, grant)).toContain('FROM PUBLIC, anon');
  });

  it('grants execute to nobody beyond authenticated and service_role', () => {
    const grants = MIGRATION_CODE.split('\n').filter((l) => l.startsWith('GRANT EXECUTE'));
    expect(grants).toHaveLength(RPCS.length);
    for (const g of grants) {
      expect(g).toContain('TO authenticated, service_role;');
      expect(g).not.toMatch(/\banon\b/);
    }
  });

  it('stays additive — no destructive DDL and no policy or table changes', () => {
    for (const forbidden of ['DROP TABLE', 'DROP COLUMN', 'ALTER COLUMN', 'RENAME', 'DROP POLICY', 'CREATE POLICY']) {
      expect(MIGRATION_CODE, `migration must not contain ${forbidden}`).not.toContain(forbidden);
    }
    expect(MIGRATION_CODE).not.toContain('DROP FUNCTION');
  });

  it.each(RPCS)('%s preserves its deployed signature and return shape', (name) => {
    // A changed parameter list or return type breaks the shipped caller
    // (database-standard.md §3). Both must survive in the migration AND the
    // rollback, so neither direction moves the frontend contract.
    for (const [label, sql] of [['migration', MIGRATION_CODE], ['rollback', ROLLBACK_CODE]]) {
      const body = bodyOf(sql, name);
      expect(body, `${label} ${name} return type`).toContain('RETURNS estimates');
      expect(body, `${label} ${name} definer posture`).toContain('SECURITY DEFINER');
      expect(body, `${label} ${name} pinned search_path`).toContain('SET search_path = public');
    }
    expect(bodyOf(MIGRATION_CODE, name).match(/DEFAULT/g)?.length)
      .toBe(bodyOf(ROLLBACK_CODE, name).match(/DEFAULT/g)?.length);
  });

  it('ships a rollback that restores the pre-migration bodies', () => {
    for (const name of RPCS) {
      const body = bodyOf(ROLLBACK_CODE, name);
      // The rollback deliberately RESTORES the unguarded body — that is the
      // prior state. If it kept the guard it would not be a rollback.
      expect(body).not.toContain('billing_edit_access()');
      expect(ROLLBACK_CODE).toContain(`REVOKE EXECUTE ON FUNCTION public.${name}(`);
    }
  });
});

describe('the desktop + New menu hides what the database will refuse', () => {
  it('gates New Estimate on canEditBilling, not only the feature flag', () => {
    const option = NEW_MENU.split('\n').find((l) => l.includes("key: 'estimate'"));
    expect(option, 'New Estimate option not found').toBeTruthy();
    expect(option).toContain("flag: 'page:estimates'");
    expect(option).toContain('billing: true');
  });

  it('still gates New Invoice the same way', () => {
    // Guards the 2026-08-04 fix against a regression while this file is nearby.
    const option = NEW_MENU.split('\n').find((l) => l.includes("key: 'invoice'"));
    expect(option).toContain('billing: true');
  });

  it('leaves New Job and New Customer ungated — they are not billing actions', () => {
    for (const key of ['job', 'customer']) {
      const option = NEW_MENU.split('\n').find((l) => l.includes(`key: '${key}'`));
      expect(option, `${key} option not found`).toBeTruthy();
      expect(option).not.toContain('billing: true');
    }
  });

  it('resolves the billing gate through the shared canEditBilling helper', () => {
    expect(NEW_MENU).toContain("import { canEditBilling } from '@/lib/claimUtils'");
    expect(NEW_MENU).toMatch(/!o\.billing \|\| canEditBilling\(/);
    // And that helper still reads the one shared constant rather than a literal.
    expect(CLAIM_UTILS).toMatch(/canEditBilling\s*=\s*\(role\)\s*=>\s*BILLING_EDIT_ROLES\.includes\(role\)/);
  });
});
