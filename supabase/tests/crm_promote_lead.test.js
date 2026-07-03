/**
 * ════════════════════════════════════════════════
 * FILE: crm_promote_lead.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "Add as customer" database function works: turning a raw,
 *   contact-free call lead into a real customer contact. It checks that
 *   promoting creates one contact and links the lead, that promoting a second
 *   lead from the same phone reuses that one contact (never a duplicate), and
 *   that filling in a name later doesn't wipe out a name already on file.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs, contacts, inbound_leads
 *              writes → inbound_leads + contacts (via upsert_lead_from_callrail
 *                       and promote_lead_to_contact); all test rows deleted in
 *                       afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test vs the live shared Supabase; self-skips without creds
 *     (same pattern as the Phase 0/1 suites).
 *   - QBO-SAFE BY DESIGN (belt-and-suspenders): as of Phase B the
 *     `trg_qbo_customer_sync` trigger is a no-op (QBO customers are created at
 *     invoice/estimate time, not on contact insert), so no insert here can mint
 *     a QuickBooks customer. This suite additionally only ever creates a contact
 *     WITHOUT a name and adds the name via a later UPDATE — so it stays safe
 *     even if that trigger is ever restored.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM — promote_lead_to_contact (integration)', () => {
  const runId = Date.now();
  const phone = `+1557${String(runId).slice(-7)}`;
  let testOrgId;

  const callPayload = (callrailId) => ({
    p_callrail_id: callrailId, p_source_type: 'call', p_org_id: testOrgId,
    p_tracking_number: '+18015550100', p_caller_number: phone, p_duration_sec: 30,
    p_spam_flag: false, p_source: 'google', p_medium: 'cpc', p_campaign: 'test',
    p_recording_url: null, p_transcription: null, p_form_data: null, p_lead_status: 'new',
    p_value: null, p_direction: 'inbound', p_occurred_at: new Date().toISOString(),
    p_raw_payload: { test: true },
  });

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    await db.delete('inbound_leads', `caller_number=eq.${encodeURIComponent(phone)}`);
    await db.delete('contacts', `phone=eq.${encodeURIComponent(phone)}`);
  });

  it('promotes a contact-free lead: creates ONE contact (no name → no QBO sync) and links it', async () => {
    const lead = await db.rpc('upsert_lead_from_callrail', callPayload(`promote-a-${runId}`));
    expect(lead.contact_id).toBeNull();

    const promoted = await db.rpc('promote_lead_to_contact', {
      p_lead_id: lead.id, p_name: null, p_email: null, p_created_by: null,
    });
    expect(promoted.contact_id).not.toBeNull();

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}`);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBeFalsy();
  });

  it('a second lead from the same phone reuses the one contact; promoting with a name backfills it', async () => {
    // The contact now exists, so a fresh call links to it (never creates a second).
    const lead2 = await db.rpc('upsert_lead_from_callrail', callPayload(`promote-b-${runId}`));
    expect(lead2.contact_id).not.toBeNull();

    // Promote with a name → UPDATE the existing contact (no INSERT → no QBO trigger), backfilling the name.
    await db.rpc('promote_lead_to_contact', {
      p_lead_id: lead2.id, p_name: 'Backfilled Name', p_email: null, p_created_by: null,
    });

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}`);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe('Backfilled Name');
  });

  it('promoting again with a different name does NOT overwrite the existing name', async () => {
    const [existing] = await db.select('inbound_leads', `caller_number=eq.${encodeURIComponent(phone)}&select=id&limit=1`);
    await db.rpc('promote_lead_to_contact', {
      p_lead_id: existing.id, p_name: 'Should Not Overwrite', p_email: null, p_created_by: null,
    });

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}`);
    expect(contacts[0].name).toBe('Backfilled Name');
  });
});
