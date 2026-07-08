/**
 * ════════════════════════════════════════════════
 * FILE: inbound-meld.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Property Meld intake worker keeps the right melds and pushes the
 *   owner at the right time — restoration melds get saved (and, when new,
 *   notified), while carpet-cleaning melds and daily digests are dropped. Uses
 *   a fake database + fake notifier, so no real DB or push is touched.
 *
 * DEPENDS ON:
 *   Internal:  ./inbound-meld.js
 *   Data:      reads → none · writes → none (fakes)
 *
 * NOTES / GOTCHAS:
 *   - The fake db returns an existing row only for meld numbers in `existing`,
 *     which is how the new-vs-seen (push-once) path is exercised without a DB.
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { ingestMeldEmails, notifyNewMelds } from './inbound-meld.js';

const RESTO_ASSIGN = {
  from: 'noreply@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 1 Main St, Unit 1: Reconstruction',
  received_at: '2026-07-08T15:00:00Z',
  text: `A2Z Properties

assigned this Meld that needs to be

Accepted (https://app.propertymeld.com/2156/v/83074/melds/incoming/999001/summary/?accept=) or Rejected (https://app.propertymeld.com/2156/v/83074/melds/incoming/999001/summary/?reject=).

"Flood cleanup"

Meld Details:

Reconstruction
# TREST01Pending vendor acceptance

Unit:
1 Main St
Unit 1
Provo, UT 84601

Manage all notifications: https://app.propertymeld.com/2156/v/83074/account-settings/notification/`,
};

const CLEANING_ASSIGN = {
  from: 'noreply@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 2 Oak Ave, Unit 2: Carpet Cleaning',
  text: `A2Z Properties

assigned this Meld that needs to be

Accepted (https://app.propertymeld.com/2156/v/51865/melds/incoming/999002/summary/?accept=) or Rejected (x).

"Clean carpets"

Meld Details:

Carpet Cleaning
# TCLEAN1Pending vendor acceptance

Unit:
2 Oak Ave
Unit 2
Provo, UT 84601

Manage all notifications: https://app.propertymeld.com/2156/v/51865/account-settings/notification/`,
};

const DAILY_SUMMARY = {
  from: 'noreply@msg.propertymeld.com',
  subject: '(A2Z Properties) provided daily activity summary from Property Meld',
  text: 'Activity Summary - Utah Pros Restoration\n\nUnaccepted Melds: 0',
};

function fakeDb({ existing = [] } = {}) {
  return {
    rpcCalls: [],
    async select(table, query) {
      if (table === 'property_meld_melds') {
        const m = query.match(/meld_number=eq\.([^&]+)/);
        const num = m ? decodeURIComponent(m[1]) : null;
        return existing.includes(num) ? [{ id: 'existing-id' }] : [];
      }
      if (table === 'employees') return [{ id: 'owner-1' }];
      return [];
    },
    async rpc(fn, params) { this.rpcCalls.push({ fn, params }); return [{ meld_number: params.p_meld_number }]; },
  };
}

describe('ingestMeldEmails', () => {
  it('ingests a new restoration assignment and flags it new', async () => {
    const db = fakeDb();
    const r = await ingestMeldEmails(db, [RESTO_ASSIGN]);
    expect(r.ingested).toBe(1);
    expect(r.new_count).toBe(1);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].fn).toBe('upsert_property_meld_meld');
    expect(db.rpcCalls[0].params.p_meld_number).toBe('TREST01');
    expect(db.rpcCalls[0].params.p_received_at).toBe('2026-07-08T15:00:00Z');
  });

  it('drops carpet-cleaning melds (never upserts them)', async () => {
    const db = fakeDb();
    const r = await ingestMeldEmails(db, [CLEANING_ASSIGN]);
    expect(r.ingested).toBe(0);
    expect(r.new_count).toBe(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(r.results[0]).toMatchObject({ ingested: false, business: 'cleaning' });
  });

  it('drops the daily digest', async () => {
    const db = fakeDb();
    const r = await ingestMeldEmails(db, [DAILY_SUMMARY]);
    expect(r.ingested).toBe(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('re-ingesting a known meld still upserts but is NOT new (no push)', async () => {
    const db = fakeDb({ existing: ['TREST01'] });
    const r = await ingestMeldEmails(db, [RESTO_ASSIGN]);
    expect(r.ingested).toBe(1);
    expect(r.new_count).toBe(0);            // already seen → no notification
    expect(db.rpcCalls).toHaveLength(1);    // still upserts (idempotent enrich)
  });

  it('processes a mixed batch, keeping only restoration', async () => {
    const db = fakeDb();
    const r = await ingestMeldEmails(db, [RESTO_ASSIGN, CLEANING_ASSIGN, DAILY_SUMMARY]);
    expect(r.processed).toBe(3);
    expect(r.ingested).toBe(1);
    expect(r.new_count).toBe(1);
  });
});

describe('notifyNewMelds', () => {
  it('dispatches meld.received to the owner with a /melds deep link', async () => {
    const db = fakeDb();
    const calls = [];
    const parsed = (await ingestMeldEmails(db, [RESTO_ASSIGN])).newMelds;
    const res = await notifyNewMelds(db, {}, parsed, async (args) => { calls.push(args); });
    expect(res.notified).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].typeKey).toBe('meld.received');
    expect(calls[0].body.recipient_ids).toEqual(['owner-1']);
    expect(calls[0].body.link).toBe('/melds');
    expect(calls[0].body.entity_id).toBe('TREST01');
  });

  it('marks an emergency meld in the push title', async () => {
    const calls = [];
    const emergency = [{ meldType: 'Active Flooding', meldNumber: 'TEMER01', isEmergency: true, address: { full: '9 Elm' } }];
    await notifyNewMelds(fakeDb(), {}, emergency, async (a) => { calls.push(a); });
    expect(calls[0].body.title).toContain('EMERGENCY');
  });

  it('never throws if the dispatcher fails (fire-and-forget)', async () => {
    const melds = [{ meldType: 'Reconstruction', meldNumber: 'TREST01', isEmergency: false, address: { full: '1 Main St' } }];
    const res = await notifyNewMelds(fakeDb(), {}, melds, async () => { throw new Error('push down'); });
    expect(res.notified).toBe(0);
  });

  it('does nothing when there are no new melds', async () => {
    const res = await notifyNewMelds(fakeDb(), {}, [], async () => { throw new Error('should not be called'); });
    expect(res.notified).toBe(0);
  });
});
