// ════════════════════════════════════════════════
// FILE: scripts/migration-apply-tier.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Decides whether a database change is allowed to reach the real company
//   database on its own, or whether it has to stop and ask Moroni first.
//   Each change file says which of the two it is, and this checks that the
//   claim is honest — a file cannot claim "go ahead on your own" while doing
//   one of the three things our practice run on a throwaway database is
//   incapable of checking.
//
// WHY IT IS A SEPARATE MODULE:
//   check-migration-hygiene.mjs is a top-level runner that calls process.exit,
//   so importing it from a test would run the whole gate. The classification is
//   the part worth testing behaviourally, so it lives here and both the runner
//   and its test import it.
//
// DEPENDS ON:
//   Exports:  APPLY_TIER_AUTO, APPLY_TIER_OWNER_GATED, CAN_NOT_BE_AUTO,
//             declaredApplyTier(raw), autoTierBlockers(sql)
//   Data:     none — pure functions over SQL text.
//
// NOTES / GOTCHAS:
//   - `autoTierBlockers` expects COMMENT-STRIPPED sql (the caller owns that),
//     because a migration legitimately DISCUSSES the things it must not do.
//     Passing raw text will produce false positives on prose.
//   - Owner-directed 2026-08-20. The rule it encodes:
//       "if it's applied to the local database, and it works fine on the local
//        database and passes the reviewers too, go ahead and apply to
//        production" — bounded to the cases where the local database can
//        actually see the risk.
// ════════════════════════════════════════════════

export const APPLY_TIER_AUTO = 'auto';
export const APPLY_TIER_OWNER_GATED = 'owner-gated';

/**
 * Migrations whose version prefix is BEFORE this date predate the apply-tier
 * rule, carry no marker, and are therefore owner-gated by default — the safe
 * direction. They are not required to declare a tier retroactively.
 *
 * A DATE, deliberately, not a list of filenames. The first version of this
 * shipped as a committed filename snapshot and broke within the hour: a
 * parallel session merged `20260819010000_contractor_compliance_reviewer_supplied_dates.sql`,
 * authored before the rule existed but absent from a list captured before the
 * merge, and CI went red on dev for work that had done nothing wrong. A
 * snapshot cannot see other sessions' in-flight branches; a cutoff can.
 *
 * It is not a loophole: skipping the declaration means backdating a version
 * prefix, which collides with `migration-version-uniqueness` and is visible in
 * any review.
 */
export const APPLY_TIER_REQUIRED_FROM = '20260820';

/** True when this migration predates the rule and needs no declaration. */
export function applyTierExempt(filename) {
  const version = String(filename || '').match(/^(\d{8})/);
  return !version || version[1] < APPLY_TIER_REQUIRED_FROM;
}

/**
 * The three things a green local run does not prove, and therefore the three
 * things that can never be `-- apply-tier: auto`.
 *
 * Measured, not assumed:
 *   - db/baseline/schema.sql is SCHEMA ONLY — 141 tables, ZERO rows. That is
 *     enforced: db-baseline-refresh.mjs refuses a dump containing customer rows
 *     because the file is committed to a public repository. So anything whose
 *     risk lives in the DATA passes locally in milliseconds and proves nothing.
 *   - That same file contains ZERO `storage.` and `auth.` objects, so a
 *     migration touching them is tested against a hand-written reconstruction
 *     of the live catalog rather than the live catalog.
 *   - Destructive DDL is irreversible in the direction that matters.
 *
 * The honest way to shrink this list is to make the local stack able to SEE the
 * thing — seed volume data, carry the non-public schemas — not to relax it.
 */
export const CAN_NOT_BE_AUTO = [
  // 1. Data-touching. A bounded `INSERT ... VALUES` of literal rows is
  //    deliberately NOT here: it is verifiable by reading it, and config-row
  //    inserts are the routine case this tiering exists to stop asking about.
  [/\bUPDATE\s+[A-Za-z_"][\w".]*\s+SET\b/i, 'UPDATE ... SET (data change)'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM (data change)'],
  [/\bINSERT\s+INTO\b[\s\S]{0,600}?\bSELECT\b/i, 'INSERT ... SELECT (computed backfill)'],
  [/\bSET\s+NOT\s+NULL\b/i, 'SET NOT NULL (passes on an empty table, fails on real rows)'],
  [/\bADD\s+CONSTRAINT\b/i, 'ADD CONSTRAINT (real rows may violate it)'],
  [/\bCREATE\s+UNIQUE\s+INDEX\b/i, 'CREATE UNIQUE INDEX (real rows may collide)'],
  // 2. Outside the `public` schema — absent from the baseline entirely.
  [/\bstorage\.(objects|buckets)\b/i, 'storage.* (not in db/baseline/schema.sql)'],
  [/\bauth\.(users|identities|sessions)\b/i, 'auth.* (not in db/baseline/schema.sql)'],
  [/\bcron\.(schedule|unschedule|job)\b/i, 'cron.* (not in db/baseline/schema.sql)'],
  // 3. Destructive DDL. Restated from hygiene rule 4 on purpose, so `auto`
  //    cannot be combined with a `-- destructive-approved:` marker to slip one
  //    through: that marker records an owner review of the DROP, it does not
  //    make a local run able to see the rows being dropped.
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bALTER\s+TABLE\b[^;]*\bRENAME\b/i, 'ALTER TABLE ... RENAME'],
  [/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, 'ALTER COLUMN ... TYPE'],
];

/**
 * Read the declared tier from a migration's RAW text (comments intact — the
 * marker IS a comment).
 * @returns {{tier: string, reason: string|null}|null} null when undeclared,
 *   which callers must treat as owner-gated: silence is never permission.
 */
export function declaredApplyTier(raw) {
  const match = String(raw || '').match(/--\s*apply-tier:\s*(auto|owner-gated)\s*(?::\s*([^\n]*))?/i);
  if (!match) return null;
  const tier = match[1].toLowerCase();
  const reason = (match[2] || '').trim() || null;
  if (tier === APPLY_TIER_OWNER_GATED && !reason) {
    // A bare `owner-gated` with no reason is still owner-gated — it fails safe.
    // The missing reason is reported by the caller as a hygiene problem.
    return { tier, reason: null };
  }
  return { tier, reason };
}

/**
 * Which blind spots does this SQL hit? Empty array means `auto` is honest.
 * @param sql COMMENT-STRIPPED migration SQL.
 */
export function autoTierBlockers(sql) {
  return CAN_NOT_BE_AUTO.filter(([re]) => re.test(sql)).map(([, label]) => label);
}
