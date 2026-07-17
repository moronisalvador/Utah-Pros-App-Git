/**
 * ════════════════════════════════════════════════
 * FILE: crm_shared_rpc_compat.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Phase F changed two database functions the CRM already ships and uses.
 *   This proves those changes are backward-compatible — that the code already
 *   in production keeps working exactly as before. It calls move_lead_to_stage
 *   the old three-argument way (the way the Leads board calls it today) and
 *   checks it still moves the lead AND now also records a history row; it then
 *   uses the new fourth argument to record a lost reason; and it asks
 *   get_contact_activity for a contact's timeline and checks it still returns
 *   the same shape of rows (the function only gained extra kinds of activity).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs, pipeline_stages, lead_stage_history,
 *                       inbound_leads · writes → inbound_leads/contacts via
 *              create_manual_lead, lead_pipeline_stage + lead_stage_history via
 *              move_lead_to_stage; all TEST-org, cleaned up in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - lead_stage_history + lead_pipeline_stage rows CASCADE-delete with the
 *     lead, so deleting the inbound_leads row in afterAll clears them too.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM — shared RPC replaces stay backward-compatible (integration)', () => {
  const runId = Date.now();
  const phone = `+1533${String(runId).slice(-7)}`;
  let orgId;
  let leadId;
  let contactId;
  let openStageId;
  let lostStageId;

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    const stages = await db.rpc('get_pipeline_stages', { p_org_id: orgId });
    openStageId = stages.find(s => !s.is_won && !s.is_lost)?.id || stages[0].id;
    lostStageId = stages.find(s => s.is_lost)?.id || stages[stages.length - 1].id;

    const lead = await db.rpc('create_manual_lead', {
      p_name: 'Compat Test', p_phone: phone, p_source: 'Referral', p_org_id: orgId,
    });
    leadId = lead.id;
    contactId = lead.contact_id;
  });

  afterAll(async () => {
    await db.delete('inbound_leads', `id=eq.${leadId}`);
    await db.delete('contacts', `phone=eq.${encodeURIComponent(phone)}`);
  });

  it('the shipped 3-arg move_lead_to_stage call still succeeds and now writes history', async () => {
    // Exactly how CrmLeads.jsx calls it today — no p_lost_reason.
    const row = await db.rpc('move_lead_to_stage', {
      p_lead_id: leadId, p_stage_id: openStageId, p_moved_by: null,
    });
    expect(row.stage_id).toBe(openStageId);

    const history = await db.select('lead_stage_history', `lead_id=eq.${leadId}&select=stage_id`);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.stage_id === openStageId)).toBe(true);
  });

  it('the new p_lost_reason arg records the reason on the lead', async () => {
    await db.rpc('move_lead_to_stage', {
      p_lead_id: leadId, p_stage_id: lostStageId, p_moved_by: null, p_lost_reason: 'Went with competitor',
    });
    const [lead] = await db.select('inbound_leads', `id=eq.${leadId}&select=lost_reason`);
    expect(lead.lost_reason).toBe('Went with competitor');
  });

  it('get_contact_activity keeps its additive shape (same columns)', async () => {
    const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });
    expect(Array.isArray(rows)).toBe(true);
    // At least the lead itself shows up, with the unchanged column shape.
    const lead = rows.find(r => r.activity_type === 'lead');
    expect(lead).toBeTruthy();
    for (const key of ['activity_type', 'occurred_at', 'title', 'body', 'meta']) {
      expect(key in lead).toBe(true);
    }
  });

  it('get_contact_activity now surfaces transcript_analysis in meta (2026-07-17 additive replace)', async () => {
    const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });
    const lead = rows.find(r => r.activity_type === 'lead');
    expect(lead).toBeTruthy();
    // This test lead was never transcribed, so the value is null — the point is
    // the KEY exists (the UI can read meta.transcript_analysis without a
    // separate fetch), not that every lead has a populated analysis.
    expect('transcript_analysis' in lead.meta).toBe(true);
  });
});
