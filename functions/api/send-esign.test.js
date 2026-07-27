/**
 * ════════════════════════════════════════════════
 * FILE: send-esign.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "text the signing link" path added on 2026-07-26. The important
 *   claims are that a text goes through the one approved send door rather than
 *   straight to a phone company, that a customer who has not agreed to texts
 *   never gets one, and that when a text is refused the signing link is still
 *   handed back so staff can send it another way instead of losing the request.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./send-esign.js (onRequestPost); auth/cors/email stubbed.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test; global fetch is faked, so no creds and no network. The env
 *     below uses the worker's anon-key fallback purely to keep fake credential
 *     names out of the repo — the code path under test is identical.
 *   - The consent gate itself lives in /api/send-message and is tested there.
 *     What this file proves is that send-esign ROUTES through it and honours a
 *     refusal — not that the gate works.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/auth.js', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'u-1' } })),
}));
vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => ({
    status,
    ok: status < 400,
    json: async () => body,
  }),
}));
const sendEmail = vi.fn(async () => ({ ok: true }));
vi.mock('../lib/email.js', () => ({ sendEmail: (...a) => sendEmail(...a) }));

const { onRequestPost } = await import('./send-esign.js');

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'test-only-not-a-credential',
  RESEND_API_KEY: 'test-only-not-a-credential',
  APP_URL: 'https://dev.utahpros.app',
};

const JOB = {
  id: 'job-1', job_number: 'J-1001', insured_name: 'Jane Homeowner',
  address: '123 Main', city: 'Provo', state: 'UT', division: 'water',
};

function req(body) {
  return {
    url: 'https://dev.utahpros.app/api/send-esign',
    headers: { get: (k) => (k === 'Authorization' ? 'Bearer jwt' : null) },
    json: async () => body,
  };
}

// Fakes the three upstreams send-esign talks to: PostgREST selects, PostgREST
// rpc, and the same-origin call to /api/send-message.
function installFetch({ sendMessage }) {
  const calls = { sendMessage: [], rpc: [] };
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('/rest/v1/jobs')) {
      return { ok: true, json: async () => [JOB] };
    }
    if (u.includes('/rpc/create_sign_request')) {
      calls.rpc.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 'sr-1', token: 'tok-abc' }) };
    }
    if (u.includes('/rpc/find_or_create_conversation')) {
      return { ok: true, json: async () => 'conv-1' };
    }
    if (u.includes('/api/send-message')) {
      calls.sendMessage.push({ body: JSON.parse(init.body), headers: init.headers });
      return sendMessage();
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  return calls;
}

const BASE = {
  job_id: 'job-1', contact_id: 'c-1', signer_name: 'Jane Homeowner',
  sent_by: 'e-1', doc_type: 'work_auth',
};

const accepted = () => ({ ok: true, status: 201, json: async () => ({ success: true }) });
const mustNotSend = () => { throw new Error('must not reach the send path'); };

beforeEach(() => { vi.clearAllMocks(); sendEmail.mockResolvedValue({ ok: true }); });

describe('send-esign — text delivery', () => {
  it('sends through /api/send-message, never straight to a provider', async () => {
    const calls = installFetch({ sendMessage: accepted });

    const res = await onRequestPost({ request: req({ ...BASE, mode: 'sms' }), env: ENV });
    const out = await res.json();

    expect(out.success).toBe(true);
    expect(out.mode).toBe('sms');
    expect(out.conversation_id).toBe('conv-1');
    expect(calls.sendMessage).toHaveLength(1);
    expect(calls.sendMessage[0].body.conversation_id).toBe('conv-1');
    // The caller's own token is forwarded — the chokepoint authorizes the human,
    // not the worker's service role.
    expect(calls.sendMessage[0].headers.Authorization).toBe('Bearer jwt');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends the bare link — company identity and STOP are the chokepoint\'s job', async () => {
    const calls = installFetch({ sendMessage: accepted });

    await onRequestPost({ request: req({ ...BASE, mode: 'sms' }), env: ENV });

    const body = calls.sendMessage[0].body.body;
    expect(body).toBe('Your Work Authorization is ready to sign: https://dev.utahpros.app/sign/tok-abc');
    // Doubling either of these is the failure mode worth guarding.
    expect(body).not.toMatch(/Utah Pros Restoration/);
    expect(body).not.toMatch(/Reply STOP/);
  });

  it('keeps the signing link usable when consent blocks the text', async () => {
    installFetch({
      sendMessage: () => ({
        ok: false, status: 403,
        json: async () => ({ error: 'blocked', code: 'NO_CONSENT' }),
      }),
    });

    const res = await onRequestPost({ request: req({ ...BASE, mode: 'sms' }), env: ENV });
    const out = await res.json();

    // The request exists and the link comes back — a refusal must not destroy work.
    expect(out.success).toBe(true);
    expect(out.sms_error).toBe(true);
    expect(out.sms_error_code).toBe('NO_CONSENT');
    expect(out.signing_url).toBe('https://dev.utahpros.app/sign/tok-abc');
    expect(out.message).toMatch(/has not consented/i);
  });

  it('refuses to text a job with no linked contact instead of guessing a number', async () => {
    installFetch({ sendMessage: mustNotSend });

    const res = await onRequestPost({
      request: req({ ...BASE, contact_id: null, mode: 'sms' }), env: ENV,
    });
    const out = await res.json();

    expect(res.status).toBe(400);
    expect(out.code).toBe('ESIGN_SMS_NO_CONTACT');
  });

  it('rejects an unknown mode rather than silently defaulting to a send', async () => {
    installFetch({ sendMessage: mustNotSend });

    const res = await onRequestPost({ request: req({ ...BASE, mode: 'carrier-pigeon' }), env: ENV });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('send-esign — email stays unchanged', () => {
  it('still requires a valid address for email mode', async () => {
    installFetch({ sendMessage: mustNotSend });

    const missing = await onRequestPost({ request: req({ ...BASE, mode: 'email' }), env: ENV });
    expect(missing.status).toBe(400);

    const bad = await onRequestPost({
      request: req({ ...BASE, mode: 'email', signer_email: 'nope' }), env: ENV,
    });
    expect(bad.status).toBe(400);
  });

  it('sends the email when given a valid address', async () => {
    installFetch({ sendMessage: mustNotSend });

    const res = await onRequestPost({
      request: req({ ...BASE, mode: 'email', signer_email: 'jane@example.com' }), env: ENV,
    });

    expect((await res.json()).success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('send-esign — the placeholder-email hack is no longer needed', () => {
  it('stores NULL rather than a fake address when not sending email', async () => {
    const calls = installFetch({ sendMessage: accepted });

    await onRequestPost({ request: req({ ...BASE, mode: 'collect' }), env: ENV });
    expect(calls.rpc[0].p_signer_email).toBeNull();

    await onRequestPost({ request: req({ ...BASE, mode: 'sms' }), env: ENV });
    expect(calls.rpc[1].p_signer_email).toBeNull();
  });

  // Browsers run cached JS, so the worker cannot assume clients have stopped
  // sending the placeholder.
  it('neutralizes a placeholder address sent by an out-of-date client', async () => {
    const calls = installFetch({ sendMessage: accepted });

    await onRequestPost({
      request: req({ ...BASE, mode: 'collect', signer_email: 'collect-1769470000000@noemail.local' }),
      env: ENV,
    });
    expect(calls.rpc[0].p_signer_email).toBeNull();
  });

  it('will not send an email to a placeholder address', async () => {
    installFetch({ sendMessage: mustNotSend });

    const res = await onRequestPost({
      request: req({ ...BASE, mode: 'email', signer_email: 'collect-123@noemail.local' }),
      env: ENV,
    });

    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('keeps a real address supplied alongside a text send', async () => {
    const calls = installFetch({ sendMessage: accepted });

    await onRequestPost({
      request: req({ ...BASE, mode: 'sms', signer_email: 'jane@example.com' }), env: ENV,
    });
    expect(calls.rpc[0].p_signer_email).toBe('jane@example.com');
  });
});
