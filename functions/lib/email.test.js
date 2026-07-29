/**
 * ════════════════════════════════════════════════
 * FILE: email.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the one email-sending helper against regressions as the omnichannel inbox
 *   adds email threading. Proves two things at once: (1) an ordinary transactional
 *   send is byte-for-byte unchanged — no stray `headers` on the Resend payload, the
 *   same From/Reply-To defaults, attachments intact; and (2) when a caller DOES pass
 *   In-Reply-To/References headers (the new threaded-reply path), they flow through to
 *   Resend untouched. Network is stubbed — no real email is sent.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/email.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendEmail } from './email.js';

function fakeResponse(obj, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(obj);
  return { ok, status, text: async () => text, json: async () => obj };
}

function stubResend() {
  const capture = { payload: null, requestHeaders: null };
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    capture.payload = JSON.parse(init.body);
    capture.requestHeaders = init.headers;
    return fakeResponse({ id: 're_1' });
  }));
  return capture;
}

afterEach(() => vi.unstubAllGlobals());

const ENV = { RESEND_API_KEY: 'k' };

describe('sendEmail — backward compatibility (existing transactional sends unchanged)', () => {
  it('an ordinary send carries NO headers key and the standard defaults', async () => {
    const cap = stubResend();
    const res = await sendEmail(ENV, { to: 'a@b.com', subject: 'Hi', html: '<p>x</p>' });
    expect(res.ok).toBe(true);
    expect(cap.payload).not.toHaveProperty('headers');       // additive: absent unless asked for
    expect(cap.payload.from).toContain('restoration@utahpros.app');
    expect(cap.payload.reply_to).toBe('restoration@utahpros.app');
    expect(cap.payload.to).toEqual(['a@b.com']);
    expect(cap.payload.html).toBe('<p>x</p>');
    expect(cap.requestHeaders).not.toHaveProperty('Idempotency-Key');
  });

  it('attachments still pass through in the same shape', async () => {
    const cap = stubResend();
    await sendEmail(ENV, {
      to: 'a@b.com', subject: 'Doc',
      attachments: [{ filename: 'f.pdf', content: 'BASE64', contentType: 'application/pdf' }],
    });
    expect(cap.payload.attachments).toEqual([
      { filename: 'f.pdf', content: 'BASE64', content_type: 'application/pdf' },
    ]);
  });
});

describe('sendEmail — provider idempotency', () => {
  it('puts a stable caller key on the Resend HTTP request, not the email body', async () => {
    const cap = stubResend();
    await sendEmail(ENV, {
      to: 'a@b.com',
      subject: 'Test',
      text: 'Once',
      idempotencyKey: 'owner-notification-test/email/request-1',
    });

    expect(cap.requestHeaders['Idempotency-Key'])
      .toBe('owner-notification-test/email/request-1');
    expect(cap.payload).not.toHaveProperty('idempotencyKey');
  });

  it.each(['', 'x'.repeat(257), 42])('rejects invalid keys before provider contact', async (key) => {
    const cap = stubResend();
    const result = await sendEmail(ENV, {
      to: 'a@b.com',
      subject: 'Test',
      text: 'Once',
      idempotencyKey: key,
    });

    expect(result).toMatchObject({ ok: false, error: 'Invalid idempotency key' });
    expect(cap.payload).toBeNull();
  });
});

describe('sendEmail — In-Reply-To/References passthrough (threaded replies)', () => {
  it('forwards threading headers to Resend untouched', async () => {
    const cap = stubResend();
    await sendEmail(ENV, {
      to: 'a@b.com', subject: 'Re: x', text: 'reply',
      headers: { 'In-Reply-To': '<m1@mail>', 'References': '<m0@mail> <m1@mail>' },
    });
    expect(cap.payload.headers).toEqual({
      'In-Reply-To': '<m1@mail>',
      'References': '<m0@mail> <m1@mail>',
    });
  });

  it('an empty headers object is not attached', async () => {
    const cap = stubResend();
    await sendEmail(ENV, { to: 'a@b.com', subject: 'x', text: 'y', headers: {} });
    expect(cap.payload).not.toHaveProperty('headers');
  });
});
