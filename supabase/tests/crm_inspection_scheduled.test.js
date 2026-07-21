/**
 * ════════════════════════════════════════════════
 * FILE: crm_inspection_scheduled.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves crm_advance_lead_if_forward — the helper the transcription worker
 *   calls when the AI detects a call ended with a real inspection scheduled —
 *   moves a lead to "Inspection Scheduled" when that's a step forward, and
 *   never moves a lead backward, off a terminal Won/Lost stage, or a spam lead.
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
 *   - Uses the test org's real "Inspection Scheduled" stage seeded by
 *     20260721_crm_inspection_scheduled_stage.sql — not a fixture stage.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm_advance_lead_if_forward (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  let stagesByName;
  const cleanup = { contactIds: [], leadIds: [] };

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${testOrgId}`);
    stagesByName = Object.fromEntries(stages.map((s) => [s.name, s]));
    expect(stagesByName['Inspection Scheduled']).toBeTruthy(); // sanity: seed migration ran
  });

  afterAll(async () => {
    if (cleanup.leadIds.length) await db.delete('inbound_leads', `id=in.(${cleanup.leadIds.join(',')})`);
    if (cleanup.contactIds.length) await db.delete('contacts', `id=in.(${cleanup.contactIds.join(',')})`);
  });

  async function seedLead(label, { spam = false } = {}) {
    const phone = `+1559${String(runId).slice(-6)}${cleanup.leadIds.length}`;
    const [contact] = await db.insert('contacts', { phone, name: `Inspection Test ${label}` });
    cleanup.contactIds.push(contact.id);

    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-inspection-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 60,
      p_spam_flag: spam,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    cleanup.leadIds.push(lead.id);
    return lead.id;
  }

  async function currentStageName(leadId) {
    const [row] = await db.select('lead_pipeline_stage', `lead_id=eq.${leadId}`);
    if (!row) return null;
    const stage = Object.values(stagesByName).find((s) => s.id === row.stage_id);
    return stage?.name ?? null;
  }

  it('moves a brand-new lead forward to Inspection Scheduled', async () => {
    const leadId = await seedLead('new');
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: leadId, p_stage_name: 'Inspection Scheduled' });
    expect(await currentStageName(leadId)).toBe('Inspection Scheduled');
  });

  it('never moves a lead backward from a later stage', async () => {
    const leadId = await seedLead('later');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Estimate Sent'].id, p_moved_by: null, p_lost_reason: null });
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: leadId, p_stage_name: 'Inspection Scheduled' });
    expect(await currentStageName(leadId)).toBe('Estimate Sent');
  });

  it('never moves a lead off a terminal Won stage', async () => {
    const leadId = await seedLead('won');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Won'].id, p_moved_by: null, p_lost_reason: null });
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: leadId, p_stage_name: 'Inspection Scheduled' });
    expect(await currentStageName(leadId)).toBe('Won');
  });

  it('never moves a lead off a terminal Lost stage', async () => {
    const leadId = await seedLead('lost');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Lost'].id, p_moved_by: null, p_lost_reason: 'test' });
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: leadId, p_stage_name: 'Inspection Scheduled' });
    expect(await currentStageName(leadId)).toBe('Lost');
  });

  it('never moves a spam-flagged lead', async () => {
    const leadId = await seedLead('spam', { spam: true });
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: leadId, p_stage_name: 'Inspection Scheduled' });
    expect(await currentStageName(leadId)).not.toBe('Inspection Scheduled');
  });

  it('is a no-op for an unknown lead id or stage name', async () => {
    await expect(
      db.rpc('crm_advance_lead_if_forward', { p_lead_id: '00000000-0000-0000-0000-000000000000', p_stage_name: 'Inspection Scheduled' })
    ).resolves.not.toThrow();

    const leadId = await seedLead('unknownstage');
    await db.rpc('crm_advance_lead_if_forward', { p_lead_id: leadId, p_stage_name: 'Not A Real Stage' });
    expect(await currentStageName(leadId)).not.toBe('Not A Real Stage');
  });
});
