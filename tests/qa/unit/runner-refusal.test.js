/**
 * ════════════════════════════════════════════════
 * FILE: runner-refusal.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs the local database entrypoint as a child process and proves unsafe settings stop before
 *   Vitest starts. It covers missing sentinels plus the known production project ID and URL.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  scripts/qa/run-local-db-tests.mjs, tests/qa/lib/target-policy.mjs
 *   Data:      reads  → child process settings
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The fake local key is never used because every fixture must fail before test discovery.
 * ════════════════════════════════════════════════
 */

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  LOCAL_DATABASE_SENTINEL,
  LOCAL_SUPABASE_ORIGIN,
  PRODUCTION_PROJECT_REF,
} from '../lib/target-policy.mjs';

const runner = path.resolve('scripts/qa/run-local-db-tests.mjs');

function run(overrides = {}) {
  return spawnSync(process.execPath, [runner], {
    cwd: path.resolve('.'),
    env: {
      PATH: process.env.PATH,
      UPR_QA_LOCAL_SENTINEL: LOCAL_DATABASE_SENTINEL,
      UPR_QA_DB_MODE: 'local',
      UPR_QA_PROJECT_REF: 'upr-local-qa',
      SUPABASE_URL: LOCAL_SUPABASE_ORIGIN,
      SUPABASE_ANON_KEY: 'fixture-local-key',
      ...overrides,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('local database runner refusal', () => {
  it('rejects a missing sentinel', () => {
    const result = run({ UPR_QA_LOCAL_SENTINEL: '' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Local DB QA refused');
  });

  it('rejects the production project ref before test discovery', () => {
    const result = run({ UPR_QA_PROJECT_REF: PRODUCTION_PROJECT_REF });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('project ref is missing or production');
  });

  it('rejects the production Supabase URL even under a local-looking ref', () => {
    const result = run({
      SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not the governed local Supabase origin');
  });
});
