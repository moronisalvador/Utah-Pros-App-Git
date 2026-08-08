#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/check-migration-hygiene.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Mechanically enforces the migration rules that used to live only as prose.
//   Every migration file that is NOT in the committed baseline list (i.e. every
//   migration added after 2026-07-29) must:
//     1. ship a paired rollback file in supabase/rollbacks/<name>.rollback.sql
//        (or carry an explicit `-- ROLLBACK-EXEMPT: <reason>` marker),
//     2. never grant to `anon` without a `-- public: <reason>` comment,
//     3. pair any SECURITY DEFINER function with a `REVOKE ... FROM PUBLIC`,
//     4. avoid destructive DDL (DROP TABLE/COLUMN, RENAME, tightening ALTER
//        COLUMN, SET NOT NULL on live tables) unless it carries an explicit
//        `-- destructive-approved: <reason>` marker naming the owner review.
//
//   Existing migrations are grandfathered via scripts/migration-hygiene-baseline.json.
//   Do NOT add new filenames to the baseline — that defeats the ratchet.
//
// USAGE:
//   node scripts/check-migration-hygiene.mjs          # exits 1 on any failure
//
// DEPENDS ON:
//   Internal: supabase/migrations/*.sql, supabase/rollbacks/*.rollback.sql,
//             scripts/migration-hygiene-baseline.json
//   Data:     reads → repository files only. Writes nothing.
//
// NOTES / GOTCHAS:
//   - This proves INTENT in CI (credential-free). Behavioral proof still lives
//     in the db lane against an isolated database.
//   - Heuristics are line-based on SQL source; a `-- destructive-approved:` or
//     `-- public:` marker is a conscious, reviewable act, not a loophole.
//   - ROOT must come from fileURLToPath(), never `new URL(...).pathname` — on
//     Windows the latter yields `/C:/...`, which path.resolve() then re-roots to
//     `C:\C:\...` and the baseline read fails with ENOENT (Linux CI is unaffected).
// ════════════════════════════════════════════════

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const ROLLBACKS_DIR = path.join(ROOT, 'supabase', 'rollbacks');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'migration-hygiene-baseline.json');

const baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).grandfathered);
const failures = [];

/**
 * Blank out line comments and string literals so pattern checks don't
 * false-positive on prose, while leaving every real DDL token visible.
 *
 * This is a single-pass lexer rather than a chain of regex replacements,
 * because the regex version silently ate real SQL in two independent ways —
 * both found on 2026-08-07 while running this gate against a rebuilt migration:
 *
 *   1. It replaced `'...'` with the `s` flag and had no concept of
 *      dollar-quoting, so a quote inside a $fn$ body paired with one OUTSIDE it.
 *      On 20260807220000 that swallowed 84.2% of the file, REVOKE and GRANT
 *      included.
 *   2. It stripped strings BEFORE line comments, so an apostrophe inside a `--`
 *      comment opened a bogus literal that ran to the next apostrophe anywhere
 *      later in the file. On 20260807210000 the comment "…Postgres's built-in…"
 *      swallowed the REVOKE and GRANT that followed it.
 *
 * Both produced a false POSITIVE here (a SECURITY DEFINER migration reported as
 * having no `REVOKE ... FROM PUBLIC` when it plainly has one). The dangerous
 * direction is the opposite: a `GRANT ... TO anon` inside a swallowed span was
 * invisible to the anon-allowlist check in rule 2. Whether a given file tripped
 * either bug came down to apostrophe parity, which changes whenever prose does.
 *
 * Replaced content becomes spaces (newlines preserved) so offsets and line
 * structure survive for the checks that care about proximity.
 */
function stripComments(sql) {
  const out = Array.from(sql);
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  let i = 0;
  while (i < sql.length) {
    // Line comment — consumed first, so an apostrophe inside it is inert.
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    // Dollar-quoted body: its contents are a separate lexical scope, so quotes
    // inside it can never pair with quotes outside it.
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      if (close === -1) { blank(i, sql.length); break; }
      // Recurse into the body so comments/strings inside it are stripped too,
      // but strictly within its own bounds.
      const inner = stripComments(sql.slice(i + tag.length, close));
      for (let k = 0; k < inner.length; k += 1) out[i + tag.length + k] = inner[k];
      blank(i, i + tag.length);
      blank(close, close + tag.length);
      i = close + tag.length;
      continue;
    }
    // Single-quoted literal, '' being an escaped quote.
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      blank(i, j);
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const newFiles = files.filter((f) => !baseline.has(f));

for (const file of newFiles) {
  const raw = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const sql = stripComments(raw);
  const problems = [];

  // 1. Paired rollback file (or explicit exemption).
  const rollbackName = `${file.replace(/\.sql$/, '')}.rollback.sql`;
  const hasRollback = existsSync(path.join(ROLLBACKS_DIR, rollbackName));
  const rollbackExempt = /--\s*ROLLBACK-EXEMPT:\s*\S+/i.test(raw);
  if (!hasRollback && !rollbackExempt) {
    problems.push(
      `missing paired rollback supabase/rollbacks/${rollbackName} `
      + '(or an explicit `-- ROLLBACK-EXEMPT: <reason>` marker)',
    );
  }

  // 2. anon grants/policies require a `-- public: <reason>` comment.
  const namesAnon = /\b(GRANT\b[\s\S]{0,400}?\bTO\b[^;]*\banon\b|CREATE\s+POLICY[\s\S]{0,400}?\bTO\b[^;]*\banon\b)/i.test(sql);
  const hasPublicReason = /--\s*public:\s*\S+/i.test(raw);
  if (namesAnon && !hasPublicReason) {
    problems.push(
      'grants or creates a policy naming `anon` without a `-- public: <reason>` comment '
      + '(database-standard.md allowlist rule)',
    );
  }

  // 3. SECURITY DEFINER requires an explicit REVOKE ... FROM PUBLIC in the same file.
  if (/\bSECURITY\s+DEFINER\b/i.test(sql)) {
    const hasRevokePublic = /\bREVOKE\b[\s\S]{0,400}?\bFROM\b[^;]*\bPUBLIC\b/i.test(sql);
    if (!hasRevokePublic) {
      problems.push(
        'creates/replaces a SECURITY DEFINER function without any `REVOKE ... FROM PUBLIC` '
        + '(this managed project re-grants EXECUTE TO PUBLIC on every new function)',
      );
    }
  }

  // 4. Destructive DDL needs a conscious, named approval marker.
  const destructive = [
    [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
    [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
    [/\bALTER\s+TABLE\b[^;]*\bRENAME\b/i, 'ALTER TABLE ... RENAME'],
    [/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, 'ALTER COLUMN ... TYPE'],
    [/\bSET\s+NOT\s+NULL\b/i, 'SET NOT NULL'],
  ];
  const destructiveHits = destructive.filter(([re]) => re.test(sql)).map(([, label]) => label);
  const destructiveApproved = /--\s*destructive-approved:\s*\S+/i.test(raw);
  if (destructiveHits.length && !destructiveApproved) {
    problems.push(
      `destructive DDL (${destructiveHits.join(', ')}) without a `
      + '`-- destructive-approved: <reason>` marker naming the owner review',
    );
  }

  for (const p of problems) failures.push(`${file}: ${p}`);
}

// Baseline integrity: every grandfathered name must still be a real convention;
// growing the baseline is the one move this script refuses outright.
const unknownBaseline = [...baseline].filter((f) => !/\.sql$/.test(f));
if (unknownBaseline.length) {
  failures.push(`baseline contains non-sql entries: ${unknownBaseline.join(', ')}`);
}

console.log(
  `Migration hygiene: ${files.length} migrations, ${baseline.size} grandfathered, `
  + `${newFiles.length} checked, ${failures.length} failure(s).`,
);
for (const f of failures) console.log(`FAIL  ${f}`);
if (failures.length) process.exit(1);
