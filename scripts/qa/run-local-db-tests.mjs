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
 *   Internal:  tests/qa/lib/target-policy.mjs, vitest.db.config.js
 *   Data:      reads  → local test process settings
 *              writes → local isolated database only through the selected tests
 *
 * NOTES / GOTCHAS:
 *   - This runner does not start Supabase and never falls back to a hosted project.
 *   - The local runtime and database contracts remain a P2a execution gate.
 * ════════════════════════════════════════════════
 */

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_DATABASE_SENTINEL,
  assertLocalDatabaseTarget,
} from '../../tests/qa/lib/target-policy.mjs';

function refuse(reason) {
  process.stderr.write(`Local DB QA refused: ${reason}\n`);
  process.exitCode = 2;
}

if (process.env.UPR_QA_LOCAL_SENTINEL !== LOCAL_DATABASE_SENTINEL) {
  refuse(`UPR_QA_LOCAL_SENTINEL must equal ${LOCAL_DATABASE_SENTINEL}`);
} else {
  try {
    assertLocalDatabaseTarget({
      mode: process.env.UPR_QA_DB_MODE,
      projectRef: process.env.UPR_QA_PROJECT_REF,
      supabaseUrl: process.env.SUPABASE_URL,
    });

    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
    const result = spawnSync(
      process.execPath,
      [vitest, 'run', '--config', path.join(root, 'vitest.db.config.js')],
      {
        cwd: root,
        env: {
          ...process.env,
          VITE_SUPABASE_URL: process.env.SUPABASE_URL,
          UPR_QA_CONFIRMED_LOCAL: LOCAL_DATABASE_SENTINEL,
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    process.exitCode = result.error ? 1 : (result.status ?? 1);
  } catch (error) {
    refuse(error instanceof Error ? error.message : 'unknown target error');
  }
}
