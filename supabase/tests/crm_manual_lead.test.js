/**
 * ════════════════════════════════════════════════
 * FILE: crm_manual_lead.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "add a lead by hand" database function works against the real
 *   database. A person on the Leads board types in a name, phone, source and
 *   value and hits save — this checks that doing so creates exactly one lead
 *   card, links it to a customer contact (finding an existing one by phone or
 *   making a new one), and that adding a second lead with the SAME phone
 *   number reuses that one contact instead of making a duplicate person. All
 *   test rows are tagged to the disposable TEST org and deleted afterward.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → inbound_leads, contacts, crm_orgs
 *              writes → inbound_leads + contacts (via create_manual_lead RPC);
 *                       all test rows deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project (a SQL RPC's
 *     behavior can't be a pure unit test). Needs real VITE_SUPABASE_URL /
 *     VITE_SUPABASE_ANON_KEY — self-skips via describe.skipIf when absent,
 *     same as the Phase 0/1 suites, since CI's `npm test` doesn't pass secrets.
 *   - A manual lead has no CallRail id, so the RPC synthesizes a unique
 *     `manual:<uuid>` callrail_id to satisfy the NOT NULL + UNIQUE column, and
 *     uses source_type 'form' (the source_type CHECK only allows call/form —
 *     an additive-only phase must not alter that live constraint).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM — create_manual_lead (integration)', () => {
  const runId = Date.now();
  const phone = `+1555${String(runId).slice(-7)}`;
  let testOrgId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
  });

  afterAll(async () => {
    await db.delete('inbound_leads', `caller_number=eq.${encodeURIComponent(phone)}`);
    await db.delete('contacts', `phone=eq.${encodeURIComponent(phone)}`);
  });

  it('creates one lead, links a new contact by phone, and marks it a manual form lead', async () => {
    const row = await db.rpc('create_manual_lead', {
      p_name: 'Test Manual Lead',
      p_phone: phone,
      p_source: 'Referral',
      p_value: 1500,
      p_org_id: testOrgId,
    });

    expect(row.source_type).toBe('form');
    expect(row.callrail_id).toMatch(/^manual:/);
    expect(row.spam_flag).toBe(false);
    expect(Number(row.value)).toBe(1500);
    expect(row.source).toBe('Referral');

    const [contact] = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}`);
    expect(contact).toBeTruthy();
    expect(contact.name).toBe('Test Manual Lead');
    expect(row.contact_id).toBe(contact.id);

    const leads = await db.select('inbound_leads', `caller_number=eq.${encodeURIComponent(phone)}`);
    expect(leads).toHaveLength(1);
  });

  it('a second manual lead with the same phone reuses the one contact, not a duplicate person', async () => {
    const row = await db.rpc('create_manual_lead', {
      p_name: 'Test Manual Lead',
      p_phone: phone,
      p_source: 'Walk-in',
      p_value: null,
      p_org_id: testOrgId,
    });

    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}`);
    expect(contacts).toHaveLength(1);
    expect(row.contact_id).toBe(contacts[0].id);

    const leads = await db.select('inbound_leads', `caller_number=eq.${encodeURIComponent(phone)}`);
    expect(leads).toHaveLength(2);
  });
});
