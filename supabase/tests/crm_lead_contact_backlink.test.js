/**
 * ════════════════════════════════════════════════
 * FILE: crm_lead_contact_backlink.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the lead→contact BACKLINK trigger (migration
 *   20260722_crm_lead_contact_backlink): when the office creates a contact
 *   AFTER a call already came in, any still-unconnected lead from that same
 *   phone number gets connected to the new contact automatically — with an
 *   audit row written to system_events. Also proves the three safety rails:
 *   two contacts sharing a phone number means nothing links (ambiguity
 *   guard), a lead that is already connected to someone is never re-pointed,
 *   and a lead whose caller number is too short/garbage is simply skipped.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs, inbound_leads, system_events
 *              writes → inbound_leads (via upsert_lead_from_callrail RPC +
 *                       one direct pre-link update in test (c)), contacts
 *                       (direct inserts/updates — that's what fires the
 *                       trigger under test); all fixture rows deleted in
 *                       afterAll (system_events cleanup best-effort).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 *   - FAILS until 20260722_crm_lead_contact_backlink.sql is applied — the
 *     trigger it exercises won't exist yet.
 *   - Run-unique phone numbers derive from Date.now(), so before/after
 *     assertions are deltas on this run's own fixtures, never absolute
 *     live-row counts.
 *   - Leads must be created BEFORE their matching contact in test (a): if
 *     the contact exists first, upsert_lead_from_callrail's forward link
 *     handles it at ingest and the backlink trigger never has work to do.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm lead→contact backlink trigger (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  const leadIds = [];
  const contactIds = [];

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    // Best-effort cleanup — system_events first (references the lead ids in
    // entity_id), then the leads and contacts themselves.
    if (leadIds.length) {
      await db.delete('system_events', `entity_id=in.(${leadIds.join(',')})&event_type=eq.crm_lead_backlinked`).catch(() => {});
      await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`).catch(() => {});
    }
    if (contactIds.length) {
      await db.delete('contacts', `id=in.(${contactIds.join(',')})`).catch(() => {});
    }
  });

  async function callFrom(phone, label) {
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-backlink-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 45,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    leadIds.push(lead.id);
    return lead;
  }

  async function addContact(phone, name) {
    const [contact] = await db.insert('contacts', { phone, name });
    contactIds.push(contact.id);
    return contact;
  }

  async function getLead(id) {
    const [row] = await db.select('inbound_leads', `id=eq.${id}&select=id,contact_id`);
    return row;
  }

  async function backlinkEvents(leadId) {
    return await db.select('system_events', `entity_id=eq.${leadId}&event_type=eq.crm_lead_backlinked&select=id,payload&order=created_at.desc`);
  }

  it('(a) creating a contact whose phone matches an unlinked lead links it + writes the audit event', async () => {
    const phone = `+1801${String(runId).slice(-7)}`;
    const lead = await callFrom(phone, 'a');
    expect(lead.contact_id).toBeNull(); // no matching contact yet — starts unlinked

    const contact = await addContact(phone, `zz-backlink-a-${runId}`);

    const after = await getLead(lead.id);
    expect(after.contact_id).toBe(contact.id);

    const events = await backlinkEvents(lead.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload?.contact_id).toBe(contact.id);
    expect(events[0].payload?.via).toBe('trigger');
  });

  it('(b) two contacts sharing the phone → ambiguity guard, no link', async () => {
    const phone = `+1801${String(runId).slice(-6)}9`;
    // Both contacts exist BEFORE the lead so neither insert has a lead to grab.
    const a = await addContact(phone, `zz-backlink-b1-${runId}`);
    await addContact(phone, `zz-backlink-b2-${runId}`);

    const lead = await callFrom(phone, 'b');
    // Ingest-time forward link also refuses ambiguity — still unlinked.
    expect(lead.contact_id).toBeNull();

    // Exercise the TRIGGER's guard directly: a formatted variant of the same
    // number is a real text change (fires the trigger) with identical digits.
    const formatted = `(801) ${phone.slice(-7, -4)}-${phone.slice(-4)}`;
    await db.update('contacts', `id=eq.${a.id}`, { phone: formatted });

    const after = await getLead(lead.id);
    expect(after.contact_id).toBeNull();
    expect(await backlinkEvents(lead.id)).toHaveLength(0);
  });

  it('(c) an already-linked lead is never overwritten', async () => {
    const leadPhone = `+1801${String(runId).slice(-6)}8`;
    const otherPhone = `+1801${String(runId).slice(-6)}7`;

    const owner = await addContact(otherPhone, `zz-backlink-c-owner-${runId}`);
    const lead = await callFrom(leadPhone, 'c');
    expect(lead.contact_id).toBeNull();

    // Pre-link the lead to a contact whose phone does NOT match its caller
    // (mirrors an office manual link).
    await db.update('inbound_leads', `id=eq.${lead.id}`, { contact_id: owner.id });

    // Now a contact appears who IS the unique holder of the lead's number —
    // the trigger fires, but contact_id IS NULL excludes the linked lead.
    await addContact(leadPhone, `zz-backlink-c-late-${runId}`);

    const after = await getLead(lead.id);
    expect(after.contact_id).toBe(owner.id); // untouched
    expect(await backlinkEvents(lead.id)).toHaveLength(0);
  });

  it('(d) a lead with a short/garbage caller_number is skipped', async () => {
    // 6-digit caller — below the 10-digit floor on the lead side.
    const lead = await callFrom(`801${String(runId).slice(-3)}`, 'd');
    expect(lead.contact_id).toBeNull();

    // A garbage-phone contact fires the trigger and must no-op without error.
    await addContact('abc-123', `zz-backlink-d-garbage-${runId}`);

    // A valid-phone contact fires the trigger; the short caller never matches
    // a 10-digit suffix (and the length guard skips it outright).
    await addContact(`+1801${String(runId).slice(-6)}5`, `zz-backlink-d-valid-${runId}`);

    const after = await getLead(lead.id);
    expect(after.contact_id).toBeNull();
    expect(await backlinkEvents(lead.id)).toHaveLength(0);
  });
});
