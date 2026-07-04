/**
 * ════════════════════════════════════════════════
 * FILE: resend-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tests the Resend bounce/complaint webhook. Proves a correctly-signed call is
 *   accepted and parsed, a tampered body / stale timestamp / missing headers are all
 *   rejected, the endpoint refuses everything when the signing secret is unset (fails
 *   closed), and a permanent-bounce event actually records a hard-bounce suppression
 *   while a transient bounce is ignored. Uses real Web Crypto to forge a valid
 *   signature; network (RPC/insert) is stubbed.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest (+ global crypto.subtle / atob / btoa in Node 18+)
 *   Internal:  functions/api/resend-webhook.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifySvixSignature, onRequestPost } from './resend-webhook.js';

const SECRET = 'whsec_' + btoa('omni-inbox-test-signing-key');

// Mirror the worker's signing so tests can forge a valid v1 token.
async function signSvix(secret, id, ts, body) {
  const keyBytes = Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  let bin = '';
  for (const x of new Uint8Array(sig)) bin += String.fromCharCode(x);
  return 'v1,' + btoa(bin);
}

const nowTs = () => String(Math.floor(Date.now() / 1000));

function fakeRequest(body, headers) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { text: async () => body, headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) } };
}

afterEach(() => vi.unstubAllGlobals());

describe('verifySvixSignature', () => {
  it('accepts a correctly-signed payload and returns the parsed event', async () => {
    const id = 'msg_1', ts = nowTs(), body = JSON.stringify({ type: 'email.complained' });
    const signature = await signSvix(SECRET, id, ts, body);
    const event = await verifySvixSignature(body, { id, timestamp: ts, signature }, SECRET);
    expect(event.type).toBe('email.complained');
  });

  it('rejects a tampered body', async () => {
    const id = 'msg_2', ts = nowTs(), body = '{"a":1}';
    const signature = await signSvix(SECRET, id, ts, body);
    await expect(verifySvixSignature('{"a":2}', { id, timestamp: ts, signature }, SECRET)).rejects.toThrow();
  });

  it('rejects a stale timestamp (replay guard)', async () => {
    const id = 'msg_3', ts = String(Math.floor(Date.now() / 1000) - 999), body = '{}';
    const signature = await signSvix(SECRET, id, ts, body);
    await expect(verifySvixSignature(body, { id, timestamp: ts, signature }, SECRET)).rejects.toThrow(/tolerance/i);
  });

  it('rejects missing headers and a missing secret', async () => {
    await expect(verifySvixSignature('{}', { id: '', timestamp: '', signature: '' }, SECRET)).rejects.toThrow();
    await expect(verifySvixSignature('{}', { id: 'a', timestamp: nowTs(), signature: 'v1,x' }, '')).rejects.toThrow();
  });
});

describe('onRequestPost', () => {
  it('fails closed (503) when the secret is unset', async () => {
    const res = await onRequestPost({ request: fakeRequest('{}', {}), env: {} });
    expect(res.status).toBe(503);
  });

  it('rejects a bad signature (400)', async () => {
    const req = fakeRequest('{}', { 'svix-id': 'x', 'svix-timestamp': nowTs(), 'svix-signature': 'v1,bad' });
    const res = await onRequestPost({ request: req, env: { RESEND_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'https://p.supabase.co' } });
    expect(res.status).toBe(400);
  });

  it('records a hard_bounce suppression on a Permanent bounce', async () => {
    const rpcCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : null;
      if (u.includes('/rpc/claim_inbound_email')) return { ok: true, status: 200, json: async () => true };
      if (u.includes('/rpc/record_email_suppression')) { rpcCalls.push(body); return { ok: true, status: 200, json: async () => ({ id: 's1' }) }; }
      if (u.includes('/worker_runs')) return { ok: true, status: 201, json: async () => [] };
      throw new Error('unexpected ' + u);
    }));

    const id = 'msg_b', ts = nowTs();
    const body = JSON.stringify({ type: 'email.bounced', data: { to: ['dead@x.com'], bounce: { type: 'Permanent' } } });
    const signature = await signSvix(SECRET, id, ts, body);
    const req = fakeRequest(body, { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature });

    const res = await onRequestPost({ request: req, env: { RESEND_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'https://p.supabase.co' } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, suppressed: true, reason: 'hard_bounce', email: 'dead@x.com' });
    expect(rpcCalls).toEqual([{ p_email: 'dead@x.com', p_reason: 'hard_bounce', p_source: 'resend_bounce' }]);
  });

  it('ignores a Transient bounce (no suppression)', async () => {
    const rpcCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = String(url);
      if (u.includes('/rpc/claim_inbound_email')) return { ok: true, status: 200, json: async () => true };
      if (u.includes('/rpc/record_email_suppression')) { rpcCalls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) }; }
      if (u.includes('/worker_runs')) return { ok: true, status: 201, json: async () => [] };
      throw new Error('unexpected ' + u);
    }));

    const id = 'msg_t', ts = nowTs();
    const body = JSON.stringify({ type: 'email.bounced', data: { to: ['x@x.com'], bounce: { type: 'Transient' } } });
    const signature = await signSvix(SECRET, id, ts, body);
    const req = fakeRequest(body, { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature });

    const res = await onRequestPost({ request: req, env: { RESEND_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'https://p.supabase.co' } });
    const json = await res.json();
    expect(json.suppressed).toBe(false);
    expect(rpcCalls).toEqual([]);   // no suppression written
  });

  it('no-ops a duplicate delivery (dedup on svix-id)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/rpc/claim_inbound_email')) return { ok: true, status: 200, json: async () => false }; // already seen
      throw new Error('should not process a duplicate: ' + u);
    }));

    const id = 'msg_dup', ts = nowTs();
    const body = JSON.stringify({ type: 'email.complained', data: { to: ['x@x.com'] } });
    const signature = await signSvix(SECRET, id, ts, body);
    const req = fakeRequest(body, { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': signature });

    const res = await onRequestPost({ request: req, env: { RESEND_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'https://p.supabase.co' } });
    const json = await res.json();
    expect(json).toMatchObject({ duplicate: true });
  });
});
