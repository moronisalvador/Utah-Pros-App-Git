/**
 * ════════════════════════════════════════════════
 * FILE: crm_caller_name_upgrade.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves set_lead_caller_name's backward-compatible 2-arg shape still
 *   behaves exactly as before (fill a blank name only, never overwrite), and
 *   that the new opt-in upgrade path only ever replaces a name with a fuller
 *   one that genuinely extends it — never an unrelated name, and never
 *   without explicitly asking for it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → inbound_leads
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

describe.skipIf(!hasCreds)('set_lead_caller_name (integration)', () => {
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

  async function seedLead(label, { contact = false } = {}) {
    const phone = `+1563${String(runId).slice(-6)}${cleanup.leadIds.length}`;
    let contactId = null;
    if (contact) {
      const [c] = await db.insert('contacts', { phone, name: '' });
      cleanup.contactIds.push(c.id);
      contactId = c.id;
    }
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-name-upgrade-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 30,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    cleanup.leadIds.push(lead.id);
    return { leadId: lead.id, contactId };
  }

  it('the old 2-arg shape still fills a blank caller_name and never overwrites (backward-compat)', async () => {
    const { leadId } = await seedLead('compat');
    const first = await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Jason' });
    expect(first.caller_name).toBe('Jason');

    const second = await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'SomeoneElse' });
    expect(second.caller_name).toBe('Jason'); // never overwritten, no upgrade flag passed
  });

  it('upgrades a name only when explicitly asked AND the new name extends the old one', async () => {
    const { leadId } = await seedLead('upgrade');
    await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Silvina' });

    // upgrade:true but an UNRELATED name -> must not overwrite
    const unrelated = await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Robert', p_allow_upgrade: true });
    expect(unrelated.caller_name).toBe('Silvina');

    // upgrade:true with a genuine extension -> overwrites
    const extended = await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Silvina Wright', p_allow_upgrade: true });
    expect(extended.caller_name).toBe('Silvina Wright');
  });

  it('does not upgrade without the flag, even for a genuine extension', async () => {
    const { leadId } = await seedLead('noflag');
    await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Jason' });
    const result = await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Jason Smith' }); // no p_allow_upgrade
    expect(result.caller_name).toBe('Jason');
  });

  it('an upgrade also extends the linked contact name under the same rule', async () => {
    const { leadId, contactId } = await seedLead('contactupgrade', { contact: true });
    await db.update('contacts', `id=eq.${contactId}`, { name: 'Kate' });
    await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Kate' });
    await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: 'Kate Dalton', p_allow_upgrade: true });

    const [contact] = await db.select('contacts', `id=eq.${contactId}`);
    expect(contact.name).toBe('Kate Dalton');
  });

  it('a caller_name containing literal % or _ is treated as plain text, never a wildcard', async () => {
    const { leadId } = await seedLead('wildcard');
    await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: '50%_Off' });
    // "50%_Off Extra" genuinely extends "50%_Off " as plain text — should upgrade
    const extended = await db.rpc('set_lead_caller_name', { p_lead_id: leadId, p_name: '50%_Off Extra', p_allow_upgrade: true });
    expect(extended.caller_name).toBe('50%_Off Extra');
  });

  it('throws for an unknown lead id', async () => {
    await expect(
      db.rpc('set_lead_caller_name', { p_lead_id: '00000000-0000-0000-0000-000000000000', p_name: 'X' })
    ).rejects.toThrow();
  });
});
