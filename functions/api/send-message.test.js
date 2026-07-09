/**
 * ════════════════════════════════════════════════
 * FILE: send-message.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the outbound-SMS worker's compliance chain can never be bypassed.
 *   It checks that a Do-Not-Disturb contact and a not-opted-in contact are both
 *   blocked before any text goes out, that the old "skip_compliance" escape hatch
 *   is gone (a caller can no longer ask to skip the DND/opt-in checks), and that
 *   group / broadcast conversations are hard-refused (the per-recipient consent
 *   loop is a later phase, so the safe move today is to refuse them outright).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/send-message.js (onRequestPost)
 *
 * NOTES / GOTCHAS:
 *   - The Supabase client and Twilio sender are mocked; requireAuth's /auth/v1/user
 *     probe is stubbed via a global fetch. No network, no live A2P send.
 *   - Wave -1 compliance hotfix (F-2 skip_compliance removal, F-4 group/broadcast
 *     refuse-guard). TCPA penalties are per message — the bypass tests are the point.
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

// Minimal fake db keyed by table; overrides let each test pick the contact/convo shape.
function makeDb({ conversation, participants, contact } = {}) {
  return {
    select: async (table) => {
      if (table === 'conversations') return conversation ? [conversation] : [];
      if (table === 'conversation_participants') return participants || [{ contact_id: 'c-1', phone: '+15551112222' }];
      if (table === 'contacts') return contact ? [contact] : [];
      if (table === 'employees') return [{ id: 'e-1', full_name: 'Rep' }];
      return [];
    },
    insert: async () => [{ id: 'm-1' }],
    update: async () => null,
    rpc: async () => null,
  };
}

const OPTED_IN = { id: 'c-1', dnd: false, opt_in_status: true, phone: '+15551112222' };
const DIRECT = { id: 'conv-1', type: 'direct', status: 'open' };

beforeEach(() => {
  h.twilio = vi.fn(async () => ({ sid: 'SM-test' }));
  // requireAuth() probes /auth/v1/user — always succeed in tests.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('send-message compliance chain (Wave -1)', () => {
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

  it('hard-refuses a group conversation (no per-participant send loop yet)', async () => {
    h.db = makeDb({ conversation: { id: 'conv-1', type: 'group' }, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MULTI_RECIPIENT_UNSUPPORTED');
    expect(h.twilio).not.toHaveBeenCalled();
  });

  it('hard-refuses a broadcast conversation', async () => {
    h.db = makeDb({ conversation: { id: 'conv-1', type: 'broadcast' }, contact: OPTED_IN });
    const res = await onRequestPost({ request: req({ conversation_id: 'conv-1', body: 'hi', sent_by: 'e-1' }), env: ENV });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MULTI_RECIPIENT_UNSUPPORTED');
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
