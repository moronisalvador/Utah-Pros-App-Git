/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase6b_audit_hardening.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves Phase 6b's audit hardening of the email-campaign functions — the
 *   four backward-compatible body replaces — actually records history AND that
 *   the existing callers still work unchanged:
 *     1. Creating a campaign, editing it, setting its exclusions, and deleting
 *        it each now write exactly the audit event we expect into system_events.
 *     2. The campaign-"sent" event fires EXACTLY ONCE and carries a
 *        sent/suppressed/failed/total counts payload — a duplicate/retried
 *        record_email_campaign_send call on an already-sent campaign no longer
 *        emits a second (empty) event, which was the pre-6b bug.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs, system_events, email_campaigns ·
 *              writes → email_campaigns, email_campaign_recipients, contacts,
 *              system_events (all TEST-tagged; campaigns + contacts cleaned in
 *              afterAll — campaign delete cascades its recipients/exclusions).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - system_events is append-only (anon has no DELETE) — the audit rows this
 *     test writes are left in place, same accepted convention as the other
 *     suites' best-effort cleanup. Names are `zz6b-*` for later identification.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 6b — email-campaign audit hardening (integration)', () => {
  const runId = Date.now();
  let orgId;
  const campaignIds = [];
  const contactIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of campaignIds) await db.delete('email_campaigns', `id=eq.${id}`); // cascades recipients/exclusions
    for (const id of contactIds) await db.delete('contacts', `id=eq.${id}`); // best-effort (anon)
  });

  const eventsFor = (type, id) =>
    db.select('system_events', `event_type=eq.${type}&entity_id=eq.${id}&select=payload`);

  // ─── 1. create / edit / exclusions / delete each log an event ──────────────
  it('upsert_email_campaign logs create then update', async () => {
    const created = await db.rpc('upsert_email_campaign', {
      p_name: `zz6b Camp ${runId}`, p_subject: 'Hello', p_org_id: orgId,
    });
    campaignIds.push(created.id);
    expect((await eventsFor('crm_email_campaign_created', created.id)).length).toBe(1);

    const edited = await db.rpc('upsert_email_campaign', {
      p_id: created.id, p_name: `zz6b Camp ${runId} v2`, p_subject: 'Hello again', p_org_id: orgId,
    });
    expect(edited.id).toBe(created.id);
    expect((await eventsFor('crm_email_campaign_updated', created.id)).length).toBeGreaterThanOrEqual(1);
  });

  it('set_campaign_exclusions logs the exclusion change', async () => {
    const camp = await db.rpc('upsert_email_campaign', {
      p_name: `zz6b Excl ${runId}`, p_subject: 'Subject', p_org_id: orgId,
    });
    campaignIds.push(camp.id);
    await db.rpc('set_campaign_exclusions', { p_campaign_id: camp.id, p_contact_ids: [] });
    const events = await eventsFor('crm_email_campaign_exclusions_set', camp.id);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload).toHaveProperty('audience_count');
  });

  it('delete_email_campaign logs the deletion', async () => {
    const camp = await db.rpc('upsert_email_campaign', {
      p_name: `zz6b Del ${runId}`, p_subject: 'Subject', p_org_id: orgId,
    });
    await db.rpc('delete_email_campaign', { p_id: camp.id });
    const events = await eventsFor('crm_email_campaign_deleted', camp.id);
    expect(events.length).toBe(1);
    expect(events[0].payload.name).toBe(`zz6b Del ${runId}`);
  });

  // ─── 2. campaign-sent event fires once, with counts, even on retry ──────────────
  it('record_email_campaign_send emits crm_email_campaign_sent exactly once with counts', async () => {
    const camp = await db.rpc('upsert_email_campaign', {
      p_name: `zz6b Sent ${runId}`, p_subject: 'Ship it', p_org_id: orgId,
    });
    campaignIds.push(camp.id);

    const [contact] = await db.insert('contacts', {
      name: `zz6b-recip-${runId}`, email: `zz6b.recip.${runId}@example.com`,
    });
    contactIds.push(contact.id);

    const [recip] = await db.insert('email_campaign_recipients', {
      campaign_id: camp.id, contact_id: contact.id, email: contact.email, status: 'pending',
    });
    // Move the campaign into the same in-flight state the send worker leaves it in.
    await db.update('email_campaigns', `id=eq.${camp.id}`, { status: 'sending' });

    // First result finalizes the campaign → one sent event.
    await db.rpc('record_email_campaign_send', { p_recipient_id: recip.id, p_status: 'sent' });
    // A duplicate/retried call must NOT emit a second event.
    await db.rpc('record_email_campaign_send', { p_recipient_id: recip.id, p_status: 'sent' });

    const events = await eventsFor('crm_email_campaign_sent', camp.id);
    expect(events.length).toBe(1);
    expect(events[0].payload.sent).toBe(1);
    expect(events[0].payload).toHaveProperty('total', 1);

    const [row] = await db.select('email_campaigns', `id=eq.${camp.id}&select=status,total_sent`);
    expect(row.status).toBe('sent');
    expect(row.total_sent).toBe(1);
  });
});
