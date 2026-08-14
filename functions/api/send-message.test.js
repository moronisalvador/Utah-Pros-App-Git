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
const h = vi.hoisted(() => ({
  db: null, twilio: null, supabase: null, timeoutFetch: vi.fn(), dispatch: vi.fn(),
}));
vi.mock('../lib/supabase.js', () => ({ supabase: (...args) => h.supabase(...args) }));
vi.mock('../lib/twilio.js', () => ({ sendMessage: (...args) => h.twilio(...args) }));
vi.mock('../lib/http.js', () => ({ fetchWithTimeout: h.timeoutFetch }));
// The thread alert is a real side effect of a real send — stub the dispatcher so
// the wiring can be asserted without standing up the whole notification stack.
vi.mock('./notify.js', () => ({ dispatchEvent: (...args) => h.dispatch(...args) }));

import { onRequestPost, notifyThreadMessageSent } from './send-message.js';

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
  serviceConsentsById = {},
  priorOutbound = [],
  employeeName = 'Rep',
  conversationAccess = true,
  navCanView = true,
} = {}) {
  const inserts = [];
  const attempts = [];
  const selects = [];
  const updates = [];
  const rpcCalls = [];
  return {
    inserts,
    attempts,
    selects,
    updates,
    rpcCalls,
    select: async (table, query = '') => {
      selects.push({ table, query });
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
          full_name: employeeName,
          role: 'office',
          is_active: true,
          is_external: false,
        }];
      }
      if (table === 'feature_flags' || table === 'employee_page_access') return [];
      if (table === 'nav_permissions') return [{ can_view: navCanView }];
      if (table === 'message_send_attempts') {
        const parentId = (/parent_attempt_id=eq\.([^&]+)/.exec(query) || [])[1];
        if (parentId) {
          const contactId = (/recipient_contact_id=eq\.([^&]+)/.exec(query) || [])[1];
          const address = (/recipient_address=eq\.([^&]+)/.exec(query) || [])[1];
          const fingerprint = (/request_fingerprint=eq\.([^&]+)/.exec(query) || [])[1];
          return attempts.filter((attempt) => (
            attempt.parent_attempt_id === parentId
            && (
              (fingerprint && attempt.request_fingerprint === fingerprint)
              || (contactId && attempt.recipient_contact_id === contactId)
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
      updates.push({ table, filter, payload });
      if (table === 'message_send_attempts') {
        const id = (/id=eq\.([^&]+)/.exec(filter) || [])[1];
        const attempt = attempts.find((item) => item.id === id);
        if (attempt) Object.assign(attempt, payload);
      }
      return null;
    },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'messaging_employee_can_access_conversation') {
        return conversationAccess;
      }
      if (name === 'get_service_sms_consent_status') {
        const resolvedContact = contactsById
          ? contactsById[args.p_contact_id]
          : contact;
        if (!resolvedContact) {
          return { allowed: false, code: 'CONTACT_NOT_FOUND' };
        }
        if (resolvedContact.dnd) {
          return { allowed: false, code: 'DND_ACTIVE' };
        }
        if (resolvedContact.opt_out_at) {
          return {
            allowed: false,
            code: 'CONTACT_OPTED_OUT',
            source: 'explicit_opt_out',
          };
        }
        if (resolvedContact.opt_in_status) {
          return { allowed: true, code: 'GLOBAL_OPT_IN' };
        }
        if (serviceConsentsById[args.p_contact_id]) {
          return { allowed: true, code: 'SERVICE_CONSENT' };
        }
        return { allowed: false, code: 'NO_CONSENT' };
      }
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
function sensitiveEffects(db) {
  const sensitiveTables = new Set([
    'conversations',
    'conversation_participants',
    'contacts',
    'messages',
    'message_send_attempts',
    'sms_consent_log',
  ]);
  return {
    selects: db.selects.filter((call) => sensitiveTables.has(call.table)),
    inserts: db.inserts.filter((call) => sensitiveTables.has(call.table)),
    updates: db.updates.filter((call) => sensitiveTables.has(call.table)),
    providerCalls: h.twilio.mock.calls,
    storageDownloads: db.downloadStorage.mock.calls,
    storageSigns: db.signStorage.mock.calls,
  };
}

beforeEach(() => {
  h.twilio = vi.fn(async () => ({ sid: 'SM-test', status: 'queued' }));
  h.supabase = vi.fn(() => h.db);
  h.timeoutFetch.mockReset();
  h.timeoutFetch.mockImplementation((...args) => fetch(...args));
  h.dispatch.mockReset();
  h.dispatch.mockResolvedValue({ recipients: 0, results: [] });
  // requireAuth() probes /auth/v1/user — always succeed in tests.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'auth-user-1' }),
  })));
});

describe('send-message response and timeout contracts', () => {
  it('uses the timeout helper for both its Supabase client and employee auth', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });

    const response = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'customer update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(response.status).toBe(201);
    expect(h.supabase).toHaveBeenCalledWith(ENV, h.timeoutFetch);
    expect(h.timeoutFetch).toHaveBeenCalledWith(
      'https://db.test/auth/v1/user',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('sets no-store on successful and error JSON responses', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const success = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'customer update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });
    const invalid = await onRequestPost({
      request: req({ body: 'customer update', sent_by: 'e-1' }),
      env: ENV,
    });

    expect(success.headers.get('Cache-Control')).toBe('no-store');
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ─── SECTION: participant authorization before every side effect ────────────
describe('send-message participant authorization', () => {
  it.each([
    ['removed member', false],
    ['never member', false],
  ])('denies a %s before SMS or internal-note work', async (_label, conversationAccess) => {
    for (const isInternalNote of [false, true]) {
      h.db = makeDb({
        conversation: DIRECT,
        contact: OPTED_IN,
        conversationAccess,
      });

      const response = await onRequestPost({
        request: req({
          conversation_id: DIRECT.id,
          body: isInternalNote ? 'private note' : 'customer update',
          sent_by: 'e-1',
          is_internal_note: isInternalNote,
        }),
        env: ENV,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'CONVERSATION_NOT_AUTHORIZED',
      });
      expect(h.db.rpcCalls).toContainEqual({
        name: 'messaging_employee_can_access_conversation',
        args: {
          p_employee_id: 'e-1',
          p_conversation_id: DIRECT.id,
        },
      });
      expect(sensitiveEffects(h.db)).toEqual({
        selects: [],
        inserts: [],
        updates: [],
        providerCalls: [],
        storageDownloads: [],
        storageSigns: [],
      });
    }
  });

  it.each([false, true])(
    'denies capability-revoked staff before membership or downstream work (note=%s)',
    async (isInternalNote) => {
      h.db = makeDb({
        conversation: DIRECT,
        contact: OPTED_IN,
        conversationAccess: true,
        navCanView: false,
      });

      const response = await onRequestPost({
        request: req({
          conversation_id: DIRECT.id,
          body: isInternalNote ? 'private note' : 'customer update',
          sent_by: 'e-1',
          is_internal_note: isInternalNote,
        }),
        env: ENV,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'MESSAGING_NOT_AUTHORIZED',
      });
      expect(h.db.rpcCalls).toEqual([]);
      expect(sensitiveEffects(h.db)).toEqual({
        selects: [],
        inserts: [],
        updates: [],
        providerCalls: [],
        storageDownloads: [],
        storageSigns: [],
      });
    },
  );

  it('fails closed when current membership cannot be verified', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const originalRpc = h.db.rpc;
    h.db.rpc = vi.fn(async (name, args) => {
      if (name === 'messaging_employee_can_access_conversation') {
        throw new Error('membership lookup unavailable');
      }
      return originalRpc(name, args);
    });

    const response = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'customer update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 'CONVERSATION_AUTHORIZATION_FAILED',
    });
    expect(sensitiveEffects(h.db)).toEqual({
      selects: [],
      inserts: [],
      updates: [],
      providerCalls: [],
      storageDownloads: [],
      storageSigns: [],
    });
  });
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

  it('keeps a durable pending STOP distinct and never offers a send', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: { ...OPTED_IN, opt_in_status: false },
    });
    const originalRpc = h.db.rpc;
    h.db.rpc = vi.fn(async (name, args) => {
      if (name === 'get_service_sms_consent_status') {
        return {
          allowed: false,
          code: 'CONTACT_PENDING_STOP',
          source: 'pending_stop',
        };
      }
      return originalRpc(name, args);
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Project update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CONTACT_PENDING_STOP');
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
    expect((await res.json()).code).toBe('CONTACT_OPTED_OUT');
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

  it('allows a direct service message with verified service consent without global opt-in', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: { ...OPTED_IN, opt_in_status: false },
      serviceConsentsById: { 'c-1': true },
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Project update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
  });

  it('allows a direct existing-client service message only after durable decision audit', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: { ...OPTED_IN, opt_in_status: false },
    });
    const originalRpc = h.db.rpc;
    h.db.rpc = vi.fn(async (name, args) => {
      if (name === 'get_service_sms_consent_status') {
        return {
          allowed: true,
          code: 'IMPLIED_CONSENT',
          source: 'no_recorded_objection',
        };
      }
      return originalRpc(name, args);
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Project update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    const audit = consentBlocks(h.db).find(
      ({ payload }) => payload.event_type === 'service_send_allowed_existing_client',
    );
    expect(audit?.payload).toMatchObject({
      contact_id: 'c-1',
      event_type: 'service_send_allowed_existing_client',
      source: 'existing_client_service_relationship',
      performed_by: 'e-1',
    });
    expect(audit.payload.details).toContain('not a marketing opt-in');
    const auditIndex = h.db.inserts.indexOf(audit);
    const messageIndex = h.db.inserts.findIndex(
      ({ table, payload }) => table === 'messages' && payload.type === 'sms_outbound',
    );
    expect(auditIndex).toBeGreaterThanOrEqual(0);
    expect(messageIndex).toBeGreaterThan(auditIndex);
  });

  it('fails closed when the required implied-service decision audit cannot be stored', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: { ...OPTED_IN, opt_in_status: false },
    });
    const originalRpc = h.db.rpc;
    h.db.rpc = vi.fn(async (name, args) => {
      if (name === 'get_service_sms_consent_status') {
        return { allowed: true, code: 'IMPLIED_CONSENT' };
      }
      return originalRpc(name, args);
    });
    const originalInsert = h.db.insert;
    h.db.insert = vi.fn(async (table, payload) => {
      if (table === 'sms_consent_log') {
        throw new Error('audit unavailable');
      }
      return originalInsert(table, payload);
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Project update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(500);
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
  });

  it('rejects a direct-shaped thread with multiple recipients before implied consent or transport', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      participants: [
        { contact_id: 'c-1', phone: '+15551110001', is_active: true },
        { contact_id: 'c-2', phone: '+15551110002', is_active: true },
      ],
      contactsById: {
        'c-1': { id: 'c-1', dnd: false, opt_in_status: false, phone: '+15551110001' },
        'c-2': { id: 'c-2', dnd: false, opt_in_status: false, phone: '+15551110002' },
      },
    });
    const originalRpc = h.db.rpc;
    h.db.rpc = vi.fn(async (name, args) => {
      if (name === 'get_service_sms_consent_status') {
        return { allowed: true, code: 'IMPLIED_CONSENT' };
      }
      return originalRpc(name, args);
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Project update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('DIRECT_PURPOSE_UNSUPPORTED');
    expect(h.db.rpc).toHaveBeenCalledTimes(1);
    expect(h.db.rpc).toHaveBeenCalledWith(
      'messaging_employee_can_access_conversation',
      {
        p_employee_id: 'e-1',
        p_conversation_id: DIRECT.id,
      },
    );
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('keeps STOP fail-closed even when a service consent record exists', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: {
        ...OPTED_IN,
        opt_in_status: false,
        opt_out_at: '2026-07-23T18:00:00.000Z',
      },
      serviceConsentsById: { 'c-1': true },
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Project update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CONTACT_OPTED_OUT');
    expect(h.twilio).not.toHaveBeenCalled();
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

  it('names the company and the short sender on the first message of a thread', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: OPTED_IN,
      employeeName: 'Moroni Salvador',
    });

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
      'Utah Pros Restoration - Moroni S.: We are on our way. Reply STOP to unsubscribe.',
    );
  });

  // Character budget: CallRail caps content at 140. Once the thread is established the
  // recipient knows who they are talking to, so the company string is dropped to buy
  // back 30 characters. STOP instructions are not repeated (they ran on message one).
  it('drops to the short sender prefix in a continuing thread', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: OPTED_IN,
      priorOutbound: [{ id: 'prior-message' }],
      employeeName: 'Moroni Salvador',
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
      'Moroni S.: The drying check is complete.',
    );
  });

  // A two-surname name uses the FIRST surname's initial, matching how the owner
  // specified it ("first name and first last name initial", 2026-07-26).
  it('uses the first surname initial for a two-surname employee name', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: OPTED_IN,
      priorOutbound: [{ id: 'prior-message' }],
      employeeName: 'Moroni Salvador Perez',
    });

    await onRequestPost({
      request: req({ conversation_id: DIRECT.id, body: 'Done.', sent_by: 'e-1' }),
      env: ENV,
    });

    expect(h.twilio.mock.calls[0][1].body).toBe('Moroni S.: Done.');
  });

  // Never emit an anonymous prefix: a blank/one-word name falls back to the company,
  // which is the identification the consent remediation actually requires.
  it('falls back to the company name when the employee has no surname', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: OPTED_IN,
      priorOutbound: [{ id: 'prior-message' }],
      employeeName: '   ',
    });

    await onRequestPost({
      request: req({ conversation_id: DIRECT.id, body: 'Done.', sent_by: 'e-1' }),
      env: ENV,
    });

    expect(h.twilio.mock.calls[0][1].body).toBe('Utah Pros Restoration: Done.');
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

// ─── SECTION: CallRail multi-photo split ────────────────────────────────────
// One staff POST with N photos on CallRail fans out into N sequential provider
// MMS (CallRail takes ONE media per message); Twilio never splits. Consent
// still evaluates once, before any part; each part is its own message row and
// child attempt keyed by a content-derived part fingerprint.
describe('send-message CallRail multi-photo split', () => {
  const CALLRAIL_ENV = {
    ...ENV,
    MESSAGING_SEND_MODE: 'callrail',
    CALLRAIL_API_KEY: 'key-test',
    CALLRAIL_ACCOUNT_ID: 'ACC-1',
    CALLRAIL_COMPANY_ID: 'COM-1',
    CALLRAIL_TRACKING_NUMBER: '+18015550000',
  };
  const mediaRef = (n) => `upr-storage://message-attachments/outbound/${DIRECT.id}/photo-${n}.jpg`;
  const THREE_PHOTOS = [mediaRef(1), mediaRef(2), mediaRef(3)];

  function splitDb(overrides = {}) {
    return makeDb({
      conversation: DIRECT,
      participants: [{ contact_id: 'c-1', phone: '+18015551212', is_active: true }],
      contact: { ...OPTED_IN, phone: '+18015551212' },
      employeeName: 'Rep Tester',
      ...overrides,
    });
  }

  // Route the mocked timeout fetch: auth probe succeeds, CallRail calls are
  // recorded (and can be failed per-part via failPart — a number or an array).
  function stubProviderFetch({ failPart = null, failMode = 'rejected' } = {}) {
    const callrailCalls = [];
    const failParts = new Set([].concat(failPart ?? []));
    h.timeoutFetch.mockImplementation(async (url, options = {}) => {
      if (String(url).includes('/auth/v1/user')) {
        return { ok: true, json: async () => ({ id: 'auth-user-1' }) };
      }
      if (String(url).includes('api.callrail.com')) {
        callrailCalls.push({ url: String(url), options });
        const part = callrailCalls.length;
        if (failParts.has(part)) {
          if (failMode === 'network') throw new Error('socket hang up');
          return { ok: false, status: 400, json: async () => ({}) };
        }
        return { ok: true, status: 201, json: async () => ({ id: `CONV-${part}` }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    return callrailCalls;
  }

  function splitRequest(extra = {}) {
    return req({
      conversation_id: DIRECT.id,
      body: 'check these out',
      sent_by: 'e-1',
      media_urls: THREE_PHOTOS,
      client_request_id: CLIENT_REQUEST_ID,
      ...extra,
    });
  }

  it('fans 3 photos into 3 sequential one-media CallRail sends, in staged order', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch();

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.error_code).toBeUndefined();

    // Three provider messages, each carrying exactly ONE media item, in the
    // exact order the photos were staged.
    expect(callrailCalls).toHaveLength(3);
    for (const [index, call] of callrailCalls.entries()) {
      expect(call.options.body.getAll('media_file')).toHaveLength(1);
      expect(call.options.body.get('media_file').name).toBe(`photo-${index + 1}.jpg`);
    }
    // Text rides with photo 1 (company identity + STOP notice on a first
    // outbound); parts 2..3 carry the short sender identity with a unique
    // "(i/N)" tag — CallRail requires content, and the reconciler matches by
    // exact body, so identical part bodies would be unreconcilable.
    expect(callrailCalls[0].options.body.get('content'))
      .toBe('Utah Pros Restoration - Rep T.: check these out Reply STOP to unsubscribe.');
    expect(callrailCalls[1].options.body.get('content')).toBe('Rep T. (2/3)');
    expect(callrailCalls[2].options.body.get('content')).toBe('Rep T. (3/3)');

    // Three message rows: the typed text on row 1 only, one media item per
    // row, client_request_id on row 1 only (the optimistic-bubble anchor).
    const rows = outboundRows(h.db).map((item) => item.payload);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.body)).toEqual(['check these out', '', '']);
    expect(rows.every((row) => row.channel === 'mms')).toBe(true);
    expect(rows.map((row) => JSON.parse(row.media_urls))).toEqual([
      [THREE_PHOTOS[0]], [THREE_PHOTOS[1]], [THREE_PHOTOS[2]],
    ]);
    expect(rows[0].client_request_id).toBe(CLIENT_REQUEST_ID);
    expect(rows[1].client_request_id).toBeNull();
    expect(rows[2].client_request_id).toBeNull();

    // One parent attempt + three children. Children carry NULL contact (the
    // partial unique index admits one child per contact) and distinct
    // content-derived fingerprints; each accepted CallRail part schedules its
    // own reconcile to pick up its provider message id.
    const children = h.db.attempts.filter((a) => a.parent_attempt_id);
    expect(h.db.attempts).toHaveLength(4);
    expect(children).toHaveLength(3);
    expect(children.every((a) => a.recipient_contact_id === null)).toBe(true);
    expect(new Set(children.map((a) => a.request_fingerprint)).size).toBe(3);
    expect(children.every((a) => a.state === 'accepted')).toBe(true);
    expect(children.every((a) => a.reconcile_after != null)).toBe(true);
    const parent = h.db.attempts.find((a) => !a.parent_attempt_id);
    expect(parent.state).toBe('accepted');
    expect(parent.message_id).toBe(rows[0].id);
    expect(parent.reconcile_after).toBeNull();

    // The response reports every part, and the thread hears ONE alert.
    expect(payload.twilio.map((r) => r.part_index)).toEqual([1, 2, 3]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('replays a completed split idempotently — same client_request_id, zero provider calls', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch();

    await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });
    expect(callrailCalls).toHaveLength(3);
    const firstRowId = outboundRows(h.db)[0].payload.id;

    const replay = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });
    const payload = await replay.json();

    expect(replay.status).toBe(201);
    expect(payload.message.id).toBe(firstRowId);
    // No part was re-sent and no new rows were written.
    expect(callrailCalls).toHaveLength(3);
    expect(outboundRows(h.db)).toHaveLength(3);
  });

  it('a failed middle part is recorded and later parts still send — never re-sent', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch({ failPart: 2, failMode: 'http400' });

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });
    const payload = await res.json();

    expect(res.status).toBe(201);
    // All three parts attempted exactly once — the failure neither stops the
    // burst nor triggers a resubmission.
    expect(callrailCalls).toHaveLength(3);
    const rows = outboundRows(h.db).map((item) => item.payload);
    expect(rows.map((row) => row.status)).toEqual(['queued', 'failed', 'queued']);
    expect(rows[1].error_code).toBe('CALLRAIL_REJECTED');
    // The response names exactly which parts sent and which failed.
    expect(payload.twilio.map((r) => r.part_index)).toEqual([1, 2, 3]);
    expect(payload.twilio[1].error_code).toBe('CALLRAIL_REJECTED');
    expect(payload.twilio[0].error).toBeUndefined();
    expect(payload.twilio[2].error).toBeUndefined();
    expect(payload.error_code).toBe('CALLRAIL_REJECTED');
    // Parts that reached the provider still announce once.
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('promotes the identification + STOP body until a part is CONFIRMED accepted', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch({ failPart: 1, failMode: 'http400' });

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(callrailCalls).toHaveLength(3);
    // Part 1 never reached the customer, so the first message that CAN reach
    // them must carry the company identity and the STOP notice (10DLC/CTIA:
    // the first delivered message identifies the sender). The promoted repeat
    // appends its own "(i/N)" tag so every wire body in the burst stays
    // unique for the exact-body reconciler. Part 3 (after a confirmed
    // acceptance) returns to the tagged short form.
    expect(callrailCalls[0].options.body.get('content'))
      .toBe('Utah Pros Restoration - Rep T.: check these out Reply STOP to unsubscribe.');
    expect(callrailCalls[1].options.body.get('content'))
      .toBe('Utah Pros Restoration - Rep T.: check these out Reply STOP to unsubscribe. (2/3)');
    expect(callrailCalls[2].options.body.get('content')).toBe('Rep T. (3/3)');
    // The promoted part's row carries the typed text (that IS what the
    // customer received with photo 2).
    const rows = outboundRows(h.db).map((item) => item.payload);
    expect(rows.map((row) => row.status)).toEqual(['failed', 'queued', 'queued']);
    expect(rows.map((row) => row.body)).toEqual(['check these out', 'check these out', '']);
    expect(payload.twilio[0].error_code).toBe('CALLRAIL_REJECTED');
  });

  it('an AMBIGUOUS part also keeps promotion going — under-disclosure is the failure mode', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch({ failPart: 1, failMode: 'network' });

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });

    expect(res.status).toBe(201);
    expect(callrailCalls).toHaveLength(3);
    // Part 1 threw at the network layer, so delivery is UNKNOWN. Promotion
    // continues: if part 1 really failed, part 2 is the first message the
    // customer receives and must be identified; if part 1 really delivered,
    // the repeat is harmless over-disclosure. The "(2/3)" tag keeps the two
    // bodies distinct so part 1's own reconciliation can never collide.
    expect(callrailCalls[0].options.body.get('content'))
      .toBe('Utah Pros Restoration - Rep T.: check these out Reply STOP to unsubscribe.');
    expect(callrailCalls[1].options.body.get('content'))
      .toBe('Utah Pros Restoration - Rep T.: check these out Reply STOP to unsubscribe. (2/3)');
    expect(callrailCalls[2].options.body.get('content')).toBe('Rep T. (3/3)');
  });

  it('keeps promoting through consecutive definitive failures', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch({ failPart: [1, 2], failMode: 'http400' });

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });

    expect(res.status).toBe(201);
    expect(callrailCalls).toHaveLength(3);
    // Parts 1 and 2 were both definitively refused — the identity keeps
    // moving forward until it actually lands, so the ONLY delivered message
    // of the burst still identifies the company and carries STOP.
    expect(callrailCalls[2].options.body.get('content'))
      .toBe('Utah Pros Restoration - Rep T.: check these out Reply STOP to unsubscribe. (3/3)');
    const rows = outboundRows(h.db).map((item) => item.payload);
    expect(rows.map((row) => row.status)).toEqual(['failed', 'failed', 'queued']);
    expect(rows.map((row) => row.body)).toEqual(['check these out', 'check these out', 'check these out']);
  });

  it('an ambiguous part goes to reconciliation — the burst continues without resubmitting it', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch({ failPart: 2, failMode: 'network' });

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(callrailCalls).toHaveLength(3);
    expect(payload.error_code).toBe('CALLRAIL_SEND_AMBIGUOUS');
    const children = h.db.attempts.filter((a) => a.parent_attempt_id);
    expect(children.map((a) => a.state)).toEqual(['accepted', 'ambiguous', 'accepted']);
    expect(children[1].reconcile_after).not.toBeNull();
    // The parent stays open (ambiguous, uncompleted) but is kept out of the
    // provider reconciler's scan — its children own reconciliation.
    const parent = h.db.attempts.find((a) => !a.parent_attempt_id);
    expect(parent.state).toBe('ambiguous');
    expect(parent.completed_at).toBeNull();
    expect(parent.reconcile_after).toBeNull();
  });

  it('one bad photo refuses the whole burst before ANY provider call', async () => {
    h.db = splitDb();
    const callrailCalls = stubProviderFetch();

    const res = await onRequestPost({
      request: splitRequest({
        media_urls: [
          mediaRef(1),
          'upr-storage://message-attachments/callrail/foreign/photo.jpg',
          mediaRef(3),
        ],
      }),
      env: CALLRAIL_ENV,
    });
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.error_code).toBe('MESSAGE_MEDIA_REFERENCE_INVALID');
    // Nothing reached CallRail; the whole composed send is ONE visible failed
    // row (the single-photo failure shape), not a half-sent burst.
    expect(callrailCalls).toHaveLength(0);
    const rows = outboundRows(h.db).map((item) => item.payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('consent still gates the whole burst before any storage or provider work', async () => {
    h.db = splitDb({ contact: { ...OPTED_IN, phone: '+18015551212', dnd: true } });
    const callrailCalls = stubProviderFetch();

    const res = await onRequestPost({ request: splitRequest(), env: CALLRAIL_ENV });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DND_ACTIVE');
    expect(callrailCalls).toHaveLength(0);
    expect(outboundRows(h.db)).toHaveLength(0);
    expect(h.db.downloadStorage).not.toHaveBeenCalled();
  });

  it('Twilio is NOT split — 3 photos ride one provider message and one row', async () => {
    h.db = splitDb();

    const res = await onRequestPost({ request: splitRequest(), env: ENV });
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].mediaUrls).toHaveLength(3);
    const rows = outboundRows(h.db).map((item) => item.payload);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].media_urls)).toEqual(THREE_PHOTOS);
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
    // It DOES alert the thread — as a note, never as a sent text.
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const { typeKey, body } = h.dispatch.mock.calls[0][0];
    expect(typeKey).toBe('message.note');
    expect(body.title).toMatch(/^Note from /);
    expect(body.title).not.toMatch(/texted/);
    expect(body.exclude_employee_id).toBe('e-1');
  });

  it('a replayed note (same client_request_id) never alerts twice', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const requestBody = {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      body: 'private',
      sent_by: 'e-1',
      is_internal_note: true,
      client_request_id: CLIENT_REQUEST_ID,
    };
    await onRequestPost({ request: req(requestBody), env: ENV });
    await onRequestPost({ request: req(requestBody), env: ENV });
    expect(h.db.inserts.filter((item) => item.table === 'messages')).toHaveLength(1);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('a delivered text alerts the rest of the thread, excluding the sender', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'On my way.', sent_by: 'e-1' }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const { typeKey, body } = h.dispatch.mock.calls[0][0];
    expect(typeKey).toBe('message.outbound');
    expect(body.exclude_employee_id).toBe('e-1');
    expect(body.entity_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.body).toBe('On my way.');
    // Load-bearing for the iOS app: notify.js skips the APNs push entirely
    // without a notification_event_id (nativeNotificationEventKey → null).
    expect(body.notification_event_id).toBe((await res.json()).message.id);
    expect(body.notification_event_id).toBeTruthy();
  });

  it('a provider failure raises no thread alert, even though the row is recorded', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    h.twilio = vi.fn(async () => { throw Object.assign(new Error('provider down'), { status: 500 }); });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    // The failure is still recorded — it just is not announced as a sent text.
    expect(outboundRows(h.db)).toHaveLength(1);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('a blocked send raises no thread alert', async () => {
    h.db = makeDb({
      conversation: DIRECT,
      contact: { id: 'c-1', dnd: true, opt_in_status: true, phone: '+15551110001' },
    });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: ENV,
    });
    expect(res.status).toBe(403);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('defers the alert through context.waitUntil so the sender never waits on it', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const deferred = [];
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: ENV,
      waitUntil: (promise) => deferred.push(promise),
    });
    expect(res.status).toBe(201);
    // Handed to the platform, not awaited inline.
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch.mock.calls[0][0].typeKey).toBe('message.outbound');
  });

  it('still delivers the alert when the platform offers no waitUntil', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('a failing thread alert never turns a delivered text into an error', async () => {
    h.db = makeDb({ conversation: DIRECT, contact: OPTED_IN });
    h.dispatch.mockRejectedValue(new Error('notify down'));
    const res = await onRequestPost({
      request: req({ conversation_id: '11111111-1111-4111-8111-111111111111', body: 'hi', sent_by: 'e-1' }),
      env: ENV,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).success).toBe(true);
    expect(h.twilio).toHaveBeenCalledTimes(1);
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
    // The replay recovers every participant's existing row and sends nothing, so
    // it must not announce the fan-out a second time. `anyAccepted` alone is true
    // here (a `recovered` result carries no skipped/error flag) — the guard that
    // makes this correct is `anyFreshSend`.
    expect(h.dispatch).toHaveBeenCalledTimes(1);
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
    const originalRpc = h.db.rpc;
    h.db.rpc = vi.fn(async (name, args) => (
      name === 'claim_message_recipient_attempt'
        ? false
        : originalRpc(name, args)
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

  it('group: service-only consent cannot authorize a group or broadcast send', async () => {
    h.db = makeDb({
      conversation: { id: DIRECT.id, type: 'group', status: 'open' },
      participants: [{ contact_id: 'c-1', phone: '+15551110001' }],
      contactsById: {
        'c-1': {
          id: 'c-1',
          dnd: false,
          opt_in_status: false,
          phone: '+15551110001',
        },
      },
      serviceConsentsById: { 'c-1': true },
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Group update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ALL_RECIPIENTS_BLOCKED');
    expect(h.twilio).not.toHaveBeenCalled();
    expect(outboundRows(h.db)).toHaveLength(0);
    expect(consentBlocks(h.db)).toHaveLength(1);
  });

  it('group: sends only to global opt-ins, never service-consent-only recipients', async () => {
    h.db = makeDb({
      conversation: { id: DIRECT.id, type: 'group', status: 'open' },
      participants: [
        { contact_id: 'c-1', phone: '+15551110001' },
        { contact_id: 'c-2', phone: '+15551110002' },
      ],
      contactsById: {
        'c-1': {
          id: 'c-1',
          dnd: false,
          opt_in_status: true,
          phone: '+15551110001',
        },
        'c-2': {
          id: 'c-2',
          dnd: false,
          opt_in_status: false,
          phone: '+15551110002',
        },
      },
      serviceConsentsById: { 'c-2': true },
    });

    const res = await onRequestPost({
      request: req({
        conversation_id: DIRECT.id,
        body: 'Group update',
        sent_by: 'e-1',
      }),
      env: ENV,
    });

    expect(res.status).toBe(201);
    expect(h.twilio).toHaveBeenCalledTimes(1);
    expect(h.twilio.mock.calls[0][1].to).toBe('+15551110001');
    expect(outboundRows(h.db)).toHaveLength(1);
    expect(consentBlocks(h.db)).toHaveLength(1);
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

// ─── SECTION: Thread alert for a teammate's outbound text (2026-08-04) ───────
// Before this, only an INBOUND customer text raised an alert, so a rep could
// answer a thread and nobody else watching it knew. These tests pin the two
// properties that matter: the author is never notified about their own text,
// and an alert failure can never fail a text that already went out.
describe('notifyThreadMessageSent', () => {
  const CONVERSATION = '11111111-1111-4111-8111-111111111111';

  it('emits message.outbound excluding the author, with the raw typed text', async () => {
    const dispatchImpl = vi.fn().mockResolvedValue({ recipients: 1 });
    await notifyThreadMessageSent({
      db: {}, env: ENV,
      conversationId: CONVERSATION,
      messageId: 'm-1',
      senderEmployeeId: 'e-1',
      senderName: 'Moroni S.',
      customerName: 'Jordan Lee',
      rawBody: 'We can be there at 9.',
      dispatchImpl,
    });

    expect(dispatchImpl).toHaveBeenCalledTimes(1);
    const call = dispatchImpl.mock.calls[0][0];
    expect(call.typeKey).toBe('message.outbound');
    expect(call.body.exclude_employee_id).toBe('e-1');
    expect(call.body.entity_id).toBe(CONVERSATION);
    expect(call.body.notification_event_id).toBe('m-1');
    expect(call.body.title).toBe('Moroni S. texted Jordan Lee');
    expect(call.body.presentation_context).toEqual({
      sender_name: 'Moroni S.',
      customer_name: 'Jordan Lee',
      message_preview: 'We can be there at 9.',
    });
    // The producer never dictates WHO hears about it — notify.js re-derives the
    // audience from conversation access. A recipient list here would be a leak.
    expect(call.body.recipient_ids).toBeUndefined();
  });

  it('never leaks the "Moroni S.: " wire prefix into the alert preview', async () => {
    const dispatchImpl = vi.fn().mockResolvedValue({});
    await notifyThreadMessageSent({
      db: {}, env: ENV,
      conversationId: CONVERSATION,
      senderEmployeeId: 'e-1',
      senderName: 'Moroni S.',
      customerName: 'Jordan Lee',
      rawBody: 'On my way.',
      dispatchImpl,
    });
    const { body } = dispatchImpl.mock.calls[0][0];
    expect(body.body).toBe('On my way.');
    expect(body.presentation_context.message_preview).not.toMatch(/Moroni S\.:/);
  });

  it('emits message.note — never described as sent — for an internal note', async () => {
    const dispatchImpl = vi.fn().mockResolvedValue({});
    await notifyThreadMessageSent({
      db: {}, env: ENV,
      conversationId: CONVERSATION,
      messageId: 'n-1',
      senderEmployeeId: 'e-1',
      senderName: 'Moroni S.',
      customerName: 'Jordan Lee',
      rawBody: 'Customer prefers mornings.',
      isInternalNote: true,
      dispatchImpl,
    });
    const { typeKey, body } = dispatchImpl.mock.calls[0][0];
    expect(typeKey).toBe('message.note');
    expect(body.title).toBe('Note from Moroni S. · Jordan Lee');
    // A staff-only note must never read as something the customer received.
    expect(body.title).not.toMatch(/texted|sent/i);
    expect(body.exclude_employee_id).toBe('e-1');
    expect(body.notification_event_id).toBe('n-1');
    expect(body.recipient_ids).toBeUndefined();
  });

  it('a note carries no media branch — it has no transport', async () => {
    const dispatchImpl = vi.fn().mockResolvedValue({});
    await notifyThreadMessageSent({
      db: {}, env: ENV,
      conversationId: CONVERSATION,
      senderEmployeeId: 'e-1',
      senderName: 'Moroni S.',
      customerName: 'Jordan Lee',
      rawBody: '',
      hasMedia: true,
      isInternalNote: true,
      dispatchImpl,
    });
    const { body } = dispatchImpl.mock.calls[0][0];
    expect(body.body).toBe('');
    expect(body.body).not.toBe('📷 Photo');
  });

  it('labels a media-only send and falls back for a blank sender name', async () => {
    const dispatchImpl = vi.fn().mockResolvedValue({});
    await notifyThreadMessageSent({
      db: {}, env: ENV,
      conversationId: CONVERSATION,
      senderEmployeeId: 'e-1',
      senderName: null,
      customerName: null,
      rawBody: '',
      hasMedia: true,
      dispatchImpl,
    });
    const { body } = dispatchImpl.mock.calls[0][0];
    expect(body.body).toBe('📷 Photo');
    expect(body.title).toBe('A teammate sent a text');
    expect(body.presentation_context.sender_name).toBe('A teammate');
  });

  it('a dispatch failure never propagates — the text already went out', async () => {
    const dispatchImpl = vi.fn().mockRejectedValue(new Error('notify down'));
    await expect(notifyThreadMessageSent({
      db: {}, env: ENV,
      conversationId: CONVERSATION,
      senderEmployeeId: 'e-1',
      senderName: 'Moroni S.',
      customerName: 'Jordan Lee',
      rawBody: 'hi',
      dispatchImpl,
    })).resolves.toBeUndefined();
  });

  it('fails closed without a conversation or an author to exclude', async () => {
    const dispatchImpl = vi.fn();
    await notifyThreadMessageSent({
      db: {}, env: ENV, conversationId: null, senderEmployeeId: 'e-1', dispatchImpl,
    });
    await notifyThreadMessageSent({
      db: {}, env: ENV, conversationId: CONVERSATION, senderEmployeeId: null, dispatchImpl,
    });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });
});
