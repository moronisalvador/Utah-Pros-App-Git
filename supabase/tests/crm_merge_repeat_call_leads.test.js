/**
 * ════════════════════════════════════════════════
 * FILE: crm_merge_repeat_call_leads.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the duplicate-lead merge rules — one person, one card. A second
 *   call from the same phone number merges into the existing lead (no second
 *   Kanban card, visible instead as a "Follow-up call" entry on the
 *   original's activity timeline) under FOUR tiers
 *   (20260722_crm_dedup_repeat_caller_leads, owner-directed after the Won
 *   column double-counted a repeat caller):
 *     open/stage-less lead → always merge;
 *     RECOVERABLE terminal (Missed Calls) → always merge, NO time window (a
 *       redial of an un-handled caller is the same pending inquiry — the old
 *       3-hour lost-window created a duplicate for every redial-after-3h
 *       once missed calls started auto-staging);
 *     WON within 30 days → merge (a post-win call is logistics about the
 *       job just sold — REVERSES the 2026-07-20 "call after Won = new lead"
 *       rule; after 30 days a call is genuinely new business → new card);
 *     LOST proper within 3 hours → merge; later → a genuinely new lead.
 *   A call from a phone with no prior lead always creates a normal new lead.
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
    expect(stagesByName['Missed Calls']).toBeTruthy();
    expect(stagesByName['Missed Calls'].is_recoverable).toBe(true);
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

  it('(b) a repeat call within 30 days of Won MERGES into the won lead (post-win calls are job logistics)', async () => {
    const phone = `+1801${String(runId).slice(-6)}9`;
    const first = await callFrom(phone, 'b-first');
    await db.rpc('move_lead_to_stage', { p_lead_id: first.id, p_stage_id: stagesByName['Won'].id, p_moved_by: null, p_lost_reason: null });

    const second = await callFrom(phone, 'b-second');
    expect(second.merged_into_lead_id).toBe(first.id);

    // The human's Won judgment survives; the merged call owns no card.
    const [row] = await db.select('lead_pipeline_stage', `lead_id=eq.${first.id}&select=stage_id`);
    expect(row.stage_id).toBe(stagesByName['Won'].id);
    expect(await db.select('lead_pipeline_stage', `lead_id=eq.${second.id}`)).toHaveLength(0);
    // (The >30-days-after-Won → new-lead branch can't be simulated here — the
    // won move's timestamp is server-stamped and not backdatable through any
    // RPC — so it is pinned by the migration's reviewed SQL, not this suite.)
  });

  it('(b2) a redial LONG after landing in Missed Calls (recoverable) still merges — no time window', async () => {
    const phone = `+1801${String(runId).slice(-6)}4`;
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    // Unanswered → auto-staged into Missed Calls (is_lost + is_recoverable).
    const first = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-merge-b2-first-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 8,
      p_spam_flag: false,
      p_occurred_at: fiveHoursAgo.toISOString(),
      p_raw_payload: { answered: 'false' },
    });
    leadIds.push(first.id);
    const [staged] = await db.select('lead_pipeline_stage', `lead_id=eq.${first.id}&select=stage_id`);
    expect(staged.stage_id).toBe(stagesByName['Missed Calls'].id);

    // Redial 5 hours later — far outside the old 3-hour lost-window — merges.
    const second = await callFrom(phone, 'b2-second');
    expect(second.merged_into_lead_id).toBe(first.id);
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

  it('(b3) when two tiers match at once, the MOST-ALIVE candidate wins (recoverable beats won)', async () => {
    const phone = `+1801${String(runId).slice(-6)}3`;

    // Two simultaneously-matching candidates can no longer ARISE through the
    // RPC (that is the whole point of the fix), so this legacy shape is built
    // by direct insert — it mirrors exactly the pre-fix duplicate pairs the
    // backfill cleaned up.
    const [won] = await db.insert('inbound_leads', {
      org_id: testOrgId, source_type: 'call', caller_number: phone,
      callrail_id: `test-merge-b3-won-${runId}`, duration_sec: 60,
      spam_flag: false, occurred_at: new Date().toISOString(), raw_payload: { test: true },
    });
    leadIds.push(won.id);
    const [missed] = await db.insert('inbound_leads', {
      org_id: testOrgId, source_type: 'call', caller_number: phone,
      callrail_id: `test-merge-b3-missed-${runId}`, duration_sec: 8,
      spam_flag: false, occurred_at: new Date().toISOString(), raw_payload: { test: true },
    });
    leadIds.push(missed.id);

    await db.rpc('move_lead_to_stage', { p_lead_id: won.id, p_stage_id: stagesByName['Won'].id, p_moved_by: null, p_lost_reason: null });
    await db.rpc('move_lead_to_stage', { p_lead_id: missed.id, p_stage_id: stagesByName['Missed Calls'].id, p_moved_by: null, p_lost_reason: null });

    // Both match; the recoverable (tier 1) must beat the won (tier 2) —
    // an un-handled caller outranks a closed sale as the live inquiry.
    const third = await callFrom(phone, 'b3-third');
    expect(third.merged_into_lead_id).toBe(missed.id);
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
