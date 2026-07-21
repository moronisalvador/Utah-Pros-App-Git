/**
 * ════════════════════════════════════════════════
 * FILE: crm_disqualify_lead_if_open.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves crm_disqualify_lead_if_open — the helper the transcription worker
 *   calls when the AI detects a real inquiry for a service Utah Pros doesn't
 *   offer — moves an OPEN lead to the org's "Lost" stage with the given
 *   reason, and never touches a spam-flagged lead or a lead already on a
 *   terminal Won/Lost stage.
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
 *   - Uses the test org's real "Lost" stage — not a fixture stage.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm_disqualify_lead_if_open (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  let stagesByName;
  const cleanup = { contactIds: [], leadIds: [] };

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${testOrgId}`);
    stagesByName = Object.fromEntries(stages.map((s) => [s.name, s]));
    expect(stagesByName['Lost']).toBeTruthy(); // sanity: the org has a Lost stage
  });

  afterAll(async () => {
    if (cleanup.leadIds.length) await db.delete('inbound_leads', `id=in.(${cleanup.leadIds.join(',')})`);
    if (cleanup.contactIds.length) await db.delete('contacts', `id=in.(${cleanup.contactIds.join(',')})`);
  });

  async function seedLead(label, { spam = false } = {}) {
    const phone = `+1560${String(runId).slice(-6)}${cleanup.leadIds.length}`;
    const [contact] = await db.insert('contacts', { phone, name: `Disqualify Test ${label}` });
    cleanup.contactIds.push(contact.id);

    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-disqualify-${label}-${runId}`,
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

  async function currentStage(leadId) {
    const [row] = await db.select('lead_pipeline_stage', `lead_id=eq.${leadId}`);
    const [lead] = await db.select('inbound_leads', `id=eq.${leadId}&select=lost_reason`);
    const stage = row ? Object.values(stagesByName).find((s) => s.id === row.stage_id) : null;
    return { name: stage?.name ?? null, lostReason: lead?.lost_reason ?? null };
  }

  it('moves a brand-new (open) lead to Lost with the given reason', async () => {
    const leadId = await seedLead('new');
    await db.rpc('crm_disqualify_lead_if_open', { p_lead_id: leadId, p_reason: 'Wanted HVAC cleaning — not a service we offer' });
    const { name, lostReason } = await currentStage(leadId);
    expect(name).toBe('Lost');
    expect(lostReason).toBe('Wanted HVAC cleaning — not a service we offer');
  });

  it('moves a lead sitting on any earlier open stage to Lost (not a sort_order-forward-only move)', async () => {
    const leadId = await seedLead('qualified');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Qualified'].id, p_moved_by: null, p_lost_reason: null });
    await db.rpc('crm_disqualify_lead_if_open', { p_lead_id: leadId, p_reason: 'test' });
    expect((await currentStage(leadId)).name).toBe('Lost');
  });

  it('never moves a lead off a terminal Won stage', async () => {
    const leadId = await seedLead('won');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Won'].id, p_moved_by: null, p_lost_reason: null });
    await db.rpc('crm_disqualify_lead_if_open', { p_lead_id: leadId, p_reason: 'test' });
    expect((await currentStage(leadId)).name).toBe('Won');
  });

  it('never re-moves a lead already on Lost (no-op, keeps original reason)', async () => {
    const leadId = await seedLead('alreadylost');
    await db.rpc('move_lead_to_stage', { p_lead_id: leadId, p_stage_id: stagesByName['Lost'].id, p_moved_by: null, p_lost_reason: 'original reason' });
    await db.rpc('crm_disqualify_lead_if_open', { p_lead_id: leadId, p_reason: 'new reason' });
    const { name, lostReason } = await currentStage(leadId);
    expect(name).toBe('Lost');
    expect(lostReason).toBe('original reason');
  });

  it('never moves a spam-flagged lead', async () => {
    const leadId = await seedLead('spam', { spam: true });
    await db.rpc('crm_disqualify_lead_if_open', { p_lead_id: leadId, p_reason: 'test' });
    expect((await currentStage(leadId)).name).not.toBe('Lost');
  });

  it('is a no-op for an unknown lead id', async () => {
    await expect(
      db.rpc('crm_disqualify_lead_if_open', { p_lead_id: '00000000-0000-0000-0000-000000000000', p_reason: 'test' })
    ).resolves.not.toThrow();
  });
});
