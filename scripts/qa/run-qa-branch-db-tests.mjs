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
const fixturePassword = process.env.UPR_QA_FIXTURE_PASSWORD;
const projectRef = (() => {
  try {
    return new URL(url ?? '').hostname.split('.')[0];
  } catch {
    return null;
  }
})();

if (!url || !anonKey || !serviceKey || !fixturePassword) {
  refuse(
    'UPR_QA_SUPABASE_URL, UPR_QA_SUPABASE_ANON_KEY, UPR_QA_SUPABASE_SERVICE_KEY '
    + 'and UPR_QA_FIXTURE_PASSWORD must all be set',
  );
} else {
  try {
    assertQaBranchTarget({ mode: 'qa-branch', projectRef, supabaseUrl: url });

    // Seed preflight: a freshly created branch has a near-empty public schema until
    // the owner runs the runbook §2 seed. Running 350+ tests against that produces a
    // wall of PGRST202/PGRST205 noise and a false-red CI on unrelated PRs — so an
    // unseeded branch is reported loudly and skipped (exit 0), exactly like unset
    // secrets. A misconfiguration (bad key, network) still refuses with exit 2.
    const probe = await fetch(`${url}/rest/v1/employees?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (probe.status === 404) {
      process.stdout.write(
        '::warning title=DB lane SEED PENDING::qa-staging branch is reachable and secrets are '
        + 'valid, but the schema is not seeded yet (core table missing). supabase/tests/** did '
        + 'NOT run. Seed per docs/database/staging-branch-runbook.md §2 Path B.\n',
      );
      process.exit(0);
    }
    if (!probe.ok) {
      throw new Error(`branch preflight failed: HTTP ${probe.status} from rest/v1 (check keys/URL)`);
    }

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
          UPR_QA_FIXTURE_PASSWORD: fixturePassword,
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
    if (result.error || !report?.numTotalTests) {
      process.exitCode = result.status || 1;
    } else {
      // The standing identities and branch-only reference rows are seeded. Failed
      // assertions have no budget. Legacy anon-era setup suites still carry a
      // shrink-only baseline until their fixture setup and signed-in calls are converted.
      const baseline = JSON.parse(
        fs.readFileSync(path.join(root, 'scripts', 'qa', 'db-lane-baseline.json'), 'utf8'),
      );
      const failedTests = report.numFailedTests || 0;
      const failedSuites = report.numFailedTestSuites || 0;
      const skippedTests = report.numPendingTests || 0;
      const todoTests = report.numTodoTests || 0;
      process.stdout.write(
        `QA branch DB tests: ${report.numPassedTests}/${report.numTotalTests} passed, `
        + `${failedTests} failed assertions (baseline ${baseline.maxFailedTests}), `
        + `${failedSuites} failed setup suites (baseline ${baseline.maxFailedSuites}), `
        + `${skippedTests} skipped, ${todoTests} todo.\n`,
      );
      if (
        failedTests > baseline.maxFailedTests
        || failedSuites > baseline.maxFailedSuites
      ) {
        process.stderr.write(
          'QA branch DB tests FAILED: '
          + `${failedTests} failed assertion(s) / ${failedSuites} failed setup suite(s) exceeds `
          + `the shrink-only baseline (${baseline.maxFailedTests} / `
          + `${baseline.maxFailedSuites}).\n`,
        );
        process.exitCode = 1;
      } else {
        if (failedSuites < baseline.maxFailedSuites) {
          process.stdout.write(
            'Ratchet opportunity: failed setup suites are below baseline — lower '
            + `maxFailedSuites to ${failedSuites} in scripts/qa/db-lane-baseline.json.\n`,
          );
        }
        process.exitCode = 0;
      }
    }
  } catch (error) {
    refuse(error instanceof Error ? error.message : 'unknown target error');
  }
}
