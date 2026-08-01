/**
 * ════════════════════════════════════════════════
 * FILE: crm_call_volume_no_null_start_truncation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves get_call_volume's null-p_start default derives a REAL floor from
 *   the org's earliest actual call, never a guessed distant date. A guessed
 *   floor (the frontend briefly used '2000-01-01') forces the function's
 *   day-by-day generate_series to span decades, which can blow past
 *   PostgREST's default 1000-row response cap and silently return only the
 *   oldest (all-zero) slice — the live bug this migration fixes: "All time"
 *   showed 0 calls despite 68 real ones, because none of them fit inside the
 *   first 1000 truncated days. This test proves a call inserted for a
 *   TEST org still shows up when p_start is omitted, with a small response
 *   (no truncation risk), by checking the returned array actually reaches a
 *   period on/after the fixture's own call date.
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
 *   Data:      reads  → get_call_volume as the signed-in QA admin
 *              writes → inbound_leads through the branch-gated service client
 *              (one TEST-org call lead), best-effort deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the qa-staging Supabase branch; self-skips
 *     without branch creds like the other CRM suites.
 * ════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { supabase } from '../../functions/lib/supabase.js';
import { companyDateOf } from '../../src/lib/companyDate.js';
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
  throw new Error('CRM call-volume integration test refused: exact qa-staging branch credentials are required; production is never a test target');
}

describe.skipIf(!hasCreds)('get_call_volume — null p_start derives a real floor, not a guessed one (integration)', () => {
  const runId = Date.now();
  const orgId = QA_CRM_ORG_ID;
  const fixtureDb = hasCreds
    ? supabase({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey })
    : null;
  let adminDb;
  const leadIds = [];

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

  it('an omitted p_start returns a small, non-truncated array that still reaches the fixture call', async () => {
    const now = new Date();
    const [lead] = await fixtureDb.insert('inbound_leads', {
      org_id: orgId, callrail_id: `qa-call-volume-nullstart-${runId}`, source_type: 'call', duration_sec: 60, spam_flag: false,
      occurred_at: now.toISOString(), raw_payload: { answered: true },
      notes: `zz-call-vol-nullstart-${runId}`,
    });
    leadIds.push(lead.id);

    // p_start omitted entirely — the exact call shape the Overview page makes
    // under "All time" (p_start: null). A guessed-distant-floor bug would
    // return ~1000 rows starting decades ago and never reach "now" at all.
    // The RPC buckets calls in America/Denver. A UTC date flips six or seven
    // hours early and excludes this just-inserted call after 18:00 local time.
    const todayStr = companyDateOf(now);
    const rows = await adminDb.rpc('get_call_volume', { p_end: todayStr, p_org_id: orgId });

    expect(Array.isArray(rows)).toBe(true);
    // The response must be small (bounded by real data), not PostgREST's
    // 1000-row cap — proves the floor is real, not a distant guess.
    expect(rows.length).toBeLessThan(1000);

    const lastRow = rows[rows.length - 1];
    expect(lastRow.period).toBe(todayStr);
    expect(lastRow.total).toBeGreaterThanOrEqual(1);
  });
});
