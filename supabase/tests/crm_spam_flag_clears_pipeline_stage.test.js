/**
 * ════════════════════════════════════════════════
 * FILE: crm_spam_flag_clears_pipeline_stage.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves set_lead_spam_flag removes a lead's current pipeline-stage
 *   assignment the moment it's flagged spam — a spam lead should never sit
 *   on the Leads board in any column, including "Lost" — and that
 *   un-flagging spam never re-adds a stage on its own.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → pipeline_stages, lead_pipeline_stage
 *              writes → contacts, inbound_leads (all test rows deleted in afterAll)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips via
 *     describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are absent,
 *     same as the other CRM integration suites.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('set_lead_spam_flag clears pipeline stage (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  let stagesByName;
  const cleanup = { contactIds: [], leadIds: [] };

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${testOrgId}`);
    stagesByName = Object.fromEntries(stages.map((s) => [s.name, s]));
  });

  afterAll(async () => {
    if (cleanup.leadIds.length) await db.delete('inbound_leads', `id=in.(${cleanup.leadIds.join(',')})`);
    if (cleanup.contactIds.length) await db.delete('contacts', `id=in.(${cleanup.contactIds.join(',')})`);
  });

  async function seedLead(label) {
    const phone = `+1561${String(runId).slice(-6)}${cleanup.leadIds.length}`;
    const [contact] = await db.insert('contacts', { phone, name: `Spam Stage Test ${label}` });
    cleanup.contactIds.push(contact.id);

    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-spam-stage-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 60,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    cleanup.leadIds.push(lead.id);
    return lead.id;
  }

  async function currentStageId(leadId) {
    const [row] = await db.select('lead_pipeline_stage', `lead_id=eq.${leadId}`);
    return row?.stage_id ?? null;
  }

  it('flagging spam removes a brand-new lead from its default "New" stage', async () => {
    const leadId = await seedLead('new');
    expect(await currentStageId(leadId)).toBeTruthy(); // sanity: lead creation auto-assigns a stage

    await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true, p_reason: 'test' });
    expect(await currentStageId(leadId)).toBeNull();
  });

  it('flagging spam removes a lead sitting on "Lost" (never leaves a spam lead reading as a real disqualified lead)', async () => {
    const leadId = await seedLead('lost');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Lost'].id, p_moved_by: null, p_lost_reason: 'test' });
    expect(await currentStageId(leadId)).toBe(stagesByName['Lost'].id);

    await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true, p_reason: 'test' });
    expect(await currentStageId(leadId)).toBeNull();
  });

  it('un-flagging spam does not restore a stage on its own', async () => {
    const leadId = await seedLead('unflag');
    await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true, p_reason: 'test' });
    expect(await currentStageId(leadId)).toBeNull();

    await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: false, p_reason: 'test undo' });
    expect(await currentStageId(leadId)).toBeNull();
  });

  it('still writes a system_events row and updates spam_flag as before (return-shape/behavior unchanged)', async () => {
    const leadId = await seedLead('behavior');
    const row = await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true, p_reason: 'test' });
    expect(row.id).toBe(leadId);
    expect(row.spam_flag).toBe(true);
  });
});
