/**
 * ════════════════════════════════════════════════
 * FILE: oop-convert-estimate-billing-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the routine which turns an out-of-pocket price quote into a real
 *   estimate asks the same "are you allowed to do billing?" question the rest of
 *   billing asks, instead of keeping its own private list of job titles. It also
 *   checks that the screen showing the button and the database behind it agree,
 *   so nobody is offered a button that only ever errors — and that the separate
 *   correction screen stays admin-only on purpose. Reads source files as text;
 *   no database required.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260807220000_oop_convert_estimate_billing_boundary.sql
 *              supabase/rollbacks/20260807220000_oop_convert_estimate_billing_boundary.rollback.sql
 *              supabase/migrations/20260803192344_oop_quote_to_estimate.sql
 *              src/components/oop/ConfiguredOopPricingCalculator.jsx, src/lib/claimUtils.js
 *   Data:      reads  → migration, rollback and application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot tell you the guard is installed
 *     on the live function — only that the source still asks for it. Live proof
 *     is supabase/tests/oop_convert_estimate_billing_boundary.test.sql plus the
 *     apply-window postflight (database-standard.md §5).
 *   - The "no inlined role list" assertion is the point of this file, same as
 *     the sibling estimate-create test: a second copy of
 *     ('admin','office','project_manager') is exactly what drifts.
 *   - The apply-order case is real, not hypothetical. 20260807190000
 *     (oop_estimate_grouped_lines) replaces this same function body, so the
 *     drift guard is what stops one migration silently reverting the other.
 *   - Grant/guard assertions read comment-stripped SQL, so an explanatory
 *     `-- ... anon ...` comment cannot read as a real grant.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION_PATH = 'supabase/migrations/20260807220000_oop_convert_estimate_billing_boundary.sql';
const ROLLBACK_PATH = 'supabase/rollbacks/20260807220000_oop_convert_estimate_billing_boundary.rollback.sql';

const MIGRATION = read(MIGRATION_PATH);
const ROLLBACK = read(ROLLBACK_PATH);
const PREDECESSOR = read('supabase/migrations/20260803192344_oop_quote_to_estimate.sql');
const CALCULATOR = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
const PROOF = read('supabase/tests/oop_convert_estimate_billing_boundary.test.sql');

const stripComments = (sql) =>
  sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const MIGRATION_CODE = stripComments(MIGRATION);
const ROLLBACK_CODE = stripComments(ROLLBACK);

/** The executable body of the one CREATE OR REPLACE FUNCTION block. */
const bodyOf = (sql) => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(');
  expect(start, 'convert_oop_quote_to_estimate block not found').toBeGreaterThan(-1);
  const open = sql.indexOf('AS $function$', start);
  const end = sql.indexOf('$function$;', open + 1);
  expect(end, 'function block not terminated').toBeGreaterThan(open);
  return sql.slice(open, end);
};

describe('OOP convert-to-estimate billing boundary', () => {
  it('gates the RPC on the shared billing predicate', () => {
    const body = bodyOf(MIGRATION_CODE);
    expect(body).toContain('IF NOT public.billing_edit_access() THEN');
    expect(body).toContain("USING ERRCODE = '42501'");
    // The guard must precede the estimate INSERT, or a refused call could still
    // consume an estimate number.
    expect(body.indexOf('billing_edit_access()'))
      .toBeLessThan(body.indexOf('INSERT INTO public.estimates'));
  });

  it('never inlines a second copy of the billing role list', () => {
    const body = bodyOf(MIGRATION_CODE);
    // billing_edit_access() is the ONLY place the role list may live. A future
    // edit that pastes the roles back in fails here.
    for (const role of ['admin', 'office', 'project_manager', 'manager']) {
      expect(body, `role literal '${role}' was inlined instead of calling billing_edit_access()`)
        .not.toContain(`'${role}'`);
    }
  });

  it('preserves the deployed function contract exactly', () => {
    expect(MIGRATION_CODE).toContain('CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(p_quote_id uuid)');
    expect(MIGRATION_CODE).toContain('RETURNS jsonb');
    expect(MIGRATION_CODE).toContain('SECURITY DEFINER');
    expect(MIGRATION_CODE).toContain("SET search_path TO ''");
    // Signature, return type and posture must match the predecessor it replaces.
    expect(PREDECESSOR).toContain('CREATE OR REPLACE FUNCTION public.convert_oop_quote_to_estimate(p_quote_id uuid)');
  });

  it('keeps the RPC browser-only: authenticated yes, anon and service_role no', () => {
    expect(MIGRATION_CODE).toContain(
      'REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid)\n  FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(MIGRATION_CODE).toContain('GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid) TO authenticated;');
    expect(MIGRATION_CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.convert_oop_quote_to_estimate\(uuid\)[^;]*anon/);
    expect(MIGRATION_CODE).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.convert_oop_quote_to_estimate\(uuid\)[^;]*service_role/);
    // The revoke must come before the grant — this managed project re-applies
    // EXECUTE TO PUBLIC on every replaced function (database-standard.md §1).
    expect(MIGRATION_CODE.indexOf('REVOKE EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate'))
      .toBeLessThan(MIGRATION_CODE.indexOf('GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate'));
  });

  it('has no auth.role() comparison to get NULL-wrong', () => {
    const body = bodyOf(MIGRATION_CODE);
    // billing_edit_access() returns EXISTS(...), never NULL, so NOT <predicate>
    // cannot be silently skipped by PL/pgSQL's IF. If a future edit DOES add an
    // auth.role() comparison here, it must use the NULL-safe form.
    if (body.includes('auth.role()')) {
      expect(body, "an auth.role() comparison must use IS DISTINCT FROM, never <>")
        .toContain("auth.role() IS DISTINCT FROM");
      expect(body).not.toMatch(/auth\.role\(\)\s*<>/);
    }
  });

  it('refuses to apply onto an unexpected body (the grouped-lines collision)', () => {
    // 20260807190000_oop_estimate_grouped_lines replaces this same function.
    // Without a whole-body fingerprint, whichever applies last silently wins.
    expect(MIGRATION_CODE).toContain('md5(v_src)');
    expect(MIGRATION_CODE).toMatch(/v_md5 <> '[0-9a-f]{32}'/);
    expect(MIGRATION_CODE).toContain("USING ERRCODE = '55000'");
    expect(MIGRATION).toContain('20260807190000_oop_estimate_grouped_lines');
    // Applying twice must be refused rather than silently re-running.
    expect(MIGRATION_CODE).toContain("v_src LIKE '%billing_edit_access()%'");
  });

  it('ships a rollback that genuinely re-narrows and is itself guarded', () => {
    const body = bodyOf(ROLLBACK_CODE);
    expect(body).toContain("v_role NOT IN ('admin','manager')");
    expect(body).not.toContain('billing_edit_access()');
    // The rollback restores the grants identically — it must not widen them.
    expect(ROLLBACK_CODE).toContain('GRANT EXECUTE ON FUNCTION public.convert_oop_quote_to_estimate(uuid) TO authenticated;');
    // And it refuses to run unless the migration is actually the live body.
    expect(ROLLBACK_CODE).toMatch(/v_md5 <> '[0-9a-f]{32}'/);
  });

  it('restores the predecessor body byte-for-byte', () => {
    // The rollback body must BE the applied 20260803192344 text, not a retyped
    // approximation of it (database-standard.md §5).
    expect(bodyOf(ROLLBACK)).toBe(bodyOf(PREDECESSOR));
  });

  it('changes nothing but the gate', () => {
    // Every other statement in the replacement must be identical to the
    // predecessor: the lock, the idempotent re-entry, the snapshot requirement,
    // the line flattening, the total reconciliation and the provenance markers.
    const normalize = (s) =>
      s
        .replace(/ {2}v_role text;\n/, '')
        .replace(/ {2}SELECT e\.role::text[\s\S]*?END IF;\n/, '<<GATE>>')
        .replace(/ {2}IF NOT public\.billing_edit_access\(\)[\s\S]*?END IF;\n/, '<<GATE>>');
    expect(normalize(bodyOf(MIGRATION))).toBe(normalize(bodyOf(PREDECESSOR)));
  });

  it('agrees with the button the calculator already renders', () => {
    // The UI was right and the database was wrong: canConvertToEstimate gates on
    // canEditBilling, i.e. exactly billing_edit_access()'s role list. This test
    // fails if a future edit moves the UI off the shared helper.
    expect(CALCULATOR).toContain('canEditBilling(employee?.role)');
    expect(CALCULATOR).toContain("import { canEditBilling } from '@/lib/claimUtils'");
    expect(CALCULATOR).toContain("db.rpc('convert_oop_quote_to_estimate'");
  });

  it('proves every live role in both directions', () => {
    // database-standard.md §5b: per-role ALLOW *and* DENY, including the roles
    // the change is not about.
    for (const role of ['admin', 'office', 'project_manager', 'supervisor',
      'estimator', 'field_tech', 'crm_partner']) {
      expect(PROOF, `role ${role} is not exercised by the behavioural proof`).toContain(role);
    }
    expect(PROOF).toContain('inactive_admin');
    expect(PROOF).toContain('external_admin');
    expect(PROOF).toContain('claimless');
  });

  it('does not manufacture the legacy flattened JWT claim', () => {
    // The QBO receipt db-lane test passed for days against a gate production
    // could never satisfy, because it set request.jwt.claim.role itself. This
    // proof must use the modern claims object only, and assert the legacy name
    // stays empty.
    expect(PROOF).toContain("set_config('request.jwt.claims'");
    expect(PROOF).toContain('assert_modern_claims_only');
    expect(PROOF).not.toMatch(/set_config\('request\.jwt\.claim\.(sub|role)'/);
  });
});
