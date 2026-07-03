/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase9_intelligence.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves CRM Phase 9's intelligence RPCs behave against the real database:
 *     1. The SQL score_lead() function produces the SAME number as the pure,
 *        unit-tested JavaScript rule (src/lib/crmPipeline.js scoreLead) for the
 *        same lead — the two implementations are kept in lockstep, so a drift
 *        in either would fail here — and it persists a five-row factor breakdown.
 *     2. Every fixed report RPC (conversion trend, estimator leaderboard, call
 *        volume, speed-to-lead, estimate aging, pipeline movement, contact LTV)
 *        runs and returns a well-formed list of rows.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3),
 *              src/lib/crmPipeline.js (scoreLead — the pure rule the RPC mirrors)
 *   Data:      reads  → crm_orgs, inbound_leads, lead_score_factors (via RPCs)
 *              writes → inbound_leads (one TEST-org lead), lead_score_factors,
 *                       system_events (score_lead's own audit row). The lead is
 *                       best-effort deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites (CI's `npm test` passes no secrets).
 *   - The score fixture is an ANSWERED inbound call (duration > 0) so the
 *     speed-to-first-touch factor is a deterministic 0 minutes (touched during
 *     the call) — no dependence on message history.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';
import { scoreLead } from '../../src/lib/crmPipeline.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 9 — intelligence RPCs (integration)', () => {
  const runId = Date.now();
  let orgId;
  const createdLeadIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    // Best-effort — anon may lack DELETE on inbound_leads; factors cascade.
    for (const id of createdLeadIds) {
      await db.delete('lead_score_factors', `lead_id=eq.${id}`);
      await db.delete('inbound_leads', `id=eq.${id}`);
    }
  });

  // ─── 1. score_lead mirrors the pure JS rule + persists factors ──────────────
  it('score_lead() equals the JS scoreLead() rule and writes a 5-factor breakdown', async () => {
    // Answered Google-Ads call → speed factor is a deterministic 0 min.
    const leadFixture = {
      source: 'Google Ads',
      source_type: 'call',
      duration_sec: 150,
      spam_flag: false,
      first_touch_minutes: 0, // answered call → SQL sets 0 too
      transcript_analysis: { sentiment: { label: 'positive' }, topics: ['Water damage', 'Emergency'] },
    };

    const [lead] = await db.insert('inbound_leads', {
      org_id: orgId,
      source: leadFixture.source,
      source_type: leadFixture.source_type,
      duration_sec: leadFixture.duration_sec,
      spam_flag: false,
      occurred_at: new Date(runId).toISOString(),
      transcript_analysis: leadFixture.transcript_analysis,
      notes: `zz9-${runId}`,
    });
    createdLeadIds.push(lead.id);

    const sqlScore = await db.rpc('score_lead', { p_lead_id: lead.id });
    const jsScore = scoreLead(leadFixture);

    expect(jsScore).toBe(80); // 15 google + 20 call + 15 speed + 15 positive + 15 urgent
    expect(sqlScore).toBe(jsScore);

    // The score is persisted on the lead…
    const [scored] = await db.select('inbound_leads', `id=eq.${lead.id}&select=lead_score`);
    expect(scored.lead_score).toBe(jsScore);

    // …and the five factors are recorded and sum to the score.
    const factors = await db.select('lead_score_factors', `lead_id=eq.${lead.id}&select=factor,points`);
    expect(factors).toHaveLength(5);
    expect(factors.reduce((s, f) => s + f.points, 0)).toBe(jsScore);
    expect(factors.map(f => f.factor).sort())
      .toEqual(['engagement', 'sentiment', 'source', 'speed_to_first_touch', 'topics']);
  });

  it('score_lead() hard-zeros a spam lead', async () => {
    const [lead] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Referral', source_type: 'call', duration_sec: 300,
      spam_flag: true, occurred_at: new Date(runId).toISOString(), notes: `zz9-spam-${runId}`,
    });
    createdLeadIds.push(lead.id);

    const sqlScore = await db.rpc('score_lead', { p_lead_id: lead.id });
    expect(sqlScore).toBe(0);
    expect(scoreLead({ spam_flag: true, source: 'Referral', source_type: 'call', duration_sec: 300 })).toBe(0);

    const factors = await db.select('lead_score_factors', `lead_id=eq.${lead.id}&select=factor`);
    expect(factors.map(f => f.factor)).toEqual(['spam']);
  });

  // ─── 2. Every fixed report RPC returns well-formed rows ─────────────────────
  it('get_conversion_trend returns period rows with raw counts', async () => {
    const rows = await db.rpc('get_conversion_trend', {});
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r).toHaveProperty('period');
      expect(r).toHaveProperty('leads');
      expect(r).toHaveProperty('revenue');
    }
  });

  it('get_speed_to_lead returns the six SLA buckets with a data_since marker', async () => {
    const rows = await db.rpc('get_speed_to_lead', {});
    expect(rows).toHaveLength(6);
    expect(rows[0].within_sla).toBe(true);   // the ≤5-min bucket
    expect(rows.every(r => 'data_since' in r)).toBe(true);
  });

  it('get_pipeline_movement returns one row per stage with in/out counts', async () => {
    const rows = await db.rpc('get_pipeline_movement', {});
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r).toHaveProperty('stage_id');
      expect(r).toHaveProperty('moved_in');
      expect(r).toHaveProperty('moved_out');
    }
  });

  it('get_estimate_aging returns the five age buckets', async () => {
    const rows = await db.rpc('get_estimate_aging', {});
    expect(rows).toHaveLength(5);
    expect(rows.every(r => 'count' in r && 'total_amount' in r)).toBe(true);
  });

  it('get_call_volume, get_estimator_leaderboard, get_contact_ltv all run', async () => {
    const [calls, leaderboard, ltv] = await Promise.all([
      db.rpc('get_call_volume', {}),
      db.rpc('get_estimator_leaderboard', {}),
      db.rpc('get_contact_ltv', {}),
    ]);
    expect(Array.isArray(calls)).toBe(true);
    expect(Array.isArray(leaderboard)).toBe(true);
    expect(Array.isArray(ltv)).toBe(true);
  });
});
