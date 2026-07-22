/**
 * ════════════════════════════════════════════════
 * FILE: crm_merge_repeat_call_leads.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the duplicate-lead merge fix: a second call from the same phone
 *   number while the first call's lead is still open in the pipeline gets
 *   merged into that original lead (no second Kanban card, visible instead as
 *   a "Follow-up call" entry on the original's activity timeline) — but a
 *   second call AFTER the original reached Won creates a genuinely new,
 *   independent lead (at any recency), and a call from a phone with no prior
 *   lead at all always creates a normal new lead. Also proves the 2026-07-22
 *   time-window fix: a redial shortly after the original landed in a LOST
 *   stage (most commonly "Missed Calls" — nobody picked up) now DOES merge —
 *   that was the actual bug this migration fixes, verified live: rapid
 *   callbacks after a missed call were each creating a brand-new lead — but a
 *   redial hours later, once the original is Lost, still creates a new one
 *   (a same-number call weeks later is very likely a separate job, not the
 *   same inquiry).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → pipeline_stages, inbound_leads, lead_pipeline_stage
 *              writes → inbound_leads (via upsert_lead_from_callrail RPC,
 *                       move_lead_to_stage RPC); all test rows deleted in
 *                       afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 *   - Uses the test org's real "Won"/"Lost" stages — not fixture stages.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm merge repeat-call leads (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  let stagesByName;
  const leadIds = [];

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${testOrgId}`);
    stagesByName = Object.fromEntries(stages.map((s) => [s.name, s]));
    expect(stagesByName['Won']).toBeTruthy();
    expect(stagesByName['Lost']).toBeTruthy();
  });

  afterAll(async () => {
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
  });

  async function callFrom(phone, label, occurredAt) {
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-merge-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 45,
      p_spam_flag: false,
      p_occurred_at: (occurredAt || new Date()).toISOString(),
      p_raw_payload: { test: true },
    });
    leadIds.push(lead.id);
    return lead;
  }

  it('(a) a repeat call while the original lead is open gets merged — no second card, appears in activity', async () => {
    const phone = `+1801${String(runId).slice(-7)}`;
    const first = await callFrom(phone, 'a-first');
    expect(first.merged_into_lead_id).toBeNull();

    const second = await callFrom(phone, 'a-second');
    expect(second.merged_into_lead_id).toBe(first.id);

    // The merged lead never gets its own lead_pipeline_stage row.
    const stageRows = await db.select('lead_pipeline_stage', `lead_id=eq.${second.id}`);
    expect(stageRows).toHaveLength(0);

    // It shows up as a follow-up call on the original's activity timeline.
    const activity = await db.rpc('get_lead_activity', { p_lead_id: first.id });
    const followUp = (activity || []).find((a) => a.activity_type === 'follow_up_call' && a.meta?.merged_lead_id === second.id);
    expect(followUp).toBeTruthy();
    expect(followUp.title).toBe('Follow-up call');
  });

  it('(b) a repeat call after the original reached Won creates a genuinely new lead', async () => {
    const phone = `+1801${String(runId).slice(-6)}9`;
    const first = await callFrom(phone, 'b-first');
    await db.rpc('move_lead_to_stage', { p_lead_id: first.id, p_stage_id: stagesByName['Won'].id, p_moved_by: null, p_lost_reason: null });

    const second = await callFrom(phone, 'b-second');
    expect(second.merged_into_lead_id).toBeNull();
  });

  it('(d) a repeat call SHORTLY after the original reached Lost (e.g. Missed Calls) merges into it', async () => {
    const phone = `+1801${String(runId).slice(-6)}8`;
    const first = await callFrom(phone, 'c-first');
    await db.rpc('move_lead_to_stage', { p_lead_id: first.id, p_stage_id: stagesByName['Lost'].id, p_moved_by: null, p_lost_reason: 'test' });

    // Both calls occur "now" in wall-clock terms — well inside the 3-hour window.
    const second = await callFrom(phone, 'c-second');
    expect(second.merged_into_lead_id).toBe(first.id);
  });

  it('(e) a repeat call LONG after the original reached Lost creates a genuinely new lead', async () => {
    const phone = `+1801${String(runId).slice(-6)}5`;
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const first = await callFrom(phone, 'f-first', fiveHoursAgo);
    await db.rpc('move_lead_to_stage', { p_lead_id: first.id, p_stage_id: stagesByName['Lost'].id, p_moved_by: null, p_lost_reason: 'test' });

    // Second call "now" — 5 hours after the first, outside the 3-hour window.
    const second = await callFrom(phone, 'f-second');
    expect(second.merged_into_lead_id).toBeNull();
  });

  it('(c) a call from a phone with no prior lead creates a normal new lead', async () => {
    const phone = `+1801${String(runId).slice(-6)}7`;
    const lead = await callFrom(phone, 'd-first');
    expect(lead.merged_into_lead_id).toBeNull();
    expect(lead.id).toBeTruthy();
  });

  it('a redelivered webhook for the same call never re-runs the merge check', async () => {
    const phone = `+1801${String(runId).slice(-6)}6`;
    const first = await callFrom(phone, 'e-first');
    const second = await callFrom(phone, 'e-second');
    expect(second.merged_into_lead_id).toBe(first.id);

    // Redeliver the "recording ready" webhook for the SAME callrail_id as the
    // second call — must update in place, not re-evaluate the merge (and
    // must not un-merge it).
    const redelivered = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-merge-e-second-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 45,
      p_spam_flag: false,
      p_recording_url: 'https://app.callrail.com/recordings/test.mp3',
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true, stage: 'recording_ready' },
    });
    expect(redelivered.merged_into_lead_id).toBe(first.id);

    const rows = await db.select('inbound_leads', `callrail_id=eq.test-merge-e-second-${runId}`);
    expect(rows).toHaveLength(1);
  });
});
