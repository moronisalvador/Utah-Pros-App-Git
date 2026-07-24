/**
 * ════════════════════════════════════════════════
 * FILE: run-local-db-tests.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Refuses to start database tests unless the caller names the exact approved local database.
 *   After the checks pass, it runs only the separately configured local database test lane.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins, vitest
 *   Internal:  scripts/qa/safe-child-env.mjs, tests/qa/lib/target-policy.mjs, vitest.config.js
 *   Data:      reads  → local test process settings
 *              writes → local isolated database only through the selected tests
 *
 * NOTES / GOTCHAS:
 *   - This runner does not start Supabase and never falls back to a hosted project.
 *   - The local runtime and database contracts remain a P2a execution gate.
 * ════════════════════════════════════════════════
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_DATABASE_SENTINEL,
  assertLocalDatabaseTarget,
} from '../../tests/qa/lib/target-policy.mjs';
import { safeChildEnv } from './safe-child-env.mjs';

function refuse(reason) {
  process.stderr.write(`Local DB QA refused: ${reason}\n`);
  process.exitCode = 2;
}

if (process.env.UPR_QA_LOCAL_SENTINEL !== LOCAL_DATABASE_SENTINEL) {
  refuse(`UPR_QA_LOCAL_SENTINEL must equal ${LOCAL_DATABASE_SENTINEL}`);
} else if (!process.env.SUPABASE_ANON_KEY) {
  refuse('SUPABASE_ANON_KEY must be the current local-stack key');
} else {
  try {
    assertLocalDatabaseTarget({
      mode: process.env.UPR_QA_DB_MODE,
      projectRef: process.env.UPR_QA_PROJECT_REF,
      supabaseUrl: process.env.SUPABASE_URL,
    });

    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
    const reportPath = path.join(os.tmpdir(), `upr-vitest-db-${process.pid}.json`);
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
          SUPABASE_URL: process.env.SUPABASE_URL,
          SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
          VITE_SUPABASE_URL: process.env.SUPABASE_URL,
          VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
          UPR_TEST_LANE: 'db',
          UPR_QA_CONFIRMED_LOCAL: LOCAL_DATABASE_SENTINEL,
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
        `Local DB QA: ${report.numPassedTests}/${report.numTotalTests} passed; 0 unexpected skips.\n`,
      );
      process.exitCode = 0;
    }
  } catch (error) {
    refuse(error instanceof Error ? error.message : 'unknown target error');
  }
}
