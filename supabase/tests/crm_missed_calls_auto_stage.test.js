/**
 * ════════════════════════════════════════════════
 * FILE: crm_missed_calls_auto_stage.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves missed calls stage themselves into the "Missed Calls" pipeline
 *   column automatically (migration 20260722_crm_auto_stage_missed_calls).
 *   Before this fix, NOTHING ever moved a lead there — all 19 historical
 *   placements came from one manual session on 2026-07-21, so the column's
 *   count froze the moment the human stopped sorting (owner-reported live:
 *   4 new missed calls, number unchanged since yesterday).
 *
 *   The rule under test, exactly as CallRail delivers webhooks:
 *   - call-started delivery (no 'answered' key yet) → NO stage (a ringing
 *     call is never prematurely marked missed)
 *   - call-completed with answered:'false' → staged into Missed Calls via
 *     move_lead_to_stage (history row, moved_by NULL = system)
 *   - answered:'true' → never staged
 *   - an existing stage row (human/AI placement) is never overridden
 *   - a merged redial never gets its own stage row
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → pipeline_stages, lead_pipeline_stage,
 *                       lead_stage_history
 *              writes → inbound_leads (via upsert_lead_from_callrail RPC,
 *                       TEST-org fixtures), deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the sibling CRM suites.
 *   - The TEST org carries its own "Missed Calls" stage (created 2026-07-22
 *     to mirror prod). If an org lacks that stage the function no-ops
 *     gracefully — covered implicitly by the function's design, not asserted
 *     here (we won't delete the TEST org's stage mid-suite).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('missed calls auto-stage into "Missed Calls" (integration)', () => {
  const runId = Date.now();
  let orgId;
  let missedStageId;
  let qualifiedStageId;
  const leadIds = [];

  const deliver = async (label, payload, extra = {}) => {
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-autostage-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: orgId,
      p_caller_number: extra.phone || `+1801${String(runId).slice(-7)}`,
      p_duration_sec: extra.duration ?? 19,
      p_spam_flag: extra.spam ?? false,
      p_occurred_at: (extra.occurredAt || new Date()).toISOString(),
      p_raw_payload: payload,
    });
    if (!leadIds.includes(lead.id)) leadIds.push(lead.id);
    return lead;
  };

  const stageOf = async (leadId) => {
    const rows = await db.select(
      'lead_pipeline_stage',
      `lead_id=eq.${leadId}&select=stage_id,stage:pipeline_stages(name)`,
    );
    return rows[0]?.stage?.name ?? null;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${orgId}`);
    missedStageId = stages.find((s) => s.name === 'Missed Calls')?.id;
    qualifiedStageId = stages.find((s) => s.name === 'Qualified')?.id;
    expect(missedStageId).toBeTruthy();
    expect(qualifiedStageId).toBeTruthy();
  });

  afterAll(async () => {
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
  });

  it('call-started delivery (no answered key) does NOT stage', async () => {
    const lead = await deliver('a', { call_started: true }, { duration: null, phone: `+1801${String(runId).slice(-6)}1` });
    expect(await stageOf(lead.id)).toBeNull();
  });

  it('call-completed with answered:"false" stages into Missed Calls, moved_by NULL', async () => {
    // Same callrail_id as the started delivery above — the real webhook sequence.
    const lead = await deliver('a', { answered: 'false', call_completed: true }, { phone: `+1801${String(runId).slice(-6)}1` });
    expect(await stageOf(lead.id)).toBe('Missed Calls');

    const history = await db.select('lead_stage_history', `lead_id=eq.${lead.id}&select=moved_by,stage_id`);
    expect(history).toHaveLength(1);
    expect(history[0].moved_by).toBeNull(); // system move, not a human
    expect(history[0].stage_id).toBe(missedStageId);
  });

  it('an answered call is never staged', async () => {
    const lead = await deliver('b', { answered: 'true', call_completed: true }, { duration: 120, phone: `+1801${String(runId).slice(-6)}2` });
    expect(await stageOf(lead.id)).toBeNull();
  });

  it('a human placement is never overridden by a later delivery', async () => {
    const lead = await deliver('c', { call_started: true }, { duration: null, phone: `+1801${String(runId).slice(-6)}3` });
    await db.rpc('move_lead_to_stage', { p_lead_id: lead.id, p_stage_id: qualifiedStageId, p_moved_by: null, p_lost_reason: null });

    // Completed delivery arrives late, says unanswered — must NOT demote the
    // human's Qualified placement.
    await deliver('c', { answered: 'false', call_completed: true }, { phone: `+1801${String(runId).slice(-6)}3` });
    expect(await stageOf(lead.id)).toBe('Qualified');
  });

  it('a merged redial never gets its own stage row', async () => {
    const phone = `+1801${String(runId).slice(-6)}4`;
    const first = await deliver('d1', { answered: 'false', call_completed: true }, { phone });
    expect(await stageOf(first.id)).toBe('Missed Calls');

    // Redial 10 minutes later, also missed — merges into the first (3h Lost
    // window) and must not create a second Missed Calls card.
    const second = await deliver('d2', { answered: 'false', call_completed: true }, { phone });
    expect(second.merged_into_lead_id).toBe(first.id);
    expect(await stageOf(second.id)).toBeNull();
  });
});
