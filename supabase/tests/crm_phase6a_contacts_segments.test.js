/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase6a_contacts_segments.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the three promises of CRM Phase 6a hold against the real database:
 *     1. get_contact_consent reports "do not contact" when a person has ANY of
 *        the three stop-signals — an SMS do-not-disturb flag, an explicit SMS
 *        opt-out, or their email sitting on the suppression list — and reports
 *        contactable when they have none.
 *     2. A saved segment's filter is a real, reusable audience: feeding the
 *        exact filter we stored back through the campaign audience function
 *        returns the same count as a direct query for those same people.
 *     3. get_duplicate_contacts now catches people entered twice under the same
 *        email (ignoring case and stray spaces), on top of the phone matching it
 *        always did.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs, contacts (via RPCs) · writes → contacts,
 *              email_suppressions, crm_segments (all TEST-tagged; segments +
 *              suppressions cleaned in afterAll).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites (CI's `npm test` passes no secrets).
 *   - anon has no DELETE policy on contacts (only authenticated does), so the
 *     handful of TEST contacts here are best-effort-deleted — same accepted
 *     convention as crm_merge_contacts_safety / crm_shared_rpc_compat. Every
 *     contact is name-prefixed `zz6a-` so a later sweep can find them.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 6a — contacts consent, segments, dup detection (integration)', () => {
  const runId = Date.now();
  let orgId;
  const createdContactIds = [];
  const suppressedEmails = [];
  const segmentIds = [];

  const mkContact = async (fields) => {
    const [row] = await db.insert('contacts', { name: `zz6a-${runId}`, ...fields });
    createdContactIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of segmentIds) await db.rpc('delete_segment', { p_segment_id: id });
    for (const email of suppressedEmails) await db.delete('email_suppressions', `email=eq.${encodeURIComponent(email)}`);
    // Best-effort — anon can't delete contacts; leaves at most a few zz6a- rows.
    for (const id of createdContactIds) await db.delete('contacts', `id=eq.${id}`);
  });

  // ─── 1. Unified do-not-contact read ──────────────
  describe('get_contact_consent — dnd ∪ opt_out ∪ email_suppressions', () => {
    it('flags an SMS do-not-disturb contact', async () => {
      const c = await mkContact({ phone: `+1560${String(runId).slice(-7)}`, dnd: true });
      const consent = await db.rpc('get_contact_consent', { p_contact_id: c.id });
      expect(consent.do_not_contact).toBe(true);
      expect(consent.sms.dnd).toBe(true);
    });

    it('flags an explicit SMS opt-out (opt_out_at set)', async () => {
      const c = await mkContact({
        phone: `+1561${String(runId).slice(-7)}`,
        opt_out_at: new Date().toISOString(), opt_out_reason: 'texted STOP',
      });
      const consent = await db.rpc('get_contact_consent', { p_contact_id: c.id });
      expect(consent.do_not_contact).toBe(true);
      expect(consent.sms.opted_out).toBe(true);
      expect(consent.sms.opt_out_reason).toBe('texted STOP');
    });

    it('flags a suppressed email (case/space-insensitive)', async () => {
      const email = `Zz6a.Sup.${runId}@Example.COM`;
      const c = await mkContact({ phone: `+1562${String(runId).slice(-7)}`, email });
      await db.insert('email_suppressions', {
        org_id: orgId, email: ` zz6a.sup.${runId}@example.com `, reason: 'bounce', source: 'test',
      });
      suppressedEmails.push(` zz6a.sup.${runId}@example.com `);
      const consent = await db.rpc('get_contact_consent', { p_contact_id: c.id });
      expect(consent.do_not_contact).toBe(true);
      expect(consent.email.suppressed).toBe(true);
      expect(consent.email.reason).toBe('bounce');
    });

    it('reports contactable when no stop-signal is present', async () => {
      const c = await mkContact({
        phone: `+1563${String(runId).slice(-7)}`, email: `zz6a.ok.${runId}@example.com`, dnd: false,
      });
      const consent = await db.rpc('get_contact_consent', { p_contact_id: c.id });
      expect(consent.do_not_contact).toBe(false);
      expect(consent.sms.dnd).toBe(false);
      expect(consent.sms.opted_out).toBe(false);
      expect(consent.email.suppressed).toBe(false);
    });
  });

  // ─── 2. Segment filter round-trip ──────────────
  it('a saved segment filter, fed to the campaign audience RPC, matches a direct query', async () => {
    const marker = `zz6a-seg-${runId}`;
    // Three contactable (email present, not dnd, not suppressed) with the marker…
    for (let i = 0; i < 3; i++) {
      await mkContact({
        phone: `+157${i}${String(runId).slice(-7)}`,
        email: `zz6a.seg.${i}.${runId}@example.com`, referral_source: marker, dnd: false,
      });
    }
    // …plus one dnd and one suppressed, both matching the filter but NOT contactable.
    await mkContact({ phone: `+1574${String(runId).slice(-7)}`, email: `zz6a.seg.dnd.${runId}@example.com`, referral_source: marker, dnd: true });
    const supEmail = `zz6a.seg.sup.${runId}@example.com`;
    await mkContact({ phone: `+1575${String(runId).slice(-7)}`, email: supEmail, referral_source: marker, dnd: false });
    await db.insert('email_suppressions', { org_id: orgId, email: supEmail, reason: 'test', source: 'test' });
    suppressedEmails.push(supEmail);

    const filter = { referral_source: marker };
    const seg = await db.rpc('upsert_segment', {
      p_name: `Segment ${runId}`, p_filter: filter, p_org_id: orgId,
    });
    segmentIds.push(seg.id);

    // Read the segment back — the stored filter must round-trip byte-for-byte.
    const segments = await db.rpc('get_segments', { p_org_id: orgId });
    const saved = segments.find(s => s.id === seg.id);
    expect(saved).toBeTruthy();
    expect(saved.filter).toEqual(filter);

    // Preview count from the SAVED filter via the shared audience RPC…
    const audience = await db.rpc('preview_email_audience', { p_filter: saved.filter, p_org_id: orgId });
    // …vs a direct query for the same criteria (contactable people with the marker).
    const direct = await db.select('contacts', `referral_source=eq.${encodeURIComponent(marker)}&select=id,email,dnd`);
    const suppressed = new Set(
      (await db.select('email_suppressions', `select=email`)).map(r => (r.email || '').trim().toLowerCase())
    );
    const directContactable = direct.filter(c => c.email && !c.dnd && !suppressed.has((c.email || '').trim().toLowerCase()));

    expect(audience.length).toBe(3);
    expect(audience.length).toBe(directContactable.length);
  });

  // ─── 3. Email-normalized duplicate detection ──────────────
  it('get_duplicate_contacts detects contacts sharing a normalized email', async () => {
    const email = `zz6a.dup.${runId}@example.com`;
    const a = await mkContact({ email: `  ${email.toUpperCase()}  ` }); // caps + surrounding spaces
    const b = await mkContact({ email });                               // canonical
    const groups = await db.rpc('get_duplicate_contacts');
    const grp = groups.find(g => g.phone_normalized === email && g.count >= 2);
    expect(grp).toBeTruthy();
    expect(grp.contact_ids).toContain(a.id);
    expect(grp.contact_ids).toContain(b.id);
  });
});
