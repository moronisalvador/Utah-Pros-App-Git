/**
 * ════════════════════════════════════════════════
 * FILE: db-baseline-nonpublic.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the committed local-database files that reconstruct production's
 *   storage and scheduling setup, without needing a database. It makes sure
 *   the safety guards are still in place: the file refuses to run against a
 *   hosted project, no scheduled job can load in an active state, nothing in
 *   it looks like a real person's data, and the capture-date bookkeeping
 *   stays readable so staleness warnings keep working.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  db/baseline/non-public.sql, db/baseline/captured.json,
 *              scripts/check-baseline-age.mjs, scripts/db-local-seed.mjs
 *   Data:      none (source reads only)
 *
 * NOTES / GOTCHAS:
 *   - Source-contract, not behavioral: the behavioral halves live in
 *     scripts/qa/qualify-job-files-private-local.mjs (storage) and
 *     scripts/qa/qualify-data-shaped-failure-local.mjs (seeded data), which
 *     need Docker. This pins what CI can pin credential-free.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baselineAges, STALE_AFTER_DAYS } from '../../../scripts/check-baseline-age.mjs';

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const nonPublic = read('db/baseline/non-public.sql');
const seedSource = read('scripts/db-local-seed.mjs');

describe('db/baseline/non-public.sql — the committed non-public catalog', () => {
  it('refuses to run without the local-stack guard', () => {
    expect(nonPublic).toMatch(/current_setting\('upr\.local_stack', true\) IS DISTINCT FROM 'on'/);
    expect(nonPublic).toMatch(/RAISE EXCEPTION/);
    // The guard setting must never be satisfied by this file itself.
    expect(nonPublic).not.toMatch(/SET\s+upr\.local_stack/i);
  });

  it('carries the four live buckets and the six storage.objects policies', () => {
    for (const bucket of ['job-files', 'job-documents-private', 'contractor-compliance-private', 'message-attachments']) {
      expect(nonPublic).toContain(`'${bucket}'`);
    }
    for (const policy of [
      'anon_read_job_files', 'job_files_select',
      'job_files_authenticated_insert', 'job_files_authenticated_delete',
      'job_documents_private_authenticated_read', 'job_documents_private_authenticated_delete',
    ]) {
      expect(nonPublic).toContain(`CREATE POLICY ${policy} ON storage.objects`);
    }
  });

  it('deactivates every cron job it schedules, and refuses if one stays active', () => {
    // The captured commands POST at production workers; an active local cron
    // job would fire them from a laptop. Both halves of the guard must stay.
    expect(nonPublic).toMatch(/cron\.alter_job\(job\.jobid, active := false\)/);
    expect(nonPublic).toMatch(/EXISTS \(SELECT 1 FROM cron\.job WHERE active\)/);
    // All 15 captured jobs are present.
    const scheduled = nonPublic.match(/cron\.schedule\('/g) || [];
    expect(scheduled.length).toBe(15);
  });

  it('contains no secret values — cron commands read secrets at runtime only', () => {
    // The commands may NAME config keys; they must never carry a value.
    expect(nonPublic).toMatch(/SELECT value FROM integration_config/);
    expect(nonPublic).not.toMatch(/sk_live_|rk_live_|pk_live_|Bearer [A-Za-z0-9]/);
  });
});

describe('db/baseline/captured.json + check-baseline-age', () => {
  it('has a readable capture date for both baseline files', () => {
    const ages = baselineAges();
    expect(ages).toHaveLength(2);
    for (const a of ages) {
      expect(a.ageDays).toBeGreaterThanOrEqual(0);
      expect(a.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(STALE_AFTER_DAYS).toBeGreaterThan(0);
  });
});

describe('db-local-seed — fake-data posture (source contract)', () => {
  it('targets only the local docker container and carries the local-stack guard', () => {
    expect(seedSource).toContain("const DB_CONTAINER = 'supabase_db_upr'");
    expect(seedSource).not.toMatch(/supabase\.co|glsmljpabrwonfiltiqm|uizgwvkvzyldystqrcsk/);
    expect(seedSource).toMatch(/upr\.local_stack/);
  });

  it('keeps the obviously-fake refusals', () => {
    expect(seedSource).toMatch(/example\\\.invalid\|upr-qa\\\.test/);
    expect(seedSource).toMatch(/REFUSING to load/);
  });

  it('never writes a trigger-owned money column (Rule 15)', () => {
    // The seed inserts quantity/unit_price and payment amounts; the real
    // triggers own the rest. A named column here would be a regression.
    for (const owned of ['line_total', 'amount_paid', 'paid_at']) {
      expect(seedSource, `${owned} must not be written by the seed`).not.toMatch(new RegExp(`'${owned}'`));
    }
  });

  it('stays out of the Hydro-frozen tables', () => {
    expect(seedSource).not.toMatch(/insert\('moisture_readings'|insert\('equipment_placements'/);
  });
});
