/**
 * ════════════════════════════════════════════════
 * FILE: crm_trend_excludes_merged_leads.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the counting-consistency fix in migration
 *   20260722_crm_trend_excludes_merged_leads: when a repeat call gets merged
 *   into an earlier lead (its merged_into_lead_id points at the original),
 *   the Conversion Trend chart must count ONE lead, not two — the same rule
 *   the headline "Leads" card (get_attribution_rollup) already applies.
 *   Before the fix, the same screen showed 26 leads on the card and 28 on
 *   the trend chart. This test inserts a pair of leads where one is merged
 *   into the other and asserts get_conversion_trend's total leads went up
 *   by exactly 1, not 2.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → get_conversion_trend RPC
 *              writes → inbound_leads (direct inserts on the TEST org;
 *                       deleted in afterAll)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 *   - Asserts a before/after DELTA of the SUM of leads across every returned
 *     month row — never an absolute count, and never a single month bucket
 *     (the RPC buckets months in the DB session timezone while its window
 *     ends on a Denver "today", so pinning one bucket would be flaky near
 *     month/day boundaries; the series-wide sum is robust).
 *   - occurred_at is set 24 hours in the past so the rows land safely inside
 *     the RPC's default window regardless of the Denver-vs-UTC edge at the
 *     window's end.
 *   - The fixture leads are source_type 'call' with raw_payload.answered=true
 *     so they pass the unanswered-call exclusion
 *     (20260722_crm_leads_exclude_unanswered_calls) — this test isolates the
 *     merged-duplicate exclusion only.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm conversion trend excludes merged repeat-call leads (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  const leadIds = [];

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    // Best-effort cleanup: delete the merged child first (it FK-references the
    // canonical lead via merged_into_lead_id), then the rest.
    if (leadIds.length) {
      try {
        await db.delete('inbound_leads', `id=in.(${leadIds.slice().reverse().join(',')})`);
      } catch {
        for (const id of leadIds.slice().reverse()) {
          try { await db.delete('inbound_leads', `id=eq.${id}`); } catch { /* best-effort */ }
        }
      }
    }
  });

  async function totalTrendLeads() {
    const rows = await db.rpc('get_conversion_trend', { p_org_id: testOrgId });
    return (rows || []).reduce((sum, r) => sum + (r.leads || 0), 0);
  }

  async function insertLead(label, extra = {}) {
    const res = await db.insert('inbound_leads', {
      org_id: testOrgId,
      callrail_id: `test-trend-${label}-${runId}`,
      source_type: 'call',
      caller_number: `+1801${String(runId).slice(-7)}`,
      duration_sec: 45,
      spam_flag: false,
      occurred_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      raw_payload: { test: true, answered: true },
      ...extra,
    });
    const row = Array.isArray(res) ? res[0] : res;
    leadIds.push(row.id);
    return row;
  }

  it('counts a merged pair as ONE lead, not two (matches the attribution rollup rule)', async () => {
    const before = await totalTrendLeads();

    const original = await insertLead('original');
    expect(original.merged_into_lead_id ?? null).toBeNull();

    const merged = await insertLead('merged', { merged_into_lead_id: original.id });
    expect(merged.merged_into_lead_id).toBe(original.id);

    const after = await totalTrendLeads();
    // The canonical lead is counted; the merged duplicate is not: +1, not +2.
    expect(after - before).toBe(1);
  });
});
