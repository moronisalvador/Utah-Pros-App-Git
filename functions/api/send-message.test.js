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
 *   visible instead of vanishing. It also proves a caption-less photo (media-only
 *   MMS) still passes through the same consent gate — and that a truly empty send,
 *   or a media-only internal note, is refused.
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
const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  PAGES_URL: 'https://app.test',
  MESSAGING_SEND_MODE: 'twilio',
  MESSAGING_SCHEMA_MODE: 'foundation',
};

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
function makeDb({
  conversation,
  participants,
  contact,
  contactsById,
  priorOutbound = [],
} = {}) {
  const inserts = [];
  const attempts = [];
  return {
    inserts,
    attempts,
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
      if (table === 'employees') {
        return [{
          id: 'e-1',
          full_name: 'Rep',
          role: 'office',
          is_active: true,
          is_external: false,
        }];
      }
      if (table === 'feature_flags' || table === 'employee_page_access') return [];
      if (table === 'nav_permissions') return [{ can_view: true }];
      if (table === 'message_send_attempts') {
        const parentId = (/parent_attempt_id=eq\.([^&]+)/.exec(query) || [])[1];
        if (parentId) {
          const contactId = (/recipient_contact_id=eq\.([^&]+)/.exec(query) || [])[1];
          const address = (/recipient_address=eq\.([^&]+)/.exec(query) || [])[1];
          return attempts.filter((attempt) => (
            attempt.parent_attempt_id === parentId
            && (
              (contactId && attempt.recipient_contact_id === contactId)
              || (address && attempt.recipient_address === decodeURIComponent(address))
            )
          ));
        }
        const requestId = (/client_request_id=eq\.([^&]+)/.exec(query) || [])[1];
        return attempts.filter((attempt) => attempt.client_request_id === requestId);
      }
      if (table === 'messages' && query.includes('client_request_id=eq.')) {
        const requestId = (/client_request_id=eq\.([^&]+)/.exec(query) || [])[1];
        return inserts
          .filter((item) => (
            item.table === 'messages'
            && item.payload.client_request_id === requestId
          ))
          .map((item) => item.payload);
      }
      if (
        table === 'messages'
        && query.includes('conversation_id=eq.')
        && query.includes('type=eq.sms_outbound')
      ) {
        return priorOutbound;
      }
      if (table === 'messages' && /(?:^|&)id=eq\./.test(query)) {
        const id = (/id=eq\.([^&]+)/.exec(query) || [])[1];
        return inserts
          .filter((item) => item.table === 'messages' && item.payload.id === id)
          .map((item) => item.payload);
      }
      return [];
    },
    insert: async (table, payload) => {
      const row = { id: table === 'message_send_attempts' ? `attempt-${attempts.length + 1}` : `m-${inserts.length + 1}`, ...payload };
      if (table === 'message_send_attempts') attempts.push(row);
      inserts.push({ table, payload: row });
      return [row];
    },
    update: async (table, filter, payload) => {
      if (table === 'message_send_attempts') {
        const id = (/id=eq\.([^&]+)/.exec(filter) || [])[1];
        const attempt = attempts.find((item) => item.id === id);
        if (attempt) Object.assign(attempt, payload);
      }
      return null;
    },
    rpc: async (name, args) => {
      if (name !== 'claim_message_recipient_attempt') return null;
      const attempt = attempts.find((item) => item.id === args.p_attempt_id);
      if (!attempt || attempt.state !== 'prepared') return false;
      attempt.state = 'submitting';
      attempt.started_at = new Date().toISOString();
      return true;
    },
    downloadStorage: vi.fn(async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]),
      contentType: 'image/jpeg',
    })),
    signStorage: vi.fn(async () => 'https://db.test/signed/photo.jpg?token=x'),
  };
}

const OPTED_IN = { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551112222' };
const DIRECT = { id: '11111111-1111-4111-8111-111111111111', type: 'direct', status: 'open' };
const CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function outboundRows(db) {
  return db.inserts.filter((i) => i.table === 'messages' && i.payload.type === 'sms_outbound');
}
function consentBlocks(db) {
  return db.inserts.filter((i) => i.table === 'sms_consent_log');
}

beforeEach(() => {
  h.twilio = vi.fn(async () => ({ sid: 'SM-test', status: 'queued' }));
  // requireAuth() probes /auth/v1/user — always succeed in tests.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'auth-user-1' }),
  })));
});

// ─── SECTION: compliance chain (Wave -1, unchanged by Phase B) ──────────────
describe('send-message compliance chain', () => {
  it('blocks a DND contact before any send (403 DND_ACTIVE)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, dnd: true } });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DND_ACTIVE');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('blocks a not-opted-in contact before any send (403 NO_CONSENT)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, opt_in_status: false } });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_CONSENT');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('keeps an explicit STOP/opt-out fail-closed even if opt_in_status is stale true', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: {
        ...OPTED_IN,
        opt_in_status: true,
        opt_out_at: '2026-07-23T18:00:00.000Z',
        opt_out_reason: 'stop_keyword',
      },
    });
    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'hi',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_CONSENT');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(consentBlocks(h.db)[0].payload.details).toContain('explicit opt-out');
  });

  it('has NO skip_compliance escape hatch — the flag can no longer bypass the gate', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, dnd: true } });
    // A caller passing skip_compliance:true against a DND contact must STILL be blocked.
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1', skip_compliance: true }),
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
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CONTACT_NOT_FOUND');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('allows a direct send to a compliant, opted-in contact (201)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
  });

  it('keeps private MMS behind the same consent gate and gives Twilio only a signed URL', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const reference =
      `upr-storage://message-attachments/outbound/${DIRECT.id}/photo.jpg`;
    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Photo',
        sent_by: 'e-1',
        media_urls: [reference],
      }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect(h.db.downloadStorage).toHaveBeenCalledWith(
      'message-attachments',
      `outbound/${DIRECT.id}/photo.jpg`,
      5_000_000,
    );
    expect(h.twilio).toHaveBeenCalledWith(
      ENV,
      expect.objectContaining({
        mediaUrls: ['https://db.test/signed/photo.jpg?token=x'],
      }),
    );
    expect(outboundRows(h.db)[0].payload.media_urls).toBe(JSON.stringify([reference]));
  });

  it('records a local private-media failure as retryable, not an ambiguous Twilio send', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    h.db.downloadStorage.mockRejectedValueOnce(new Error('missing object'));
    const reference =
      `upr-storage://message-attachments/outbound/${DIRECT.id}/missing.jpg`;

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Photo',
        sent_by: 'e-1',
        media_urls: [reference],
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: ENV,
    });
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.error_code).toBe('MESSAGE_MEDIA_UNAVAILABLE');
    expect(h.db.signStorage).not.toHaveBeenCalled();
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)[0].payload).toMatchObject({
      status: 'failed',
      error_code: 'MESSAGE_MEDIA_UNAVAILABLE',
    });
    expect(h.db.attempts[0]).toMatchObject({
      state: 'failed',
      error_code: 'MESSAGE_MEDIA_UNAVAILABLE',
      reconcile_after: null,
    });
    expect(h.db.attempts[0].completed_at).toBeTruthy();
  });

  it('records a signed-URL failure locally without claiming Twilio may have sent', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    h.db.signStorage.mockRejectedValueOnce(new Error('signing unavailable'));
    const reference =
      `upr-storage://message-attachments/outbound/${DIRECT.id}/photo.jpg`;

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Photo',
        sent_by: 'e-1',
        media_urls: [reference],
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: ENV,
    });
    const payload = await res.json();

    expect(payload.error_code).toBe('MESSAGE_MEDIA_UNAVAILABLE');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(h.db.attempts[0]).toMatchObject({
      state: 'failed',
      error_code: 'MESSAGE_MEDIA_UNAVAILABLE',
      reconcile_after: null,
    });
    expect(h.db.attempts[0].completed_at).toBeTruthy();
  });

  it('keeps a raw Twilio helper/network failure ambiguous for reconciliation', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const networkError = new Error('network connection reset');
    networkError.ambiguous = true;
    h.twilio.mockRejectedValueOnce(networkError);

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Hello',
        sent_by: 'e-1',
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: ENV,
    });
    const payload = await res.json();

    expect(payload.error_code).toBe('TWILIO_SEND_AMBIGUOUS');
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.db.attempts[0]).toMatchObject({
      state: 'ambiguous',
      error_code: 'TWILIO_SEND_AMBIGUOUS',
      completed_at: null,
    });
    expect(h.db.attempts[0].reconcile_after).toBeTruthy();
  });

  it('keeps a Twilio credential/config failure local and completed', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const configError = new Error('Twilio credentials are not configured');
    configError.code = 'TWILIO_NOT_CONFIGURED';
    h.twilio.mockRejectedValueOnce(configError);

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Hello',
        sent_by: 'e-1',
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: ENV,
    });
    const payload = await res.json();

    expect(payload.error_code).toBe('TWILIO_NOT_CONFIGURED');
    expect(h.db.attempts[0]).toMatchObject({
      state: 'failed',
      error_code: 'TWILIO_NOT_CONFIGURED',
      reconcile_after: null,
    });
    expect(h.db.attempts[0].completed_at).toBeTruthy();
  });

  it('identifies Utah Pros and adds STOP instructions to the first outbound message', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'We are on our way.',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(201);
    expect(h.twilio.mock.calls[0][1].body).toBe(
      'Utah Pros Restoration - Rep: We are on our way. Reply STOP to unsubscribe.',
    );
  });

  it('keeps company identification but does not repeat STOP instructions in a continuing thread', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: OPTED_IN,
      priorOutbound: [{ id: 'prior-message' }],
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'The drying check is complete.',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(201);
    expect(h.twilio.mock.calls[0][1].body).toBe(
      'Utah Pros Restoration - Rep: The drying check is complete.',
    );
  });

  // Media-only (caption-less MMS) — the body-required relaxation must NOT skip the gate.
  it('blocks a DND contact on a media-only (no caption) send — the gate runs for MMS too', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: { ...OPTED_IN, dnd: true } });
    const reference =
      `upr-storage://message-attachments/outbound/${DIRECT.id}/p.jpg`;
    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: '',
        sent_by: 'e-1',
        media_urls: [reference],
      }),
      env: ENV,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DND_ACTIVE');
    expect(h.db.downloadStorage).not.toHaveBeenCalled();
    expect(h.db.signStorage).not.toHaveBeenCalled();
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('blocks private media without consent before Storage or provider work', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: { ...OPTED_IN, opt_in_status: false },
    });
    const reference =
      `upr-storage://message-attachments/outbound/${DIRECT.id}/p.jpg`;
    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Photo',
        sent_by: 'e-1',
        media_urls: [reference],
      }),
      env: ENV,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_CONSENT');
    expect(h.db.downloadStorage).not.toHaveBeenCalled();
    expect(h.db.signStorage).not.toHaveBeenCalled();
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('allows a media-only (no caption) send to an opted-in contact (201, MMS dispatched)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const legacy =
      `https://db.test/storage/v1/object/public/job-files/conversations/${DIRECT.id}/p.jpg`;
    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: '',
        sent_by: 'e-1',
        media_urls: [legacy],
      }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].mediaUrls).toEqual([legacy]);
  });

  it('rejects a truly empty send — no body AND no media (400, no send)', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: '', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(400);
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('rejects a media-only INTERNAL NOTE (400) — media cannot make an empty note sendable', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: '', sent_by: 'e-1', is_internal_note: true, media_urls: ['https://files.test/p.jpg'] }),
      env: ENV,
    });
    expect(res.status).toBe(400);
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller (401) before touching compliance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(401);
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('fails closed when the participant destination differs from the consented contact phone', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      participants: [{ contact_id: 'c-1', phone: '+15551119999', is_active: true }],
      contact: OPTED_IN,
    });
    const res = await onRequestPost({
      request: req({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 'hi',
        sent_by: 'e-1',
      }),
      env: ENV,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CONTACT_PHONE_MISMATCH');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('rejects malformed message and media shapes before transport work', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const invalidBody = await onRequestPost({
      request: req({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 42,
        sent_by: 'e-1',
      }),
      env: ENV,
    });
    expect((await invalidBody.json()).code).toBe('INVALID_MESSAGE_BODY');

    const invalidMedia = await onRequestPost({
      request: req({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 'hi',
        sent_by: 'e-1',
        media_urls: 'https://files.test/not-an-array.jpg',
      }),
      env: ENV,
    });
    expect((await invalidMedia.json()).code).toBe('INVALID_MEDIA_URLS');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('rejects a forged sent_by before consent or transport work', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'other-employee' }),
      env: ENV,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('SENDER_MISMATCH');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(consentBlocks(h.db)).toHaveLength(0);
  });
});

describe('send-message client request idempotency', () => {
  it('rejects a malformed client_request_id before transport work', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 'hi',
        sent_by: 'e-1',
        client_request_id: 'pending-1',
      }),
      env: ENV,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('keeps pre-migration persistence legacy until foundation schema is enabled', async () => {
    const res = await onRequestPost({
      request: req({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 'legacy compatible',
        sent_by: 'e-1',
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: { ...ENV, MESSAGING_SCHEMA_MODE: undefined },
    });

    expect(res.status).toBe(201);
    expect(h.db.inserts.some((item) => item.table === 'message_send_attempts')).toBe(false);
    const [row] = outboundRows(h.db);
    expect(row.payload).not.toHaveProperty('provider');
    expect(row.payload).not.toHaveProperty('client_request_id');
  });

  it('submits a stable direct request once and returns the existing row on retry', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const body = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      body: 'hi',
      sent_by: 'e-1',
      client_request_id: CLIENT_REQUEST_ID,
    };

    const first = await onRequestPost({ request: req(body), env: ENV });
    const repeat = await onRequestPost({ request: req(body), env: ENV });

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect((await repeat.json()).twilio).toEqual([]);
    expect(outboundRows(h.db)).toHaveLength(1);
  });

  it('downloads, signs, and dispatches the same private-media request only once', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const reference =
      `upr-storage://message-attachments/outbound/${DIRECT.id}/photo.jpg`;
    const body = {
      conversation_id: DIRECT.id,
      body: 'Photo',
      sent_by: 'e-1',
      media_urls: [reference],
      client_request_id: CLIENT_REQUEST_ID,
    };

    await onRequestPost({ request: req(body), env: ENV });
    await onRequestPost({ request: req(body), env: ENV });

    expect(h.db.downloadStorage).toHaveBeenCalledTimes(1);
    expect(h.db.signStorage).toHaveBeenCalledTimes(1);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(outboundRows(h.db)).toHaveLength(1);
  });

  it('rejects changed-content reuse of a client_request_id', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const base = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      sent_by: 'e-1',
      client_request_id: CLIENT_REQUEST_ID,
    };
    await onRequestPost({ request: req({ ...base, body: 'first' }), env: ENV });
    const conflict = await onRequestPost({
      request: req({ ...base, body: 'changed' }),
      env: ENV,
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('CLIENT_REQUEST_CONFLICT');
    expect(h.twilio).toHaveBeenCalledTimes(1);
  });

  it('rejects changed-media reuse before a second Storage or provider operation', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const base = {
      conversation_id: DIRECT.id,
      body: 'Photo',
      sent_by: 'e-1',
      client_request_id: CLIENT_REQUEST_ID,
    };
    await onRequestPost({
      request: req({
        ...base,
        media_urls: [
          `upr-storage://message-attachments/outbound/${DIRECT.id}/first.jpg`,
        ],
      }),
      env: ENV,
    });
    const conflict = await onRequestPost({
      request: req({
        ...base,
        media_urls: [
          `upr-storage://message-attachments/outbound/${DIRECT.id}/changed.jpg`,
        ],
      }),
      env: ENV,
    });

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('CLIENT_REQUEST_CONFLICT');
    expect(h.db.downloadStorage).toHaveBeenCalledTimes(1);
    expect(h.db.signStorage).toHaveBeenCalledTimes(1);
    expect(h.twilio).toHaveBeenCalledTimes(1);
  });

  it('retains a recoverable accepted attempt when canonical insertion fails', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const insert = h.db.insert;
    h.db.insert = vi.fn(async (table, payload) => {
      if (table === 'messages' && payload.type === 'sms_outbound') {
        throw new Error('simulated message persistence failure');
      }
      return insert(table, payload);
    });
    h.twilio = vi.fn(async () => ({
      sid: 'SM-recoverable',
      status: 'queued',
      from: '+13853360611',
    }));

    const response = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'recover me',
        sent_by: 'e-1',
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: ENV,
    });

    expect(response.status).toBe(500);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.db.attempts[0]).toMatchObject({
      state: 'ambiguous',
      provider_message_id: 'SM-recoverable',
      provider_status: 'queued',
      canonical_body: 'recover me',
      sender_address: '+13853360611',
      error_code: 'MESSAGE_PERSIST_FAILED',
    });
  });
});

describe('send-message provider mode isolation', () => {
  it('fails closed when the server mode is missing or disabled', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: { ...ENV, MESSAGING_SEND_MODE: undefined },
    });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('MESSAGING_SEND_DISABLED');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('rejects group/broadcast traffic before any CallRail provider call', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      contact: OPTED_IN,
    });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: { ...ENV, MESSAGING_SEND_MODE: 'callrail' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CALLRAIL_PURPOSE_UNSUPPORTED');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(consentBlocks(h.db)).toHaveLength(0);
  });

  it('rejects CallRail group media before Storage or provider work', async () => {
    h.db = makeDb({
      conversation: { ...DIRECT, type: 'group' },
      contact: OPTED_IN,
    });
    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Photo',
        sent_by: 'e-1',
        media_urls: [
          `upr-storage://message-attachments/outbound/${DIRECT.id}/photo.jpg`,
        ],
      }),
      env: { ...ENV, MESSAGING_SEND_MODE: 'callrail' },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CALLRAIL_PURPOSE_UNSUPPORTED');
    expect(h.db.downloadStorage).not.toHaveBeenCalled();
    expect(h.db.signStorage).not.toHaveBeenCalled();
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('rejects CallRail mode until foundation persistence is enabled', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: {
        ...ENV,
        MESSAGING_SEND_MODE: 'callrail',
        MESSAGING_SCHEMA_MODE: 'legacy',
      },
    });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('MESSAGING_SCHEMA_NOT_READY');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
  });

  it('fails CallRail MMS closed before credential lookup or provider fetch', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      participants: [{ contact_id: 'c-1', phone: '+18015551212', is_active: true }],
      contact: { ...OPTED_IN, phone: '+18015551212' },
    });
    const res = await onRequestPost({
      request: req({
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 'Photo',
        sent_by: 'e-1',
        media_urls: ['https://files.test/photo.jpg'],
        client_request_id: CLIENT_REQUEST_ID,
      }),
      env: { ...ENV, MESSAGING_SEND_MODE: 'callrail' },
    });
    const payload = await res.json();
    expect(res.status).toBe(201);
    expect(payload.error_code).toBe('MESSAGE_MEDIA_REFERENCE_INVALID');
    expect(outboundRows(h.db)[0].payload.status).toBe('failed');
    // The only fetch is requireAuth's Supabase user probe; no CallRail request.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── SECTION: sole-writer invariant (omni §7.1 adopted) ─────────────────────
describe('send-message worker is the sole writer', () => {
  it('the WORKER writes the outbound row, keyed to the twilio sid it dispatched', async () => {
    h.twilio = vi.fn(async () => ({ sid: 'SM-xyz', status: 'queued' }));
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
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
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'private', sent_by: 'e-1', is_internal_note: true }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).type).toBe('internal_note');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
    expect(consentBlocks(h.db)).toHaveLength(0);
  });

  it('reuses an internal note for the same client request id', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const requestBody = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      body: 'private',
      sent_by: 'e-1',
      is_internal_note: true,
      client_request_id: CLIENT_REQUEST_ID,
    };
    const first = await onRequestPost({ request: req(requestBody), env: ENV });
    const repeat = await onRequestPost({ request: req(requestBody), env: ENV });

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);
    expect(h.db.inserts.filter((item) => item.table === 'messages')).toHaveLength(1);
    expect((await repeat.json()).message.id).toBe((await first.json()).message.id);
  });
});

// ─── SECTION: per-participant send loop (Phase B) ───────────────────────────
describe('send-message per-participant consent loop', () => {
  it('group: a DND participant beyond index 0 is NOT texted; the compliant one is', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: true, opt_in_status: true, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    // Only the consenting recipient was texted.
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110001');
    // Exactly one outbound row — the DND recipient produced no message, only an audit block.
    expect(outboundRows(h.db)).toHaveLength(1);
    expect(consentBlocks(h.db).some((b) => b.payload.event_type === 'send_blocked_dnd')).toBe(true);
  });

  it('group: a repeated client request id never resubmits eligible recipients', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001' },
        { contact_id: 'c-2', phone: '+15551110002' },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: true, phone: '+15551110002' },
      },
    });
    const requestBody = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      body: 'hello group',
      sent_by: 'e-1',
      client_request_id: CLIENT_REQUEST_ID,
    };

    const first = await onRequestPost({ request: req(requestBody), env: ENV });
    const repeat = await onRequestPost({ request: req(requestBody), env: ENV });

    expect(first.status).toBe(201);
    expect(repeat.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(2);
    expect(outboundRows(h.db)).toHaveLength(2);
  });

  it('group: replay after recipient one resumes only the recipient without a child attempt', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001' },
        { contact_id: 'c-2', phone: '+15551110002' },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: true, phone: '+15551110002' },
      },
    });
    const requestBody = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      body: 'resume group',
      sent_by: 'e-1',
      client_request_id: CLIENT_REQUEST_ID,
    };
    h.twilio = vi.fn(async (_env, { to }) => {
      if (to === '+15551110002') throw new Error('simulated worker crash');
      return { sid: 'SM-first', status: 'queued', to };
    });

    await onRequestPost({ request: req(requestBody), env: ENV });
    const secondChild = h.db.attempts.find((attempt) => attempt.recipient_contact_id === 'c-2');
    h.db.attempts.splice(h.db.attempts.indexOf(secondChild), 1);
    h.db.inserts.splice(
      h.db.inserts.findIndex((item) => item.table === 'message_send_attempts' && item.payload.id === secondChild.id),
      1,
    );
    h.twilio = vi.fn(async (_env, { to }) => ({ sid: 'SM-second', status: 'queued', to }));

    const replay = await onRequestPost({ request: req(requestBody), env: ENV });

    expect(replay.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110002');
    expect(outboundRows(h.db).filter((row) => row.payload.recipient_address === '+15551110001')).toHaveLength(1);
  });

  it('group: a caller that loses the atomic child claim never submits that recipient', async () => {
    h.db = makeDb({
      conversation: { id: DIRECT.id, type: 'group', status: 'open' },
      participants: [{ contact_id: 'c-1', phone: '+15551110001' }],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
      },
    });
    const body = {
      conversation_id: DIRECT.id,
      body: 'claim once',
      sent_by: 'e-1',
      client_request_id: CLIENT_REQUEST_ID,
    };
    await onRequestPost({ request: req(body), env: ENV });
    const child = h.db.attempts.find((attempt) => attempt.parent_attempt_id);
    child.state = 'prepared';
    child.message_id = null;
    h.db.inserts.splice(
      h.db.inserts.findIndex((item) => item.table === 'messages' && item.payload.recipient_address === '+15551110001'),
      1,
    );
    h.db.rpc = vi.fn(async (name) => (
      name === 'claim_message_recipient_attempt' ? false : null
    ));
    h.twilio = vi.fn();

    const replay = await onRequestPost({ request: req(body), env: ENV });

    expect(replay.status).toBe(201);
    expect(h.twilio).not.toHaveBeenCalled();
    expect((await replay.json()).twilio[0].error_code).toBe('CLIENT_REQUEST_PENDING');
  });

  it('group: an opted-out participant beyond index 0 is skipped and audited', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: false, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
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
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: true, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
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

  it('group: a recipient with no consented phone is skipped, never cross-channel retargeted', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: null, is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: true, phone: null },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(201);
    // The no-phone recipient is never sent to (no silent retarget); only the reachable one is texted.
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110001');
    // A missing/mismatched consent destination is blocked before any provider
    // side effect or canonical outbound message is created.
    expect(outboundRows(h.db)).toHaveLength(1);
  });

  it('group: when EVERY recipient is blocked, nothing is sent and no message row is written (403)', async () => {
    h.db = makeDb({
      conversation: { id: '11111111-1111-4111-8111-111111111111', type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: true, opt_in_status: true, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: false, phone: '+15551110002' },
      },
    });
    const res = await onRequestPost({ request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ALL_RECIPIENTS_BLOCKED');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
  });
});
