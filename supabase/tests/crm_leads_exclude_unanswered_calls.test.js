/**
 * ════════════════════════════════════════════════
 * FILE: crm_leads_exclude_unanswered_calls.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the fix for a real live bug: an unanswered call (rang, nobody
 *   picked up, no recording, no transcript — so it can NEVER be run through
 *   the AI classifier that would otherwise flag it as spam) used to count
 *   as a "Lead" in every marketing number on the CRM Overview/Attribution/
 *   Reports pages. Verified live 2026-07-22: 13 of 29 "leads" in a 7-day
 *   window were unanswered calls with zero content. This proves
 *   get_attribution_rollup and get_conversion_trend now both exclude an
 *   unanswered call from their lead counts via the new canonical
 *   crm_call_is_answered(raw_payload, duration_sec) predicate, while an
 *   ANSWERED call with the exact same shape still counts normally — the
 *   fix targets "was this call picked up", not calls in general.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs (via RPC's own org lookup)
 *              writes → inbound_leads (TEST-org fixture rows), best-effort
 *              deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - Uses before/after DELTAS on a run-unique campaign value, never an
 *     absolute count — safe against live production/other-test data.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM lead-counting RPCs exclude unanswered calls (integration)', () => {
  const runId = Date.now();
  const campaign = `zz-unanswered-fix-${runId}`;
  let orgId;
  const leadIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
  });

  async function insertCall({ answered, phone }) {
    const [lead] = await db.insert('inbound_leads', {
      org_id: orgId,
      source_type: 'call',
      duration_sec: answered ? 90 : 18,
      spam_flag: false,
      campaign,
      caller_number: phone,
      occurred_at: new Date().toISOString(),
      raw_payload: { answered },
    });
    leadIds.push(lead.id);
    return lead;
  }

  it('get_attribution_rollup counts an ANSWERED call but not an UNANSWERED one', async () => {
    const before = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const beforeTotal = before.reduce((sum, r) => sum + Number(r.leads || 0), 0);

    await insertCall({ answered: false, phone: `+1801${String(runId).slice(-7)}1` });
    const afterUnanswered = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const afterUnansweredTotal = afterUnanswered.reduce((sum, r) => sum + Number(r.leads || 0), 0);
    expect(afterUnansweredTotal).toBe(beforeTotal); // unanswered call did NOT increase the count

    await insertCall({ answered: true, phone: `+1801${String(runId).slice(-7)}2` });
    const afterAnswered = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const afterAnsweredTotal = afterAnswered.reduce((sum, r) => sum + Number(r.leads || 0), 0);
    expect(afterAnsweredTotal).toBe(beforeTotal + 1); // answered call DID increase the count
  });

  it('get_conversion_trend counts an ANSWERED call but not an UNANSWERED one, for the current month', async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = now.toISOString().slice(0, 10);
    const periodKey = monthStart.slice(0, 7);

    const before = await db.rpc('get_conversion_trend', { p_start: monthStart, p_end: monthEnd, p_org_id: orgId });
    const beforeLeads = before.find((r) => r.period === periodKey)?.leads ?? 0;

    await insertCall({ answered: false, phone: `+1801${String(runId).slice(-7)}3` });
    const afterUnanswered = await db.rpc('get_conversion_trend', { p_start: monthStart, p_end: monthEnd, p_org_id: orgId });
    const afterUnansweredLeads = afterUnanswered.find((r) => r.period === periodKey)?.leads ?? 0;
    expect(afterUnansweredLeads).toBe(beforeLeads);

    await insertCall({ answered: true, phone: `+1801${String(runId).slice(-7)}4` });
    const afterAnswered = await db.rpc('get_conversion_trend', { p_start: monthStart, p_end: monthEnd, p_org_id: orgId });
    const afterAnsweredLeads = afterAnswered.find((r) => r.period === periodKey)?.leads ?? 0;
    expect(afterAnsweredLeads).toBe(beforeLeads + 1);
  });

  it('a legacy call with no answered key falls back to duration_sec > 0', async () => {
    const before = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const beforeTotal = before.reduce((sum, r) => sum + Number(r.leads || 0), 0);

    const [zeroDuration] = await db.insert('inbound_leads', {
      org_id: orgId, source_type: 'call', duration_sec: 0, spam_flag: false, campaign,
      caller_number: `+1801${String(runId).slice(-7)}5`,
      occurred_at: new Date().toISOString(), raw_payload: {},
    });
    leadIds.push(zeroDuration.id);
    const afterZero = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const afterZeroTotal = afterZero.reduce((sum, r) => sum + Number(r.leads || 0), 0);
    expect(afterZeroTotal).toBe(beforeTotal); // no 'answered' key + 0 duration → not counted

    const [realDuration] = await db.insert('inbound_leads', {
      org_id: orgId, source_type: 'call', duration_sec: 120, spam_flag: false, campaign,
      caller_number: `+1801${String(runId).slice(-7)}6`,
      occurred_at: new Date().toISOString(), raw_payload: {},
    });
    leadIds.push(realDuration.id);
    const afterReal = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const afterRealTotal = afterReal.reduce((sum, r) => sum + Number(r.leads || 0), 0);
    expect(afterRealTotal).toBe(beforeTotal + 1); // no 'answered' key + real duration → counted
  });
});
