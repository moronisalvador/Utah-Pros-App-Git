/**
 * ════════════════════════════════════════════════
 * FILE: crm_denver_day_bucketing.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the company timezone convention (database-standard.md §7 — every
 *   day/week bucket is an America/Denver calendar day, via mt_date()) onto
 *   the CRM reporting RPCs and get_jobs_closed, after migration
 *   20260722_crm_denver_day_bucketing replaced their UTC-midnight windows.
 *
 *   The decisive case: an evening call at 11:30 PM Denver time is 5:30 AM
 *   THE NEXT DAY in UTC. Before the fix, that call reported on the wrong
 *   day (measured live: ~24% of all sales sat on the wrong UTC day). These
 *   tests deliver exactly such a boundary call into the QA branch org and
 *   assert get_call_volume counts it on its DENVER day and NOT on its UTC day.
 *
 *   Also serves as the backward-compat proof required by database-standard.md
 *   §3 for live-RPC replaces: every replaced function is called with its
 *   shipped caller's exact parameter shape and must still succeed.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/supabase.js (branch-gated service client for
 *              disposable fixture writes), src/lib/supabase.js (REST client
 *              bound to the QA admin token for RPC assertions),
 *              ./helpers/qaFixtures.mjs (standing QA identity)
 *   Data:      reads  → the replaced reporting RPCs as the signed-in QA admin
 *              writes → inbound_leads (one QA-org boundary call via
 *                       upsert_lead_from_callrail through the branch-gated
 *                       service client — the CallRail worker's real caller;
 *                       the RPC is service-role-only since 20260726183409),
 *                       best-effort deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the qa-staging Supabase branch; self-skips
 *     without branch creds like the other converted CRM suites.
 *   - Uses before/after DELTAS on a fixed historic Denver day — never
 *     absolute counts — safe against other QA fixtures.
 *   - The fixture time is July (MDT, UTC-6). If this file is ever copied for
 *     a winter date, the offset is -07:00 (MST) — Denver observes DST.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '../../functions/lib/supabase.js';
import { createSupabaseClient } from '../../src/lib/supabase.js';
import { signInFixture } from './helpers/qaFixtures.mjs';
import {
  QA_BRANCH_PROJECT_REF,
  QA_BRANCH_SENTINEL,
  assertQaBranchTarget,
} from '../../tests/qa/lib/target-policy.mjs';

const QA_CRM_ORG_ID = 'aaaaaaaa-0000-4000-8000-000000000203';
const env = globalThis.process?.env || {};
const url = env.SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || '';
const serviceKeyName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const serviceKey = env[serviceKeyName] || '';
const confirmed = env.UPR_QA_CONFIRMED_QA_BRANCH === QA_BRANCH_SENTINEL;
const projectRef = (() => {
  try { return new URL(url).hostname.split('.')[0]; } catch { return ''; }
})();
const hasCreds = !!(confirmed && anonKey && serviceKey && (() => {
  try {
    assertQaBranchTarget({ mode: 'qa-branch', projectRef, supabaseUrl: url });
    return true;
  } catch {
    return false;
  }
})());

if ((url || anonKey || serviceKey || confirmed) && !hasCreds) {
  throw new Error('CRM Denver-day integration test refused: exact qa-staging branch credentials are required; production is never a test target');
}

// 11:30 PM Denver on July 20 = 5:30 AM July 21 UTC — the boundary case.
const DENVER_DAY = '2026-07-20';
const UTC_DAY = '2026-07-21';
const BOUNDARY_ISO = '2026-07-20T23:30:00-06:00';

describe.skipIf(!hasCreds)('CRM Denver-day bucketing (integration)', () => {
  const runId = Date.now();
  const orgId = QA_CRM_ORG_ID;
  const fixtureDb = hasCreds
    ? supabase({ SUPABASE_URL: url, [serviceKeyName]: serviceKey })
    : null;
  let adminDb;
  const leadIds = [];

  const dayTotal = (rows, day) => {
    const row = (rows || []).find((r) => r.period === day);
    return row ? Number(row.total || 0) : 0;
  };

  const callVolume = (start, end) =>
    adminDb.rpc('get_call_volume', { p_start: start, p_end: end, p_org_id: orgId });

  beforeAll(async () => {
    expect(projectRef).toBe(QA_BRANCH_PROJECT_REF);
    const admin = await signInFixture('admin');
    adminDb = createSupabaseClient(admin.token);
  });

  afterAll(async () => {
    if (fixtureDb) {
      for (const id of leadIds.slice().reverse()) {
        await fixtureDb.delete('inbound_leads', `id=eq.${id}`).catch(() => {});
      }
    }
  });

  it('an 11:30 PM Denver call counts on its DENVER day, not its UTC day', async () => {
    const beforeDenver = dayTotal(await callVolume(DENVER_DAY, DENVER_DAY), DENVER_DAY);
    const beforeUtc = dayTotal(await callVolume(UTC_DAY, UTC_DAY), UTC_DAY);

    const lead = await fixtureDb.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-denver-${runId}`,
      p_source_type: 'call',
      p_org_id: orgId,
      p_caller_number: `+1801${String(runId).slice(-7)}`,
      p_duration_sec: 45,
      p_occurred_at: BOUNDARY_ISO,
      p_raw_payload: { answered: 'true' },
    });
    leadIds.push(lead.id);

    const afterDenver = dayTotal(await callVolume(DENVER_DAY, DENVER_DAY), DENVER_DAY);
    const afterUtc = dayTotal(await callVolume(UTC_DAY, UTC_DAY), UTC_DAY);

    expect(afterDenver).toBe(beforeDenver + 1); // lands on July 20 (Denver)
    expect(afterUtc).toBe(beforeUtc);           // NOT on July 21 (its UTC day)
  });

  it('every replaced RPC still answers its shipped caller (backward-compat)', async () => {
    // Exact parameter shapes the deployed frontend sends (CrmOverview/
    // CrmReports/Overview widgets) — a signature regression throws here.
    const [rollup, trend, divisions, leaderboard, movement, speed, volume, closed] =
      await Promise.all([
        adminDb.rpc('get_attribution_rollup', { p_start_date: DENVER_DAY, p_end_date: UTC_DAY }),
        adminDb.rpc('get_conversion_trend', { p_start: DENVER_DAY, p_end: UTC_DAY }),
        adminDb.rpc('get_crm_revenue_by_division', { p_start_date: DENVER_DAY, p_end_date: UTC_DAY }),
        adminDb.rpc('get_estimator_leaderboard', { p_start: DENVER_DAY, p_end: UTC_DAY }),
        adminDb.rpc('get_pipeline_movement', { p_start: DENVER_DAY, p_end: UTC_DAY }),
        adminDb.rpc('get_speed_to_lead', { p_start: DENVER_DAY, p_end: UTC_DAY }),
        adminDb.rpc('get_call_volume', { p_start: DENVER_DAY, p_end: UTC_DAY }),
        adminDb.rpc('get_jobs_closed', { p_floor: DENVER_DAY }),
      ]);

    for (const rows of [rollup, trend, divisions, leaderboard, movement, speed, volume, closed]) {
      expect(Array.isArray(rows)).toBe(true);
    }
    // Return shapes unchanged: spot-check the keys shipped consumers read.
    // volume/speed/trend emit fixed series/bucket rows even for a zero-data
    // window (generate_series / VALUES defs), so [0] exists on the branch.
    expect(volume[0]).toHaveProperty('period');
    expect(volume[0]).toHaveProperty('answered');
    expect(speed[0]).toHaveProperty('within_sla');
    expect(trend[0]).toHaveProperty('won_jobs');
  });

  it('get_crm_sales_summary: traced is always a subset of company-wide', async () => {
    const s = await adminDb.rpc('get_crm_sales_summary', {});
    expect(s).toBeTruthy();
    expect(Number(s.total_won)).toBeGreaterThanOrEqual(Number(s.traced_won));
    expect(Number(s.total_revenue)).toBeGreaterThanOrEqual(Number(s.traced_revenue));
    // Windowed call agrees with itself: a one-day window never exceeds all-time.
    const day = await adminDb.rpc('get_crm_sales_summary', {
      p_start_date: DENVER_DAY, p_end_date: DENVER_DAY,
    });
    expect(Number(day.total_won)).toBeLessThanOrEqual(Number(s.total_won));
  });
});
