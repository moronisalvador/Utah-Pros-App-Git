/**
 * ════════════════════════════════════════════════
 * FILE: db-lane-coverage.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the hosted and local-only database coverage contracts honest.
 *
 *   CI discovers every JavaScript database suite against the governed qa-staging
 *   branch. SQL/pgTAP proofs require the local Supabase runner, so this guard
 *   names that smaller local-only set instead of falsely calling the whole lane
 *   dark. It also prevents a known-failure budget from returning after the
 *   hosted lane reached zero failed assertions on 2026-07-31.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  vitest.config.js, .github/workflows/ci.yml,
 *              scripts/qa/run-qa-branch-db-tests.mjs, supabase/tests/**
 *   Data:      reads  → database lane configuration and test file list
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Static source proves discovery/wiring, not that a hosted run passed.
 *   - The current hosted receipt and skip count live in the staging runbook.
 *   - Adding/removing a SQL proof requires updating LOCAL_ONLY_SQL so local
 *     coverage cannot change silently.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DB_TESTS = join(ROOT, 'supabase', 'tests');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');
const LOCAL_ONLY_SQL = [
  'inbound_lead_recording_source.test.sql',
  'mobile_employee_identity_authority.test.sql',
  'mobile_personal_ownership_boundary.test.sql',
  'notification_read_recipient_boundary.test.sql',
  'oop_pricing_builder.test.sql',
  'qbo_multi_invoice_payment_receipts.test.sql',
];

describe('db-lane coverage contracts', () => {
  it('discovers JavaScript database suites in the hosted lane', () => {
    const config = read('vitest.config.js');
    const workflow = read('.github/workflows/ci.yml');
    expect(config).toContain("'supabase/tests/**/*.test.js'");
    expect(workflow).toContain('npm run test:db:branch');
  });

  it('allows zero known hosted failures', () => {
    const runner = read('scripts/qa/run-qa-branch-db-tests.mjs');
    expect(runner).toContain('if (failedTests > 0)');
    expect(runner).toContain('the hosted lane allows');
    expect(runner).not.toContain('db-lane-baseline.json');
  });

  it('keeps the local-only SQL proof inventory exact', () => {
    const sqlFiles = readdirSync(DB_TESTS)
      .filter((file) => file.endsWith('.test.sql'))
      .sort();
    expect(
      sqlFiles,
      'SQL/pgTAP proofs run only through npm run test:db:local; update this explicit inventory '
      + 'whenever that coverage changes.',
    ).toEqual(LOCAL_ONLY_SQL);
  });
});
