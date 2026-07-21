/**
 * ════════════════════════════════════════════════
 * FILE: crm_auto_qualify_contact.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the new crm_auto_qualify_contact database function against the real
 *   database. It only creates/links a contact when a lead clears ALL of a
 *   narrow set of signals at once (a captured first+last name, a real phone
 *   number, a genuine in-scope inquiry, not spam) — and it must NEVER create a
 *   duplicate contact when one already exists for that phone number. All test
 *   rows are tagged with disposable test data and deleted when the test
 *   finishes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → inbound_leads, contacts
 *              writes → inbound_leads.contact_id, contacts (via
 *                       crm_auto_qualify_contact RPC); a seeded lead + contact
 *                       per case; all test rows deleted in afterEach/afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Needs real
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — self-skips via
 *     describe.skipIf when absent, same as the other crm_* integration suites,
 *     since this project's local dev environment runs as the anon role and
 *     most RPCs here are `authenticated`-only (see CLAUDE.md's Local Dev
 *     section) — the reliable way to prove this live is a direct SQL fixture
 *     check (insert fixtures, call the RPC, assert, clean up), same as this file.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm_auto_qualify_contact (integration)', () => {
  const runId = Date.now();
  const leadIds = [];
  const contactPhones = [];
  let testOrgId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
    for (const phone of contactPhones) {
      await db.delete('contacts', `phone=eq.${encodeURIComponent(phone)}`);
    }
  });

  async function seedLead({ caller_number, ...overrides } = {}) {
    const phone = caller_number ?? `+1801${String(runId).slice(-6)}${leadIds.length}`;
    const [lead] = await db.insert('inbound_leads', {
      org_id: testOrgId,
      source_type: 'call',
      callrail_id: `test-aqc-${runId}-${leadIds.length}`,
      spam_flag: false,
      lead_status: 'new',
      occurred_at: new Date().toISOString(),
      ...overrides,
      caller_number: phone,
    });
    leadIds.push(lead.id);
    return lead;
  }

  const qualifyingAnalysis = { is_customer_inquiry: true, service_match: 'in_scope' };

  it('creates a new contact and links it when every signal clears', async () => {
    const lead = await seedLead({ caller_name: 'Jake Nelson', transcript_analysis: qualifyingAnalysis });
    contactPhones.push(lead.caller_number);

    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });

    expect(contact).not.toBeNull();
    expect(contact.name).toBe('Jake Nelson');
    expect(contact.phone).toBe(lead.caller_number);

    const [updated] = await db.select('inbound_leads', `id=eq.${lead.id}`);
    expect(updated.contact_id).toBe(contact.id);
  });

  it('links to an existing contact by phone instead of creating a duplicate', async () => {
    const lead = await seedLead({ caller_name: 'Colton Reyes', transcript_analysis: qualifyingAnalysis });
    contactPhones.push(lead.caller_number);
    const [seeded] = await db.insert('contacts', { phone: lead.caller_number, name: 'Colton Reyes' });

    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact.id).toBe(seeded.id);

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(lead.caller_number)}`);
    expect(contacts).toHaveLength(1); // still exactly one — never duplicated
  });

  it('no-ops when the lead is already linked to a contact', async () => {
    const lead = await seedLead({ caller_name: 'Already Linked', transcript_analysis: qualifyingAnalysis });
    contactPhones.push(lead.caller_number);
    const [existing] = await db.insert('contacts', { phone: `+1801${String(runId).slice(-6)}9`, name: 'Existing Contact' });
    contactPhones.push(existing.phone);
    await db.update('inbound_leads', `id=eq.${lead.id}`, { contact_id: existing.id });

    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact.id).toBe(existing.id);

    const [unchanged] = await db.select('inbound_leads', `id=eq.${lead.id}`);
    expect(unchanged.contact_id).toBe(existing.id);
  });

  it('does NOT create a contact when only a first name was captured (no space)', async () => {
    const lead = await seedLead({ caller_name: 'Jake', transcript_analysis: qualifyingAnalysis });

    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact).toBeNull();

    const [unchanged] = await db.select('inbound_leads', `id=eq.${lead.id}`);
    expect(unchanged.contact_id).toBeNull();
  });

  it('does NOT create a contact when spam-flagged', async () => {
    const lead = await seedLead({ caller_name: 'Spam Flagged', spam_flag: true, transcript_analysis: qualifyingAnalysis });
    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact).toBeNull();
  });

  it('does NOT create a contact when the call is not a real customer inquiry', async () => {
    const lead = await seedLead({
      caller_name: 'Not A Customer',
      transcript_analysis: { is_customer_inquiry: false, service_match: null },
    });
    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact).toBeNull();
  });

  it('does NOT create a contact when the service is out of scope', async () => {
    const lead = await seedLead({
      caller_name: 'Out Of Scope',
      transcript_analysis: { is_customer_inquiry: true, service_match: 'out_of_scope' },
    });
    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact).toBeNull();
  });

  it('falls back to transcript_analysis.customer_full_name when caller_name has no last name', async () => {
    const lead = await seedLead({
      caller_name: 'Silvina',
      transcript_analysis: { ...qualifyingAnalysis, customer_full_name: 'Silvina Wright' },
    });
    contactPhones.push(lead.caller_number);

    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact.name).toBe('Silvina Wright');
  });

  it('skips (does not guess) when two existing contacts ambiguously share the same phone digits', async () => {
    const digits = `801${String(runId).slice(-6)}9`;
    const lead = await seedLead({ caller_name: 'Ambiguous Match', transcript_analysis: qualifyingAnalysis, caller_number: `+1${digits}` });
    const [c1] = await db.insert('contacts', { phone: `+1${digits}`, name: 'First Match' });
    const [c2] = await db.insert('contacts', { phone: digits, name: 'Second Match' }); // same digits, different format
    contactPhones.push(c1.phone, c2.phone);

    const contact = await db.rpc('crm_auto_qualify_contact', { p_lead_id: lead.id });
    expect(contact).toBeNull();

    const [unchanged] = await db.select('inbound_leads', `id=eq.${lead.id}`);
    expect(unchanged.contact_id).toBeNull();
  });
});
