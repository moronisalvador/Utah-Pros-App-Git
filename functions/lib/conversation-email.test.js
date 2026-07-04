/**
 * ════════════════════════════════════════════════
 * FILE: conversation-email.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tests the safe email-reply sender. Proves the reason-aware suppression gate lets a
 *   marketing-unsubscribed address still get a 1:1 reply but BLOCKS a hard-bounce /
 *   complaint / global suppression before any email is sent, that a missing or bad
 *   recipient is refused, that a lookup failure fails closed, and that a real send
 *   carries the token reply-to and threading headers. Network is stubbed — no email
 *   or database is actually contacted.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/conversation-email.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendConversationEmail, isTransactionalReplyBlocked } from './conversation-email.js';

// A stubbed fetch Response supporting both res.text() (sendEmail) and res.json() (supabase).
function fakeResponse(obj, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(obj);
  return { ok, status, text: async () => text, json: async () => obj };
}

const ENV = { RESEND_API_KEY: 'test-key', SUPABASE_URL: 'https://proj.supabase.co' };

// Route stubbed fetch by URL; `resendCapture` records the last Resend payload.
function stubFetch({ suppressionRows = [], suppressionThrows = false } = {}) {
  const capture = { resend: null, resendCalled: false };
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('/rest/v1/email_suppressions')) {
      if (suppressionThrows) throw new Error('network down');
      return fakeResponse(suppressionRows);
    }
    if (u.includes('api.resend.com')) {
      capture.resendCalled = true;
      capture.resend = JSON.parse(init.body);
      return fakeResponse({ id: 're_abc123' });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }));
  return capture;
}

afterEach(() => vi.unstubAllGlobals());

describe('isTransactionalReplyBlocked (pure reason-aware predicate)', () => {
  it('no row → not blocked', () => {
    expect(isTransactionalReplyBlocked(null)).toBe(false);
    expect(isTransactionalReplyBlocked(undefined)).toBe(false);
  });
  it('unsubscribed-only → NOT blocked (transactional reply allowed)', () => {
    expect(isTransactionalReplyBlocked({ reason: 'unsubscribed' })).toBe(false);
  });
  it('hard reasons → blocked', () => {
    for (const reason of ['hard_bounce', 'complaint', 'global', 'bounced', 'complained', 'manual']) {
      expect(isTransactionalReplyBlocked({ reason })).toBe(true);
    }
  });
});

describe('sendConversationEmail', () => {
  const conversation = { id: 'c1', email_reply_token: 'tok_deadbeef', title: 'Water damage' };
  const participant = { email: 'Client@Example.com' };

  it('refuses with no recipient email and sends nothing', async () => {
    const cap = stubFetch();
    const res = await sendConversationEmail(ENV, { conversation, participant: {}, body: 'hi' });
    expect(res).toMatchObject({ ok: false, skipped: true, reason: 'no_recipient_email' });
    expect(cap.resendCalled).toBe(false);
  });

  it('refuses an obviously invalid address', async () => {
    const cap = stubFetch();
    const res = await sendConversationEmail(ENV, { conversation, participant: { email: 'not-an-email' }, body: 'hi' });
    expect(res.skipped).toBe(true);
    expect(cap.resendCalled).toBe(false);
  });

  it('BLOCKS a hard_bounce suppression before contacting Resend', async () => {
    const cap = stubFetch({ suppressionRows: [{ email: 'client@example.com', reason: 'hard_bounce' }] });
    const res = await sendConversationEmail(ENV, { conversation, participant, body: 'hi' });
    expect(res).toMatchObject({ ok: false, skipped: true, reason: 'suppressed:hard_bounce' });
    expect(cap.resendCalled).toBe(false);
  });

  it('ALLOWS a reply to an unsubscribed-only address', async () => {
    const cap = stubFetch({ suppressionRows: [{ email: 'client@example.com', reason: 'unsubscribed' }] });
    const res = await sendConversationEmail(ENV, { conversation, participant, body: 'hello there', inReplyToMessageId: 'msg-9@mail' });
    expect(res).toMatchObject({ ok: true, skipped: false, resendId: 're_abc123' });
    expect(cap.resendCalled).toBe(true);
    // Reply-to carries the token; threading headers set.
    expect(cap.resend.reply_to).toBe('reply+tok_deadbeef@utahpros.app');
    expect(cap.resend.headers['In-Reply-To']).toBe('<msg-9@mail>');
    expect(cap.resend.headers['References']).toBe('<msg-9@mail>');
  });

  it('sends when there is no suppression at all', async () => {
    const cap = stubFetch({ suppressionRows: [] });
    const res = await sendConversationEmail(ENV, { conversation, participant, subject: 'Custom', body: 'hi' });
    expect(res.ok).toBe(true);
    expect(cap.resend.subject).toBe('Custom');
  });

  it('FAILS CLOSED when the suppression lookup errors', async () => {
    const cap = stubFetch({ suppressionThrows: true });
    const res = await sendConversationEmail(ENV, { conversation, participant, body: 'hi' });
    expect(res).toMatchObject({ ok: false, skipped: true, reason: 'suppression_check_error' });
    expect(cap.resendCalled).toBe(false);
  });
});
