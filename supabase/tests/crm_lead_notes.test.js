/**
 * ════════════════════════════════════════════════
 * FILE: crm_lead_notes.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the new per-lead notes LOG. A lead used to have one notes box that
 *   got overwritten on every save; now it has many notes, each stamped with
 *   when it was written and who wrote it. This checks that adding two notes to
 *   a lead keeps both (newest first, each with its own timestamp), and that
 *   every note also shows up on the lead's activity timeline as its own "Note"
 *   entry — while the timeline's long-frozen shape (activity_type / occurred_at
 *   / title / body / meta) is left exactly as it was, so nothing that reads it
 *   today breaks.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → get_lead_notes, get_lead_activity RPCs
 *              writes → inbound_leads (via upsert_lead_from_callrail),
 *                       crm_lead_notes (via add_lead_note); all test rows
 *                       deleted in afterAll (crm_lead_notes cascades on the
 *                       lead delete).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips via
 *     describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are absent,
 *     same as the sibling crm_lead_activity.test.js suite.
 *   - add_lead_note / get_lead_notes / get_lead_activity are GRANTed to
 *     authenticated + service_role only (never anon — database-standard.md §1),
 *     so this suite only actually exercises them when run somewhere those roles
 *     can reach the RPCs (an authenticated harness, or the Supabase MCP as a
 *     privileged role), NOT a plain anon devLogin session. Verify with direct
 *     RPC calls via the Supabase MCP when this self-skips.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('add_lead_note + get_lead_notes + activity note arm (integration)', () => {
  const runId = Date.now();
  const phone = `+1557${String(runId).slice(-7)}`;
  let testOrgId;
  let leadId;
  let contactId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;

    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-lead-notes-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 30,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    leadId = lead.id;
  });

  afterAll(async () => {
    // crm_lead_notes rows cascade on the lead delete (ON DELETE CASCADE).
    await db.delete('inbound_leads', `id=eq.${leadId}`);
    if (contactId) await db.delete('contacts', `id=eq.${contactId}`);
  });

  it('keeps every note (append-only), newest first, each with a timestamp', async () => {
    const first = await db.rpc('add_lead_note', { p_lead_id: leadId, p_body: `First follow-up ${runId}`, p_created_by: null });
    expect(first).toBeTruthy();
    expect(first.body).toBe(`First follow-up ${runId}`);
    expect(first.created_at).toBeTruthy();

    // A second note must NOT overwrite the first — that was the whole bug.
    const second = await db.rpc('add_lead_note', { p_lead_id: leadId, p_body: `Second follow-up ${runId}`, p_created_by: null });
    expect(second).toBeTruthy();

    const rows = await db.rpc('get_lead_notes', { p_lead_id: leadId });
    const mine = rows.filter((r) => String(r.body).includes(String(runId)));
    expect(mine.length).toBe(2);
    // Newest first.
    expect(mine[0].body).toBe(`Second follow-up ${runId}`);
    expect(mine[1].body).toBe(`First follow-up ${runId}`);
    // Each note carries its own timestamp + author key (null author here — no actor supplied).
    expect(mine[0].created_at).toBeTruthy();
    expect('author_name' in mine[0]).toBe(true);
  });

  it('an empty note is rejected', async () => {
    await expect(db.rpc('add_lead_note', { p_lead_id: leadId, p_body: '   ', p_created_by: null })).rejects.toBeTruthy();
  });

  it('every note surfaces on the activity timeline as a Note row, with the frozen shape intact', async () => {
    const rows = await db.rpc('get_lead_activity', { p_lead_id: leadId });

    // Backward-compat: the frozen RETURNS TABLE columns are all still present.
    for (const key of ['activity_type', 'occurred_at', 'title', 'body', 'meta']) {
      expect(key in rows[0]).toBe(true);
    }

    const notes = rows.filter((r) => r.activity_type === 'note' && String(r.body).includes(String(runId)));
    expect(notes.length).toBe(2);
    expect(notes.every((n) => n.title === 'Note')).toBe(true);

    // The original call row still resolves (the note arm didn't displace it).
    expect(rows.some((r) => r.activity_type === 'lead')).toBe(true);
  });

  it('the lead note surfaces on the CONTACT timeline once the lead links, and the frozen shape holds', async () => {
    // Guards the get_contact_activity body-only replace: the note reaches the
    // contact-scoped timeline via the new crm_lead_notes arm, and the frozen
    // RETURNS TABLE columns are all still present (a repeat of the 11-arm-drop
    // regression the original migration nearly shipped would fail here).
    const [contact] = await db.insert('contacts', { phone, name: 'Lead Notes Test Person' });
    contactId = contact.id;
    await db.update('inbound_leads', `id=eq.${leadId}`, { contact_id: contactId });

    const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });

    for (const key of ['activity_type', 'occurred_at', 'title', 'body', 'meta']) {
      expect(key in rows[0]).toBe(true);
    }

    const notes = rows.filter((r) => r.activity_type === 'note' && String(r.body).includes(String(runId)));
    expect(notes.length).toBe(2);
    expect(notes[0].meta && 'author_name' in notes[0].meta).toBe(true);
  });
});
