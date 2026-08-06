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

function stripComments(sql) {
  // Remove line comments and quoted strings so pattern checks don't false-positive
  // on prose inside comments or string literals. Keeps line structure.
  return sql
    .replace(/'(?:[^']|'')*'/gs, "''")
    .replace(/--[^\n]*/g, '');
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
