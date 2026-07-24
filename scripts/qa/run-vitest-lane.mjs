/**
 * ════════════════════════════════════════════════
 * FILE: run-vitest-lane.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs one credential-free Vitest partition with provider settings removed. It fails if the lane
 *   discovers no tests or reports any skipped or pending test, so a partial green run is visible.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins, vitest
 *   Internal:  scripts/qa/safe-child-env.mjs, vitest.config.js
 *   Data:      reads  → selected test source
 *              writes → one short-lived machine-readable report in the system temporary folder
 *
 * NOTES / GOTCHAS:
 *   - Database tests use the separate local-only runner and cannot be selected here.
 *   - The report is deleted even when the lane fails and is never a retained artifact.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { safeChildEnv } from './safe-child-env.mjs';

const lane = process.argv[2];
if (!['unit', 'worker', 'qa'].includes(lane)) {
  process.stderr.write('Credential-free Vitest lane must be exactly unit, worker, or qa.\n');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const reportPath = path.join(os.tmpdir(), `upr-vitest-${lane}-${process.pid}.json`);
const childEnv = safeChildEnv(process.env, {
  NODE_ENV: 'test',
  UPR_TEST_LANE: lane,
});

const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(
  process.execPath,
  [
    vitest,
    'run',
    '--config',
    path.join(root, 'vitest.config.js'),
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
  ],
  {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  },
);

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch {
  process.stderr.write(`QA ${lane} lane did not produce a readable test report.\n`);
} finally {
  fs.rmSync(reportPath, { force: true });
}

if (result.error || result.status !== 0 || !report?.success) {
  process.exit(result.status || 1);
}
if (!report.numTotalTests) {
  process.stderr.write(`QA ${lane} lane refused an empty green run.\n`);
  process.exit(1);
}

const unexpectedSkips =
  (report.numPendingTests || 0)
  + (report.numPendingTestSuites || 0)
  + (report.numTodoTests || 0);
if (unexpectedSkips !== 0) {
  process.stderr.write(`QA ${lane} lane found ${unexpectedSkips} unexpected skipped/pending tests.\n`);
  process.exit(1);
}

process.stdout.write(
  `QA ${lane} lane: ${report.numPassedTests}/${report.numTotalTests} passed; 0 unexpected skips.\n`,
);
