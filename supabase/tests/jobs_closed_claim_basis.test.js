/**
 * ════════════════════════════════════════════════
 * FILE: jobs_closed_claim_basis.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "New Jobs Closed" card was changed so a sold job counts in the month its
 *   CLAIM was created, not the month its job record was entered. This test proves
 *   that change is safe: it calls get_jobs_closed the exact way the dashboard does
 *   and checks (a) it still returns the same shape of rows the card reads, and
 *   (b) every job that has a claim is now dated by that claim's created date,
 *   while claim-less jobs still fall back to the job's own created date.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → get_jobs_closed() RPC, jobs, claims · writes → none
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the other suites. Read-only — creates and deletes nothing.
 *   - Asserts CONTRACT/PROPERTY, never live counts (per test discipline): the
 *     COALESCE(claim.created_at, job.created_at) rule holds for every sampled row.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const ms = (v) => (v ? new Date(v).getTime() : null);

describe.skipIf(!hasCreds)('get_jobs_closed — claim-date basis (integration)', () => {
  let rows;

  beforeAll(async () => {
    // Exactly how useJobsClosed.js calls it (floor ~400 days back).
    const floor = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    rows = await db.rpc('get_jobs_closed', { p_floor: floor });
  });

  it('keeps its shipped shape: job_id, sale_date, sale_source per row', () => {
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows.slice(0, 25)) {
      for (const key of ['job_id', 'sale_date', 'sale_source']) {
        expect(key in r).toBe(true);
      }
      expect(ms(r.sale_date)).toBeTruthy();
    }
  });

  it('dates each job by COALESCE(claim.created_at, job.created_at)', async () => {
    // Sample rows and verify the coalesce rule directly against jobs/claims.
    const sample = rows.slice(0, 20);
    for (const r of sample) {
      const [job] = await db.select(
        'jobs',
        `id=eq.${r.job_id}&select=created_at,claim_id`,
      );
      let expected = job.created_at;
      if (job.claim_id) {
        const [claim] = await db.select(
          'claims',
          `id=eq.${job.claim_id}&select=created_at`,
        );
        // Fall back to the job date only if the claim link is dangling.
        expected = claim?.created_at ?? job.created_at;
      }
      expect(ms(r.sale_date)).toBe(ms(expected));
    }
  });
});
