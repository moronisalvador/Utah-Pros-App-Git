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
 *   dark. It also holds failed assertions at zero and makes the legacy setup-suite
 *   debt shrink-only after raw Vitest output exposed it on 2026-07-31.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  vitest.config.js, .github/workflows/ci.yml,
 *              scripts/qa/run-qa-branch-db-tests.mjs,
 *              scripts/qa/db-lane-baseline.json, supabase/tests/**
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
  'appointment_crew_atomic_save_and_audit_repair.test.sql',
  'billing_editor_role_boundary.test.sql',
  'conversation_participant_scoping.test.sql',
  'estimate_create_rpc_billing_boundary.test.sql',
  'inbound_lead_recording_source.test.sql',
  'mobile_employee_identity_authority.test.sql',
  'mobile_personal_ownership_boundary.test.sql',
  'notification_producer_authorization.test.sql',
  'notification_read_recipient_boundary.test.sql',
  // Both run through npm run test:db:office-financial-read:local (or :iterate
  // against a dirty tree), in one cycle. The first proves the per-role ALLOW/DENY
  // matrix for the five money reports; the second runs after the rollback and
  // proves the gap is measurably re-open, which is what the rollback promises.
  'office_financial_read_boundary.rollback.test.sql',
  'office_financial_read_boundary.test.sql',
  // Runs through npm run test:db:oop-grouped-lines:local (or :iterate against a
  // dirty tree). Proves convert_oop_quote_to_estimate emits two grouped customer
  // lines rather than one per priced item.
  'oop_estimate_grouped_lines.test.sql',
  'oop_pricing_builder.test.sql',
  // Runs through npm run test:db:overview-financials-grant:local. Two INSERTs,
  // executed anyway because nav_permissions.role is free text — a typo would
  // apply cleanly and grant nobody anything, so the proof joins against the
  // employee_role enum.
  'overview_financials_office_pm_grant.test.sql',
  'qbo_multi_invoice_payment_receipts.test.sql',
  'scheduled_message_delivery.test.sql',
];

describe('db-lane coverage contracts', () => {
  it('discovers JavaScript database suites in the hosted lane', () => {
    const config = read('vitest.config.js');
    const workflow = read('.github/workflows/ci.yml');
    expect(config).toContain("'supabase/tests/**/*.test.js'");
    expect(workflow).toContain('npm run test:db:branch');
  });

  it('allows zero failed assertions and only shrink-only setup-suite debt', () => {
    const runner = read('scripts/qa/run-qa-branch-db-tests.mjs');
    const baseline = JSON.parse(read('scripts/qa/db-lane-baseline.json'));
    expect(baseline.maxFailedTests).toBe(0);
    expect(baseline.maxFailedFiles).toBe(44);
    expect(baseline.maxFailedSuiteNodes).toBe(90);
    expect(runner).toContain('failedTests > baseline.maxFailedTests');
    expect(runner).toContain('failedFiles > baseline.maxFailedFiles');
    expect(runner).toContain('failedSuiteNodes > baseline.maxFailedSuiteNodes');
    expect(runner).toContain('Ratchet opportunity: setup debt is below baseline');
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
