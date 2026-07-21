/**
 * ════════════════════════════════════════════════
 * FILE: crm_call_ai_enrichment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two AI-driven call-enrichment helpers: set_lead_spam_flag
 *   (auto-flags a lead as spam, with an audit trail, and never double-logs a
 *   no-op write) and set_lead_contact_details (backfills a blank email/address
 *   on an ALREADY-linked contact only — never overwrites a real value, never
 *   creates a contact).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → inbound_leads, contacts, system_events
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

describe.skipIf(!hasCreds)('set_lead_spam_flag / set_lead_contact_details (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  const cleanup = { contactIds: [], leadIds: [] };

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    if (cleanup.leadIds.length) await db.delete('inbound_leads', `id=in.(${cleanup.leadIds.join(',')})`);
    if (cleanup.contactIds.length) await db.delete('contacts', `id=in.(${cleanup.contactIds.join(',')})`);
  });

  async function seedLead(label, { contact = true } = {}) {
    const phone = `+1560${String(runId).slice(-6)}${cleanup.leadIds.length}`;
    let contactId = null;
    if (contact) {
      const [c] = await db.insert('contacts', { phone, name: `Enrichment Test ${label}` });
      cleanup.contactIds.push(c.id);
      contactId = c.id;
    }
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-enrichment-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 30,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    cleanup.leadIds.push(lead.id);
    return { leadId: lead.id, contactId: contact ? contactId : null };
  }

  describe('set_lead_spam_flag', () => {
    it('flags a lead as spam and logs a system_events row', async () => {
      const { leadId } = await seedLead('spam1');
      const row = await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true, p_reason: 'ai_detected_caller_never_responded' });
      expect(row.spam_flag).toBe(true);

      const [event] = await db.select('system_events', `entity_id=eq.${leadId}&event_type=eq.crm_lead_spam_flag_set&order=created_at.desc&limit=1`);
      expect(event?.payload?.reason).toBe('ai_detected_caller_never_responded');
    });

    it('is a no-op write (no duplicate audit row) when the value already matches', async () => {
      const { leadId } = await seedLead('spam2');
      await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true });
      await db.rpc('set_lead_spam_flag', { p_lead_id: leadId, p_spam: true }); // same value again

      const events = await db.select('system_events', `entity_id=eq.${leadId}&event_type=eq.crm_lead_spam_flag_set`);
      expect(events.length).toBe(1);
    });

    it('throws for an unknown lead id', async () => {
      await expect(
        db.rpc('set_lead_spam_flag', { p_lead_id: '00000000-0000-0000-0000-000000000000', p_spam: true })
      ).rejects.toThrow();
    });
  });

  describe('set_lead_contact_details', () => {
    it('fills a blank email/address on the linked contact', async () => {
      const { leadId, contactId } = await seedLead('fill1');
      await db.rpc('set_lead_contact_details', { p_lead_id: leadId, p_email: 'Jane@Example.com', p_address: '123 Main St' });

      const [contact] = await db.select('contacts', `id=eq.${contactId}`);
      expect(contact.email).toBe('Jane@Example.com');
      expect(contact.billing_address).toBe('123 Main St');
    });

    it('never overwrites an already-set email/address', async () => {
      const { leadId, contactId } = await seedLead('fill2');
      await db.update('contacts', `id=eq.${contactId}`, { email: 'existing@example.com', billing_address: '999 Existing Ave' });
      await db.rpc('set_lead_contact_details', { p_lead_id: leadId, p_email: 'new@example.com', p_address: '1 New St' });

      const [contact] = await db.select('contacts', `id=eq.${contactId}`);
      expect(contact.email).toBe('existing@example.com');
      expect(contact.billing_address).toBe('999 Existing Ave');
    });

    it('never creates a contact for a lead with no contact_id', async () => {
      const { leadId } = await seedLead('nolink', { contact: false });
      const result = await db.rpc('set_lead_contact_details', { p_lead_id: leadId, p_email: 'new@example.com', p_address: '1 New St' });
      expect(result).toBeNull();
    });

    it('throws for an unknown lead id', async () => {
      await expect(
        db.rpc('set_lead_contact_details', { p_lead_id: '00000000-0000-0000-0000-000000000000', p_email: 'x@example.com' })
      ).rejects.toThrow();
    });
  });
});
