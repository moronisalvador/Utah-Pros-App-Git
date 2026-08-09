#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/capture-eslint-ratchet-baseline.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Lints the WHOLE repository and rewrites the frozen lint baseline that CI
//   checks pull requests against. Run this only when the owner has approved a
//   re-capture. It prints everything it would let the codebase get away with
//   and refuses to write unless you pass --allow-raise, so an accidental run
//   can never quietly give the repository permission to hold more lint debt
//   than it does today. Shrinking never needs the flag.
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
//   - "Shrink only; never raise" is the standing rule. BOTH raising a recorded
//     count and giving an unrecorded file its first entry are expansions, and
//     both need owner sign-off — that is what --allow-raise represents. A file
//     with no entry is pinned at zero by check-eslint-ratchet.mjs, so adding it
//     is a raise off zero even though no recorded number moved.
//     Re-deriving a LOWER count is not a raise — it is the shrink the rule
//     wants, and this script always records today's number, no flag needed.
// ════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
export function sortFindings(summary) {
  const out = {};
  for (const file of Object.keys(summary).sort()) {
    out[file] = Object.fromEntries(Object.entries(summary[file]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

// An "expansion" is any change that lets the repository hold MORE debt than the
// baseline currently permits. Two shapes qualify, and both need owner sign-off:
//   - a recorded count going up;
//   - a file gaining an entry at all. `check-eslint-ratchet.mjs` resolves a missing
//     entry to `allowed = 0`, so an unrecorded file is not "unknown" — it is pinned
//     at zero. Adding it moves that pin off zero, which is a raise in every sense
//     that matters, even though no recorded number changed.
// Treating only the first shape as a raise is how an accidental --write could
// silently freeze brand-new debt in any file the baseline does not yet name.
export function diffBaselines(previous, captured) {
  const raises = [];
  const shrinks = [];
  const added = [];
  for (const [file, rules] of Object.entries(captured)) {
    if (!previous[file]) {
      const count = Object.values(rules).reduce((a, c) => a + c, 0);
      added.push(`${file}: 0 → ${count} finding(s) across ${Object.keys(rules).length} rule(s)`);
      continue;
    }
    for (const rule of [...new Set([...Object.keys(rules), ...Object.keys(previous[file])])].sort()) {
      const was = previous[file][rule] || 0;
      const count = rules[rule] || 0;
      if (count > was) raises.push(`${file} ${rule}: ${was} → ${count}`);
      else if (count < was) shrinks.push(`${file} ${rule}: ${was} → ${count}`);
    }
  }
  const removed = Object.keys(previous).filter((f) => !captured[f]);
  return { raises, shrinks, added, removed, expansions: raises.length + added.length };
}

function main() {
  const doc = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const previous = doc.findings;
  const captured = sortFindings(summarizeResults(lintRepo(), ROOT));
  const { raises, shrinks, added, removed, expansions } = diffBaselines(previous, captured);

  const total = (m) => Object.values(m).flatMap((r) => Object.values(r)).reduce((a, c) => a + c, 0);
  console.log(`previous: ${Object.keys(previous).length} file(s) / ${total(previous)} finding(s)`);
  console.log(`captured: ${Object.keys(captured).length} file(s) / ${total(captured)} finding(s)`);
  console.log(`\nfiles now clean (dropped): ${removed.length}`);
  for (const r of removed) console.log(`  CLEAN   ${r}`);
  for (const s of shrinks) console.log(`  SHRINK  ${s}`);
  console.log(`\nexpansions (need --allow-raise): ${expansions}`);
  for (const a of added) console.error(`  ADD     ${a}`);
  for (const r of raises) console.error(`  RAISE   ${r}`);

  if (expansions && !allowRaise) {
    console.error(
      `\nRefusing to write: ${raises.length} recorded count(s) would be RAISED and`
      + ` ${added.length} unrecorded file(s) would gain an entry (each currently pinned at zero).`
      + ' The baseline is shrink-only — fix the finding, or re-run with --allow-raise'
      + ' if the owner has signed off on freezing it.',
    );
    process.exitCode = 1;
  } else if (write) {
    // Stamp the real capture date. Carrying the previous value forward is how the
    // 2026-07-29 stamp survived a re-capture and kept describing a measurement that
    // had been replaced — a stale provenance field is worse than no field, because
    // it is read as evidence.
    const capturedAt = new Date().toISOString().slice(0, 10);
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ ...doc, capturedAt, findings: captured }, null, 2)}\n`,
    );
    console.log(`\nWrote ${path.relative(ROOT, BASELINE_PATH)} (capturedAt ${capturedAt}).`);
  } else {
    console.log('\nDry run — pass --write to update the baseline.');
  }
}

// Only lint-and-compare when run directly; importing this module (for tests)
// must never shell out to a full-repo ESLint pass.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
