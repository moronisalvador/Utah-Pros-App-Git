/**
 * ════════════════════════════════════════════════
 * FILE: db-proof-harness-hygiene.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the database proof files for four mistakes that have each already
 *   shipped here at least once — mistakes that make a test LOOK like it proves
 *   something when it cannot. Every one of them was found by a human or a real
 *   database run, never by a checker, because the existing checks read SQL as
 *   text and none of them run it. This file turns each past incident into a rule
 *   so it cannot come back quietly.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/tests/*.sql, scripts/qa/db-proof-harness-baseline.json
 *   Data:      reads  → local source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - SHRINK-ONLY, like the eslint changed-files ratchet and the db-lane setup
 *     debt. Known offenders are listed in the baseline so this can land without a
 *     risky sweep across several active leases' proof files. Two assertions hold
 *     the ratchet: a NEW violation fails, and a baseline entry that no longer
 *     violates ALSO fails, so the list can only ever get shorter.
 *   - Scans COMMENT-STRIPPED SQL. A file explaining why a pattern is wrong must
 *     not be flagged for naming it — the same trap that made the first version of
 *     billing-role-surface-parity's no-inlined-roles check fail on the migration
 *     whose whole job was asserting those roles are absent.
 *   - This proves the harness is not hollow. It does NOT prove the harness is
 *     correct — only executing it does that.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB_TESTS = join(ROOT, 'supabase', 'tests');
const BASELINE = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'qa', 'db-proof-harness-baseline.json'), 'utf8'),
);

/** Strip `-- line` and block comments so prose about a pattern is not a use of it. */
const stripSql = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');

const FILES = readdirSync(DB_TESTS).filter((f) => f.endsWith('.sql')).sort();
const code = Object.fromEntries(
  FILES.map((f) => [f, stripSql(readFileSync(join(DB_TESTS, f), 'utf8'))]),
);

/**
 * A file that establishes an actor identity and runs assertions against a
 * disposable database. `_preflight`/`_post_apply` files deliberately run
 * read-only against a live target and are out of scope for the isolation rule.
 */
const isIsolatedProof = (f) => f.endsWith('.test.sql') || f.endsWith('_isolated.sql');

const RULES = {
  // The QBO receipt incident (2026-08-05): the db-lane test set
  // request.jwt.claim.role itself, manufacturing the one signal production never
  // sends, so it passed against a gate that could never pass in production.
  // PostgREST sends request.jwt.claims; the flattened GUCs are legacy.
  legacyJwtClaim: (src) => /set_config\(\s*'request\.jwt\.claim\.(sub|role)'/.test(src),

  // Found 2026-08-07: an isolation guard keyed on current_database() cannot
  // discriminate. EVERY Supabase database is named `postgres`, including the
  // shared production project, so the check blocks the disposable stack and
  // protects nothing. The upr.isolated_test_database GUC is the real boundary.
  databaseNameGuard: (src) => /current_database\(\)/.test(src),

  // Found 2026-08-05 (estimate-create) and again 2026-08-07 (OOP convert): a
  // fixture that UPDATEs ambient state silently no-ops on a clean clone, and the
  // proof then "passes" or denies everyone for the wrong reason. Seed it.
  assumedFeatureFlag: (src) =>
    /UPDATE\s+public\.feature_flags/i.test(src)
    && !/INSERT\s+INTO\s+public\.feature_flags/i.test(src),

  // A proof with no isolation guard can be pointed at the shared project.
  missingIsolationGuard: (src) => !/upr\.isolated_test_database/.test(src),
};

const violations = (rule) =>
  FILES.filter((f) => (rule === 'missingIsolationGuard' ? isIsolatedProof(f) : true))
    .filter((f) => RULES[rule](code[f]))
    .sort();

describe('database proof-harness hygiene (shrink-only)', () => {
  for (const rule of Object.keys(RULES)) {
    it(`no NEW ${rule} violations`, () => {
      const now = violations(rule);
      const known = new Set(BASELINE[rule] ?? []);
      const added = now.filter((f) => !known.has(f));
      expect(
        added,
        `New ${rule} violation(s). See the rule comment in this file for why it is unsafe. `
        + 'Fix the proof rather than adding it to scripts/qa/db-proof-harness-baseline.json.',
      ).toEqual([]);
    });

    it(`the ${rule} baseline has no stale entries`, () => {
      const now = new Set(violations(rule));
      const stale = (BASELINE[rule] ?? []).filter((f) => !now.has(f));
      expect(
        stale,
        `These files no longer violate ${rule} — remove them from `
        + 'scripts/qa/db-proof-harness-baseline.json so the list can only shrink.',
      ).toEqual([]);
    });
  }

  it('this session\'s own proof is clean on every rule', () => {
    // The file written alongside these rules must not itself be grandfathered.
    const mine = 'oop_convert_estimate_billing_boundary.test.sql';
    expect(FILES).toContain(mine);
    for (const rule of Object.keys(RULES)) {
      expect(RULES[rule](code[mine]), `${mine} violates ${rule}`).toBe(false);
    }
  });
});
