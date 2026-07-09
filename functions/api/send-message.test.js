/**
 * ════════════════════════════════════════════════
 * FILE: send-message.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the outbound-SMS worker's compliance chain can never be bypassed AND
 *   that the new per-recipient send loop (Phase B) behaves correctly. It checks
 *   that a Do-Not-Disturb contact and a not-opted-in contact are both blocked
 *   before any text goes out, that the old "skip_compliance" escape hatch is gone,
 *   that on a group conversation EACH participant is consent-checked individually
 *   (a blocked participant beyond the first is never texted), and that a send that
 *   fails for one recipient still records its own message row so the failure is
 *   visible instead of vanishing.
 *
 * HOW TO RUN:
 *   `npm test` (vitest) — no network, no live A2P send.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/send-message.js (onRequestPost)
 *
 * NOTES / GOTCHAS:
 *   - The Supabase client and Twilio sender are mocked; requireAuth's /auth/v1/user
 *     probe is stubbed via a global fetch. No network, no live A2P send.
 *   - Wave -1 compliance hotfix (F-2 skip_compliance removal). Phase B replaces the
 *     Wave -1 group/broadcast refuse-guard with a real per-participant consent loop
 *     + per-recipient message rows. TCPA penalties are per message — the bypass and
 *     per-participant-consent tests are the point.
 *   - The fake db records every insert into `db.inserts` so a test can assert which
 *     `messages` / `sms_consent_log` rows the WORKER wrote (sole-writer invariant).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable holders the mocked modules read from (vi.mock is hoisted above imports).
const h = vi.hoisted(() => ({ db: null, twilio: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/twilio.js', () => ({ sendMessage: (...args) => h.twilio(...args) }));

import { onRequestPost } from './send-message.js';

// No credentials needed — the auth probe is a stubbed global fetch and the db is mocked.
const ENV = { SUPABASE_URL: 'https://db.test', PAGES_URL: 'https://app.test' };

function req(body) {
  return {
    json: async () => body,
    headers: {
      get: (k) => (k === 'Authorization' ? 'Bearer test-jwt' : k === 'host' ? 'app.test' : null),
    },
  };
}

// Minimal fake db keyed by table; overrides let each test pick the convo/participant/contact shape.
// `contact` = a single shared contact (back-compat with the direct-send tests); `contactsById` =
// a per-contact_id map for multi-recipient tests. Every insert is recorded on `db.inserts`.
function makeDb({ conversation, participants, contact, contactsById } = {}) {
  const inserts = [];
  return {
    inserts,
    select: async (table, query = '') => {
      if (table === 'conversations') return conversation ? [conversation] : [];
      if (table === 'conversation_participants') return participants || [{ contact_id: 'c-1', phone: '+15551112222', is_active: true }];
      if (table === 'contacts') {
        if (contactsById) {
          const id = (/id=eq\.([^&]+)/.exec(query) || [])[1];
          const c = id ? contactsById[id] : null;
          return c ? [c] : [];
        }
        return contact ? [contact] : [];
      }
      if (table === 'employees') return [{ id: 'e-1', full_name: 'Rep' }];
      return [];
    },
    insert: async (table, payload) => {
      inserts.push({ table, payload });
      return [{ id: `m-${inserts.length}`, ...payload }];
    },
    update: async () => null,
    rpc: async () => null,
  };
}

const OPTED_IN = { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551112222' };
const DIRECT = { id: 'conv-1', type: 'direct', status: 'open' };

function outboundRows(db) {
  return db.inserts.filter((i) => i.table === 'messages' && i.payload.type === 'sms_outbound');
}
function consentBlocks(db) {
  return db.inserts.filter((i) => i.table === 'sms_consent_log');
}

beforeEach(() => {
  h.twilio = vi.fn(async () => ({ sid: 'SM-test', status: 'queued' }));
  // requireAuth() probes /auth/v1/user — always succeed in tests.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

// ─── SECTION: compliance chain (Wave -1, unchanged by Phase B) ──────────────
describe('send-message compliance chain', () => {
  it('blocks a DND contact before any send (403 DND_ACTIVE)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, dnd: true } });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DND_ACTIVE');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('blocks a not-opted-in contact before any send (403 NO_CONSENT)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, opt_in_status: false } });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_CONSENT');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('has NO skip_compliance escape hatch — the flag can no longer bypass the gate', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, dnd: true } });
    // A caller passing skip_compliance:true against a DND contact must STILL be blocked.
    const res = await onRequestPost({
      request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1', skip_compliance: true }),
      env: ENV,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DND_ACTIVE');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the participant contact cannot be resolved (403, no send)', async () => {
    // participants[0].contact_id points at a row that doesn't exist → we cannot
    // verify consent, so we must refuse rather than send unguarded.
    h.db = makeDb({ conversation: DIRECT, contact: undefined });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CONTACT_NOT_FOUND');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('allows a direct send to a compliant, opted-in contact (201)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
  });

  it('rejects an unauthenticated caller (401) before touching compliance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(401);
    expect(h.twilio).not.toHaveBeenCalled();
  });
});

// ─── SECTION: sole-writer invariant (omni §7.1 adopted) ─────────────────────
describe('send-message worker is the sole writer', () => {
  it('the WORKER writes the outbound row, keyed to the twilio sid it dispatched', async () => {
    h.twilio = vi.fn(async () => ({ sid: 'SM-xyz', status: 'queued' }));
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    const rows = outboundRows(h.db);
    expect(rows).toHaveLength(1);
    // The row the worker wrote carries the real transport result — not a client guess.
    expect(rows[0].payload.twilio_sid).toBe('SM-xyz');
    expect(rows[0].payload.status).toBe('queued');
    expect(rows[0].payload.type).toBe('sms_outbound');
  });

  it('an internal note inserts one note row and never touches Twilio or consent', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: 'conv-1', body: 'private', sent_by: 'e-1', is_internal_note: true }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).type).toBe('internal_note');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
    expect(consentBlocks(h.db)).toHaveLength(0);
  });
});

// ─── SECTION: per-participant send loop (Phase B) ───────────────────────────
describe('send-message per-participant consent loop', () => {
  it('group: a DND participant beyond index 0 is NOT texted; the compliant one is', async () => {
    h.db = makeDb({
      conversation: { id: 'conv-1', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: true, opt_in_status: true, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    // Only the consenting recipient was texted.
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110001');
    // Exactly one outbound row — the DND recipient produced no message, only an audit block.
    expect(outboundRows(h.db)).toHaveLength(1);
    expect(consentBlocks(h.db).some((b) => b.payload.event_type === 'send_blocked_dnd')).toBe(true);
  });

  it('group: an opted-out participant beyond index 0 is skipped and audited', async () => {
    h.db = makeDb({
      conversation: { id: 'conv-1', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: false, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110001');
    expect(consentBlocks(h.db).some((b) => b.payload.event_type === 'send_blocked_no_consent')).toBe(true);
  });

  it('group: a per-recipient send failure records its OWN failed message row + surfaces the error', async () => {
    // Twilio throws for the second recipient only.
    h.twilio = vi.fn(async (_env, { to }) => {
      if (to === '+15551110002') throw new Error('Twilio send failed: 30006');
      return { sid: `SM-${to}`, status: 'queued', to };
    });
    h.db = makeDb({
      conversation: { id: 'conv-1', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: true, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(2);
    // Both recipients get a row — one queued, one failed.
    const rows = outboundRows(h.db);
    expect(rows).toHaveLength(2);
    const failed = rows.find((r) => r.payload.status === 'failed');
    expect(failed).toBeTruthy();
    expect(failed.payload.error_message).toContain('Twilio send failed');
    // The response surfaces the per-recipient error additively.
    const data = await res.json();
    const failedResult = data.twilio.find((t) => t.error);
    expect(failedResult).toBeTruthy();
    expect(failedResult.error_message).toBeTruthy();
  });

  it('group: a recipient with no phone is refused (recorded failed), never cross-channel retargeted', async () => {
    h.db = makeDb({
      conversation: { id: 'conv-1', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: null, is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: true, phone: null },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    // The no-phone recipient is never sent to (no silent retarget); only the reachable one is texted.
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110001');
    // The refusal is still recorded as a failed row.
    expect(outboundRows(h.db).some((r) => r.payload.status === 'failed')).toBe(true);
  });

  it('group: when EVERY recipient is blocked, nothing is sent and no message row is written (403)', async () => {
    h.db = makeDb({
      conversation: { id: 'conv-1', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: true, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: false, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ALL_RECIPIENTS_BLOCKED');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
  });
});
