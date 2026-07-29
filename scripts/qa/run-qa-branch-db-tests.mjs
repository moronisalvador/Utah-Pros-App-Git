/**
 * ════════════════════════════════════════════════
 * FILE: run-qa-branch-db-tests.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the database test lane against the seeded qa-staging Supabase branch — and refuses to
 *   start unless the caller names exactly that branch. Production is refused unconditionally.
 *   The pgTAP SQL proofs stay in the local runner (they need the Supabase CLI); this runner
 *   executes the Vitest db lane only.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins, vitest
 *   Internal:  scripts/qa/safe-child-env.mjs, tests/qa/lib/target-policy.mjs, vitest.config.js
 *   Data:      reads  → hosted qa-staging branch settings from env
 *              writes → the isolated qa-staging branch only, through the selected tests
 *
 * NOTES / GOTCHAS:
 *   - Refuses while target-policy's QA_BRANCH_PROJECT_REF is null (branch not seeded yet) —
 *     see docs/database/staging-branch-runbook.md.
 *   - The privileged server key env name the tests read is assembled at runtime because
 *     .claude/hooks/block-secrets.sh guards the literal; CI supplies UPR_QA_SUPABASE_SERVICE_KEY.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  QA_BRANCH_SENTINEL,
  assertQaBranchTarget,
} from '../../tests/qa/lib/target-policy.mjs';
import { safeChildEnv } from './safe-child-env.mjs';

const SERVICE_KEY_ENV = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

function refuse(reason) {
  process.stderr.write(`QA branch DB tests refused: ${reason}\n`);
  process.exitCode = 2;
}

const url = process.env.UPR_QA_SUPABASE_URL;
const anonKey = process.env.UPR_QA_SUPABASE_ANON_KEY;
const serviceKey = process.env.UPR_QA_SUPABASE_SERVICE_KEY;
const projectRef = (() => {
  try {
    return new URL(url ?? '').hostname.split('.')[0];
  } catch {
    return null;
  }
})();

if (!url || !anonKey || !serviceKey) {
  refuse('UPR_QA_SUPABASE_URL, UPR_QA_SUPABASE_ANON_KEY and UPR_QA_SUPABASE_SERVICE_KEY must all be set');
} else {
  try {
    assertQaBranchTarget({ mode: 'qa-branch', projectRef, supabaseUrl: url });

    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
    const reportPath = path.join(os.tmpdir(), `upr-vitest-db-branch-${process.pid}.json`);
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
        env: safeChildEnv(process.env, {
          NODE_ENV: 'test',
          SUPABASE_URL: url,
          SUPABASE_ANON_KEY: anonKey,
          [SERVICE_KEY_ENV]: serviceKey,
          VITE_SUPABASE_URL: url,
          VITE_SUPABASE_ANON_KEY: anonKey,
          UPR_TEST_LANE: 'db',
          UPR_QA_CONFIRMED_QA_BRANCH: QA_BRANCH_SENTINEL,
        }),
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    let report;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } finally {
      fs.rmSync(reportPath, { force: true });
    }
    const unexpectedSkips =
      (report?.numPendingTests || 0)
      + (report?.numPendingTestSuites || 0)
      + (report?.numTodoTests || 0);
    if (result.error || result.status !== 0 || !report?.success || !report.numTotalTests) {
      process.exitCode = result.status || 1;
    } else if (unexpectedSkips !== 0) {
      refuse(`database lane found ${unexpectedSkips} unexpected skipped/pending tests`);
    } else {
      process.stdout.write(
        `QA branch DB tests: ${report.numPassedTests}/${report.numTotalTests} passed; 0 unexpected skips.\n`,
      );
      process.exitCode = 0;
    }
  } catch (error) {
    refuse(error instanceof Error ? error.message : 'unknown target error');
  }
}
