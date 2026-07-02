/**
 * ════════════════════════════════════════════════
 * FILE: crm_merge_contacts_safety.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that merging two customer records never throws away the CRM
 *   history attached to the record being folded away. Before Phase F, the
 *   live merge_contacts function only moved 14 old tables onto the surviving
 *   contact and then deleted the other one — which quietly CASCADE-deleted
 *   that contact's marketing attribution, the campaign emails they were sent,
 *   and their campaign exclusions, and orphaned (set to no-one) any leads
 *   that pointed at them. This test attaches exactly those four kinds of rows
 *   to the losing contact, runs a merge, and demands every one of them now
 *   belongs to the surviving contact. It fails against the pre-Phase-F
 *   function and passes once Phase F's superseding migration is applied.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs · writes → contacts, inbound_leads,
 *              email_campaigns, email_campaign_recipients,
 *              email_campaign_exclusions, lead_attribution (all TEST-org,
 *              cleaned up in afterAll); merge via merge_contacts RPC.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project — a merge's
 *     CASCADE/SET-NULL side effects can't be a pure unit test. Self-skips via
 *     describe.skipIf when creds are absent, same as the other CRM suites,
 *     since CI's `npm test` doesn't pass secrets.
 *   - merge_contacts is SECURITY DEFINER and DELETEs the losing contact
 *     itself, so no manual cleanup of that row is needed (or possible under
 *     the anon delete policy). The surviving contact + child rows are removed
 *     in afterAll.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM — merge_contacts preserves CRM history (integration)', () => {
  const runId = Date.now();
  const keepPhone = `+1555${String(runId).slice(-7)}`;
  const losePhone = `+1544${String(runId).slice(-7)}`;
  const callrailId = `test:merge:${runId}`;

  let orgId;
  let keepId;
  let loseId;
  let campaignId;

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    [{ id: keepId }] = await db.insert('contacts', { phone: keepPhone, name: 'Keeper' });
    [{ id: loseId }] = await db.insert('contacts', { phone: losePhone, name: 'Loser' });

    [{ id: campaignId }] = await db.insert('email_campaigns', {
      org_id: orgId, name: `merge-test-${runId}`, subject: 'Merge test',
    });

    // Four kinds of row the pre-Phase-F merge destroyed/orphaned, all on the LOSER.
    await db.insert('lead_attribution', {
      org_id: orgId, contact_id: loseId, channel: 'other', source: 'merge-test',
    });
    await db.insert('email_campaign_recipients', {
      campaign_id: campaignId, contact_id: loseId, email: `lose-${runId}@example.com`, status: 'sent',
    });
    await db.insert('email_campaign_exclusions', {
      campaign_id: campaignId, contact_id: loseId,
    });
    await db.insert('inbound_leads', {
      org_id: orgId, contact_id: loseId, source_type: 'form', callrail_id: callrailId,
      caller_number: losePhone, lead_status: 'new',
    });
  });

  afterAll(async () => {
    await db.delete('lead_attribution', `source=eq.merge-test`);
    await db.delete('email_campaign_recipients', `campaign_id=eq.${campaignId}`);
    await db.delete('email_campaign_exclusions', `campaign_id=eq.${campaignId}`);
    await db.delete('inbound_leads', `callrail_id=eq.${encodeURIComponent(callrailId)}`);
    await db.delete('email_campaigns', `id=eq.${campaignId}`);
    // Loser is deleted by the merge; keeper cleanup is best-effort (anon has
    // no contacts delete policy — leaves at most one TEST row, same as the
    // other CRM suites).
    await db.delete('contacts', `id=eq.${keepId}`);
  });

  it('reassigns lead_attribution, campaign recipients/exclusions, and inbound_leads to the surviving contact', async () => {
    const result = await db.rpc('merge_contacts', { p_keep_id: keepId, p_merge_id: loseId });
    expect(result.ok).toBe(true);

    // The losing contact is gone…
    const survivors = await db.select('contacts', `id=eq.${loseId}`);
    expect(survivors).toHaveLength(0);

    // …and every piece of its CRM history now hangs off the keeper, not deleted.
    const attribution = await db.select('lead_attribution', `source=eq.merge-test&select=contact_id`);
    expect(attribution).toHaveLength(1);
    expect(attribution[0].contact_id).toBe(keepId);

    const recipients = await db.select('email_campaign_recipients', `campaign_id=eq.${campaignId}&select=contact_id`);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].contact_id).toBe(keepId);

    const exclusions = await db.select('email_campaign_exclusions', `campaign_id=eq.${campaignId}&select=contact_id`);
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0].contact_id).toBe(keepId);

    const [lead] = await db.select('inbound_leads', `callrail_id=eq.${encodeURIComponent(callrailId)}&select=contact_id`);
    expect(lead.contact_id).toBe(keepId);
  });
});
