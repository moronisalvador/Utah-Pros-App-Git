/**
 * ════════════════════════════════════════════════
 * FILE: crm_advance_revives_recoverable_stages.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the owner's callback scenario end-to-end (migration
 *   20260722_crm_advance_revives_recoverable_stages): a missed call
 *   auto-stages into "Missed Calls"; the customer redials and the call is
 *   answered, so the redial MERGES into the original; the AI pass then runs
 *   on the redial row and fires crm_advance_lead_if_forward — which must
 *   (a) resolve the merged row to its canonical lead (never give the merged
 *   duplicate its own stage row — the merge design's core invariant), and
 *   (b) REVIVE the canonical out of "Missed Calls" (a recoverable terminal
 *   stage) to the forward stage. "Lost" and "Won" stay strictly terminal —
 *   a human's judgment is never overridden by the AI.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → pipeline_stages, lead_pipeline_stage
 *              writes → inbound_leads (upsert_lead_from_callrail RPC,
 *                       TEST-org fixtures), pipeline moves via
 *                       move_lead_to_stage / crm_advance_lead_if_forward;
 *                       all fixture leads deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the sibling CRM suites.
 *   - Relies on the TEST org's "Missed Calls" stage (is_lost + is_recoverable,
 *     seeded 2026-07-22) and its "Qualified"/"Lost" stages.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm_advance_lead_if_forward — merge resolution + recoverable revive (integration)', () => {
  const runId = Date.now();
  let orgId;
  let stagesByName;
  const leadIds = [];

  const deliver = async (label, phone, payload, duration = 19) => {
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-revive-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: orgId,
      p_caller_number: phone,
      p_duration_sec: duration,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: payload,
    });
    if (!leadIds.includes(lead.id)) leadIds.push(lead.id);
    return lead;
  };

  const stageOf = async (leadId) => {
    const rows = await db.select(
      'lead_pipeline_stage',
      `lead_id=eq.${leadId}&select=stage:pipeline_stages(name)`,
    );
    return rows[0]?.stage?.name ?? null;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${orgId}`);
    stagesByName = Object.fromEntries(stages.map((s) => [s.name, s]));
    expect(stagesByName['Missed Calls']).toBeTruthy();
    expect(stagesByName['Missed Calls'].is_recoverable).toBe(true);
    expect(stagesByName['Qualified']).toBeTruthy();
    expect(stagesByName['Lost']).toBeTruthy();
    expect(stagesByName['Lost'].is_recoverable).toBe(false);
  });

  afterAll(async () => {
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
  });

  it('the owner scenario: missed → auto-staged → answered redial merges → AI signal on the REDIAL revives the CANONICAL', async () => {
    const phone = `+1801${String(runId).slice(-7)}`;

    const canonical = await deliver('a1', phone, { answered: 'false' });
    expect(await stageOf(canonical.id)).toBe('Missed Calls');

    const redial = await deliver('a2', phone, { answered: 'true' }, 240);
    expect(redial.merged_into_lead_id).toBe(canonical.id);

    // The AI pass runs on the redial row (where the transcript lives).
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: redial.id, p_stage_name: 'Qualified' });

    expect(await stageOf(canonical.id)).toBe('Qualified');  // revived
    expect(await stageOf(redial.id)).toBeNull();            // merge invariant holds
  });

  it('"Lost" is NOT recoverable — the AI never overrides a human judgment', async () => {
    const phone = `+1801${String(runId).slice(-6)}9`;
    const lead = await deliver('b', phone, { answered: 'true' }, 60);
    await db.rpc('move_lead_to_stage', {
      p_lead_id: lead.id, p_stage_id: stagesByName['Lost'].id, p_moved_by: null, p_lost_reason: 'test',
    });

    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: lead.id, p_stage_name: 'Qualified' });
    expect(await stageOf(lead.id)).toBe('Lost');
  });

  it('never moves an ordinary open lead backward', async () => {
    const phone = `+1801${String(runId).slice(-6)}8`;
    const lead = await deliver('c', phone, { answered: 'true' }, 60);
    await db.rpc('move_lead_to_stage', {
      p_lead_id: lead.id, p_stage_id: stagesByName['Estimate Sent'].id, p_moved_by: null, p_lost_reason: null,
    });

    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: lead.id, p_stage_name: 'Qualified' });
    expect(await stageOf(lead.id)).toBe('Estimate Sent');
  });
});
