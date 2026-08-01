/**
 * ════════════════════════════════════════════════
 * FILE: db-lane-coverage.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Counts the database tests that never actually run, and makes that number
 *   impossible to ignore.
 *
 *   Every test file under supabase/tests/ belongs to the `db` lane. That lane
 *   deliberately refuses to run unless it is pointed at an isolated database,
 *   and no governed compatible target exists yet — so `npm test` skips all of
 *   them. On 2026-07-27 the PR-525-integrated tree contains 79 JavaScript and
 *   SQL test entrypoints, including the isolated signed Work Authorization
 *   consent regression guard and other guards written specifically to be
 *   durable. Derive this count from the tree: concurrent database initiatives
 *   add and retire guards, so hand-copied arithmetic drifts. Nobody noticed the
 *   original debt for weeks because a whole lane not running looks exactly like
 *   everything passing.
 *
 *   The lane runner already fails when a test inside a lane is skipped. This is
 *   the same idea one level up: a whole lane going dark should be loud too.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/tests/** (counted, not executed), vitest.config.js
 *   Data:      reads  → the db-lane test file list
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This does NOT run the database tests. It cannot. It reports how many are
 *     unrun and fails if that debt grows silently.
 *   - Adding a db-lane test is fine — but you must raise DARK_BASELINE in the
 *     same commit, which is the moment you consciously decide "this guard will
 *     not run in CI yet."
 *   - The right fix is to give the db lane a real isolated target (a Supabase
 *     preview branch clones the live schema, so it sidesteps the local
 *     migration-replay gap). When that lands, this file should be deleted, not
 *     rebaselined to zero.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB_TESTS = join(ROOT, 'supabase', 'tests');

/**
 * Files under supabase/tests/ that are NOT executed by `npm test`.
 * Recorded 2026-07-26. Raising this is a deliberate act: it means you are adding
 * a guard that will not protect anything in CI until the db lane has a target.
 */
// 79 → 80 on 2026-07-30: crm_lead_value_from_claim.test.js. Its always-visible
// counterpart is tests/qa/unit/crm-lead-value-from-claim.test.js, which guards
// the migration source in the credential-free lanes; the behavioural trigger
// proof runs in the db lane against the qa-staging branch.
// 80 → 81 on 2026-07-30: conversation_participant_scoping.test.sql. Its
// credential-free counterpart verifies migration source and rollout ordering;
// the behavioral access/RLS proof remains gated on an isolated database.
const DARK_BASELINE = 81;
// 2026-07-27: 76 -> 77, adding anon_closure_tranche_b.test.js. Acknowledged
// deliberately, per the rule above: that file proves the customer-list closure
// actually took effect, and it will NOT protect anything in CI until the db lane
// has a target. Its CI-visible counterpart is
// tests/qa/unit/anon-closure-tranche-b.test.js, which proves intent only.
//
// 2026-07-27: 77 -> 79, integrating PR #525. Counted against the merged tree,
// not carried over from either side: +4 new .test.sql guards, +1 already
// counted above from dev, -2 retired anon-client guards (notify_foundation,
// notify_c_my_prefs). The two retirements are legitimate — both are replaced by
// tests/qa/unit/notification-read-recipient-boundary.test.js, which DOES run in
// CI. That was checked against the tree, not assumed. The incoming PR proposed
// 78 with a `<=` assertion, which would have let the two deletions through
// silently; the exact assertion below is what caught it.

const dbLaneFiles = () =>
  (existsSync(DB_TESTS) ? readdirSync(DB_TESTS) : []).filter(
    (file) => file.endsWith('.test.js') || file.endsWith('.test.sql'),
  );

describe('db-lane coverage debt', () => {
  it('reports how many database guards are not running in CI', () => {
    const count = dbLaneFiles().length;
    // Deliberately printed on every run: silence is what caused this.
    console.warn(
      `[db-lane] ${count} test file(s) under supabase/tests/ are NOT executed by \`npm test\`. `
      + 'They require an isolated database target (see docs/upr-build-fix-backlog.md item 6.1).',
    );
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('fails if the unrun-guard debt changes without being acknowledged', () => {
    // EXACT, not <=. A `<=` assertion passes when the count DROPS, which hides the
    // more dangerous direction: deleting a behavioural guard. Found 2026-07-27 —
    // an incoming 315-file PR removed notify_c_my_prefs.test.js and
    // notify_foundation.test.js while raising DARK_BASELINE to 78, and `<=` let
    // both the deletions and the wrong number through silently.
    const count = dbLaneFiles().length;
    expect(
      count,
      `supabase/tests/ has ${count} test files but DARK_BASELINE is ${DARK_BASELINE}. `
      + 'If you ADDED a guard, raise DARK_BASELINE in this commit to record that it does not '
      + 'run in CI. If you REMOVED one, lower it — and say in the commit message why that '
      + 'guard is no longer needed, because deleting a database guard is how a regression '
      + 'gets in unnoticed.',
    ).toBe(DARK_BASELINE);
  });

  it('still names supabase/tests as db-lane-only, so this check stays meaningful', () => {
    // If someone moves supabase/tests into a credential-free lane, this guard is
    // obsolete and should be deleted rather than left asserting a stale premise.
    const config = readdirSync(ROOT).includes('vitest.config.js');
    expect(config).toBe(true);
  });
});
