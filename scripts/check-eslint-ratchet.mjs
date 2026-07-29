#!/usr/bin/env node
// ════════════════════════════════════════════════
// FILE: scripts/check-eslint-ratchet.mjs
// ════════════════════════════════════════════════
//
// WHAT THIS DOES (plain language):
//   Lints JavaScript files changed from a supplied Git base and blocks any
//   finding above the frozen, per-file/per-rule release baseline. Existing
//   findings may shrink but may never grow.
//
// USAGE:
//   node scripts/check-eslint-ratchet.mjs origin/main
//
// DEPENDS ON:
//   Internal: eslint.config.js, scripts/eslint-ratchet-baseline.json
//   Data:     reads → Git diff and repository files. Writes nothing.
//
// NOTES / GOTCHAS:
//   - The baseline records debt already present on dev at the first production
//     promotion after the blocking ratchet was enabled. Never raise it.
//   - Severity is part of each key, so promoting a warning to an error blocks.
// ════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'eslint-ratchet-baseline.json');

export function summarizeResults(results, root = ROOT) {
  const summary = {};

  for (const result of results) {
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    for (const message of result.messages) {
      const severity = message.severity === 2 ? 'error' : 'warning';
      const rule = message.ruleId || 'parser';
      const key = `${severity}:${rule}`;
      summary[file] ||= {};
      summary[file][key] = (summary[file][key] || 0) + 1;
    }
  }

  return summary;
}

export function compareSummaries(actual, baseline) {
  const failures = [];
  const opportunities = [];
  const files = new Set([...Object.keys(actual), ...Object.keys(baseline)]);

  for (const file of [...files].sort()) {
    const rules = new Set([
      ...Object.keys(actual[file] || {}),
      ...Object.keys(baseline[file] || {}),
    ]);
    for (const rule of [...rules].sort()) {
      const found = actual[file]?.[rule] || 0;
      const allowed = baseline[file]?.[rule] || 0;
      if (found > allowed) {
        failures.push(`${file} ${rule}: found ${found}, baseline ${allowed}`);
      } else if (found < allowed) {
        opportunities.push(`${file} ${rule}: found ${found}, baseline ${allowed}`);
      }
    }
  }

  return { failures, opportunities };
}

function gitChangedFiles(base) {
  const result = spawnSync(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      base,
      'HEAD',
      '--',
      '*.js',
      '*.jsx',
      ':(exclude).claude/workflows/**',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git diff failed with status ${result.status}`);
  }
  return result.stdout.trim().split('\n').filter(Boolean);
}

function lint(files) {
  if (!files.length) return [];
  const executable = path.join(ROOT, 'node_modules', '.bin', 'eslint');
  const result = spawnSync(executable, ['--format', 'json', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!result.stdout.trim()) {
    throw new Error(result.stderr.trim() || `eslint returned no report (status ${result.status})`);
  }
  return JSON.parse(result.stdout);
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error('usage: node scripts/check-eslint-ratchet.mjs <git-base>');

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).findings;
  const files = gitChangedFiles(base);
  const actual = summarizeResults(lint(files));
  const { failures, opportunities } = compareSummaries(actual, baseline);
  const findingCount = Object.values(actual)
    .flatMap((rules) => Object.values(rules))
    .reduce((sum, count) => sum + count, 0);

  console.log(
    `ESLint ratchet: ${files.length} changed JS/JSX file(s), `
    + `${findingCount} finding(s), ${failures.length} regression(s).`,
  );
  for (const opportunity of opportunities) console.log(`SHRINK  ${opportunity}`);
  for (const failure of failures) console.error(`FAIL    ${failure}`);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`ESLint ratchet refused: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
