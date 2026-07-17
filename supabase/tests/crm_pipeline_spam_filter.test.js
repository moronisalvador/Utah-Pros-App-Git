/**
 * ════════════════════════════════════════════════
 * FILE: crm_pipeline_spam_filter.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM reporting RPCs no longer count spam-flagged leads
 *   (inbound_leads.spam_flag = true) toward chart/report numbers. The Leads
 *   pipeline board already excluded spam; this closes the gap on the
 *   Attribution page (per-campaign lead counts) and the Reports page
 *   (speed-to-lead SLA buckets, pipeline-movement in/out counts). Each test
 *   uses a delta or a run-unique discriminator rather than an absolute count,
 *   so it never asserts on live production row counts.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs, pipeline_stages (via RPCs)
 *              writes → inbound_leads, ad_spend, lead_stage_history (via
 *              move_lead_to_stage) — all TEST-org / run-unique fixtures,
 *              cleaned up in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - lead_stage_history CASCADE-deletes with its lead (ON DELETE CASCADE),
 *     so deleting the inbound_leads row in afterAll clears it too.
 *   - get_attribution_by_campaign is driven by ad_spend (LEFT-joined against
 *     a leads subquery), so isolating a test row needs BOTH an ad_spend
 *     fixture and a matching-campaign inbound_leads pair — a run-unique
 *     campaign_name keeps the count safe even with concurrent test runs.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM — reporting RPCs exclude spam-flagged leads (integration)', () => {
  const runId = Date.now();
  const campaignName = `zz-spam-filter-${runId}`;
  let orgId;
  let openStageId;
  const leadIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    const stages = await db.rpc('get_pipeline_stages', { p_org_id: orgId });
    openStageId = stages.find(s => !s.is_won && !s.is_lost)?.id || stages[0].id;
  });

  afterAll(async () => {
    for (const id of leadIds) await db.delete('inbound_leads', `id=eq.${id}`);
    await db.delete('ad_spend', `campaign_name=eq.${encodeURIComponent(campaignName)}`);
  });

  it('get_attribution_by_campaign counts only the non-spam lead for a run-unique campaign', async () => {
    await db.insert('ad_spend', {
      org_id: orgId, platform: 'google', campaign_id: `zz-${runId}`, campaign_name: campaignName,
      date: new Date(runId).toISOString().slice(0, 10), spend: 0,
    });

    const [realLead] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Google Ads', source_type: 'call', campaign: campaignName,
      spam_flag: false, occurred_at: new Date(runId).toISOString(), notes: `zz-spam-filter-real-${runId}`,
    });
    leadIds.push(realLead.id);

    const [spamLead] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Google Ads', source_type: 'call', campaign: campaignName,
      spam_flag: true, occurred_at: new Date(runId).toISOString(), notes: `zz-spam-filter-spam-${runId}`,
    });
    leadIds.push(spamLead.id);

    const rows = await db.rpc('get_attribution_by_campaign', { p_org_id: orgId });
    const row = rows.find(r => r.campaign_name === campaignName);
    expect(row).toBeTruthy();
    expect(row.leads).toBe(1); // only the non-spam lead counts
  });

  it('get_speed_to_lead and get_pipeline_movement counts are unchanged after moving a spam lead through a stage', async () => {
    const before = await Promise.all([
      db.rpc('get_speed_to_lead', { p_org_id: orgId }),
      db.rpc('get_pipeline_movement', { p_org_id: orgId }),
    ]);

    const [spamLead] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Referral', source_type: 'call',
      spam_flag: true, occurred_at: new Date().toISOString(), notes: `zz-spam-filter-move-${runId}`,
    });
    leadIds.push(spamLead.id);
    await db.rpc('move_lead_to_stage', { p_lead_id: spamLead.id, p_stage_id: openStageId, p_moved_by: null });

    const after = await Promise.all([
      db.rpc('get_speed_to_lead', { p_org_id: orgId }),
      db.rpc('get_pipeline_movement', { p_org_id: orgId }),
    ]);

    // Same shape, same counts — the spam lead's move never registers.
    expect(after[0].map(r => r.count)).toEqual(before[0].map(r => r.count));
    expect(after[1].map(r => [r.moved_in, r.moved_out])).toEqual(before[1].map(r => [r.moved_in, r.moved_out]));
  });

  it('get_attribution_rollup, get_speed_to_lead, and get_pipeline_movement keep their shapes after the replace', async () => {
    const [rollup, speed, movement] = await Promise.all([
      db.rpc('get_attribution_rollup', { p_org_id: orgId }),
      db.rpc('get_speed_to_lead', { p_org_id: orgId }),
      db.rpc('get_pipeline_movement', { p_org_id: orgId }),
    ]);
    expect(Array.isArray(rollup)).toBe(true);
    for (const r of rollup) {
      expect(r).toHaveProperty('channel');
      expect(r).toHaveProperty('leads');
    }
    expect(speed).toHaveLength(6);
    expect(Array.isArray(movement)).toBe(true);
    for (const m of movement) {
      expect(m).toHaveProperty('moved_in');
      expect(m).toHaveProperty('moved_out');
    }
  });
});
