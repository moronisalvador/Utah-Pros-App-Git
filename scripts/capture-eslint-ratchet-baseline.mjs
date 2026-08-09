#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/capture-eslint-ratchet-baseline.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Lints the WHOLE repository and rewrites the frozen lint baseline that CI
//   checks pull requests against. Run this only when the owner has approved a
//   re-capture. It prints every count it would raise and refuses to write
//   unless you pass --allow-raise, so an accidental run can never quietly give
//   the codebase permission to hold more lint debt than it does today.
//
// USAGE:
//   node scripts/capture-eslint-ratchet-baseline.mjs            # dry run, prints the diff
//   node scripts/capture-eslint-ratchet-baseline.mjs --write    # write (shrink-only)
//   node scripts/capture-eslint-ratchet-baseline.mjs --write --allow-raise
//
// DEPENDS ON:
//   Internal: eslint.config.js, scripts/check-eslint-ratchet.mjs (summarizeResults)
//   Data:     reads → every linted file in the repo.
//             writes → scripts/eslint-ratchet-baseline.json (only with --write)
//
// NOTES / GOTCHAS:
//   - This lints `.` (the whole repo), NOT a git diff. The 2026-07-29 baseline
//     was captured from one promotion diff's changed-file set, so ~50 files with
//     pre-existing findings had no entry — and a file with no entry is allowed
//     ZERO, which blocked CI on debt the touching session never created.
//   - Scope is every file ESLint lints, not just src/. `upr-mcp/`,
//     `supabase/tests/` and friends are reachable by the ratchet's git-diff
//     filter too, so narrowing the capture to src/functions/scripts would leave
//     landmines behind.
//   - "Shrink only; never raise" is the standing rule. Raising any existing
//     count needs owner sign-off, which is what --allow-raise represents.
//     Re-deriving a LOWER count is not a raise — it is the shrink the rule
//     wants, and this script always records today's number.
// ════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeResults } from './check-eslint-ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'eslint-ratchet-baseline.json');

const write = process.argv.includes('--write');
const allowRaise = process.argv.includes('--allow-raise');

function lintRepo() {
  const executable = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const result = spawnSync(process.execPath, [executable, '--format', 'json', '.'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!result.stdout.trim()) {
    throw new Error(result.stderr.trim() || `eslint returned no report (status ${result.status})`);
  }
  return JSON.parse(result.stdout);
}

// Sorted output so a re-capture produces a reviewable, minimal diff.
function sortFindings(summary) {
  const out = {};
  for (const file of Object.keys(summary).sort()) {
    out[file] = Object.fromEntries(Object.entries(summary[file]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

const doc = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const previous = doc.findings;
const captured = sortFindings(summarizeResults(lintRepo(), ROOT));

const raises = [];
const shrinks = [];
const added = [];
for (const [file, rules] of Object.entries(captured)) {
  if (!previous[file]) { added.push(file); continue; }
  for (const [rule, count] of Object.entries(rules)) {
    const was = previous[file][rule] || 0;
    if (count > was) raises.push(`${file} ${rule}: ${was} → ${count}`);
    else if (count < was) shrinks.push(`${file} ${rule}: ${was} → ${count}`);
  }
}
const removed = Object.keys(previous).filter((f) => !captured[f]);

const total = (m) => Object.values(m).flatMap((r) => Object.values(r)).reduce((a, c) => a + c, 0);
console.log(`previous: ${Object.keys(previous).length} file(s) / ${total(previous)} finding(s)`);
console.log(`captured: ${Object.keys(captured).length} file(s) / ${total(captured)} finding(s)`);
console.log(`\nnewly recorded files: ${added.length}`);
console.log(`files now clean (dropped): ${removed.length}`);
for (const r of removed) console.log(`  CLEAN   ${r}`);
for (const s of shrinks) console.log(`  SHRINK  ${s}`);
for (const r of raises) console.error(`  RAISE   ${r}`);

if (raises.length && !allowRaise) {
  console.error(
    `\nRefusing to write: ${raises.length} existing count(s) would be RAISED.`
    + ' The baseline is shrink-only — fix the regression, or re-run with --allow-raise'
    + ' if the owner has signed off.',
  );
  process.exitCode = 1;
} else if (write) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ ...doc, findings: captured }, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, BASELINE_PATH)}.`);
} else {
  console.log('\nDry run — pass --write to update the baseline.');
}
