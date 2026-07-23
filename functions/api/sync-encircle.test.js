/**
 * ════════════════════════════════════════════════
 * FILE: sync-encircle.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Encircle bulk-sync endpoint now requires the active owner
 *   for BOTH the browser-test GET and the POST that triggers the sync. No
 *   Bearer token fails before network access; the valid owner proceeds
 *   (here it finds zero claims and returns cleanly).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./sync-encircle.js (system under test). Global fetch is stubbed
 *              so no real Encircle / Supabase network calls happen.
 *
 * NOTES / GOTCHAS:
 *   - requireRole short-circuits before touching fetch when the Bearer token is
 *     absent, so the "no token" cases assert the sync body is never reached.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost, onRequestGet } from './sync-encircle.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  ENCIRCLE_API_KEY: 'enc-test-key',
};

function makeRequest(method, { auth } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://app.test/api/sync-encircle', { method, headers });
}

// Stub global fetch: /auth/v1/user reflects authOk, the employee lookup returns
// an active admin, and Encircle returns zero claims so no write is attempted.
function stubFetch({ authOk = true, role = 'admin', owner = true } = {}) {
  const impl = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return new Response(
        authOk ? JSON.stringify({ id: 'user-1' }) : '{}',
        { status: authOk ? 200 : 401 },
      );
    }
    if (u.includes('/rest/v1/employees?')) {
      return new Response(JSON.stringify([{
        id: 'employee-1',
        role,
        is_active: true,
        email: role === 'admin' && owner
          ? 'moroni@utah-pros.com'
          : 'employee@utah-pros.com',
      }]), { status: 200 });
    }
    if (u.includes('/rest/v1/integration_credentials?')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (u.includes('encircleapp.com')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${u}`);
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

afterEach(() => vi.unstubAllGlobals());

describe('sync-encircle POST — owner-only gate', () => {
  it('401s without a Bearer token and never starts the sync', async () => {
    const f = stubFetch();
    const res = await onRequestPost({ request: makeRequest('POST'), env: ENV });
    expect(res.status).toBe(401);
    // No token → requireRole returns before calling fetch at all.
    expect(f).not.toHaveBeenCalled();
  });

  it('401s when the token is invalid/expired', async () => {
    stubFetch({ authOk: false });
    const res = await onRequestPost({
      request: makeRequest('POST', { auth: 'Bearer bad-token' }), env: ENV,
    });
    expect(res.status).toBe(401);
  });

  it('proceeds past the gate with a valid token', async () => {
    stubFetch({ authOk: true });
    const res = await onRequestPost({
      request: makeRequest('POST', { auth: 'Bearer good-token' }), env: ENV,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(0);
  });

  it('403s an active non-admin before the sync starts', async () => {
    const f = stubFetch({ role: 'field_tech' });
    const res = await onRequestPost({
      request: makeRequest('POST', { auth: 'Bearer good-token' }), env: ENV,
    });
    expect(res.status).toBe(403);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('403s an active non-owner admin before the sync starts', async () => {
    const f = stubFetch({ role: 'admin', owner: false });
    const res = await onRequestPost({
      request: makeRequest('POST', { auth: 'Bearer good-token' }), env: ENV,
    });
    expect(res.status).toBe(403);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('sync-encircle GET — owner-only gate', () => {
  it('401s without a Bearer token', async () => {
    stubFetch();
    const res = await onRequestGet({ request: makeRequest('GET'), env: ENV });
    expect(res.status).toBe(401);
  });

  it('proceeds past the gate with a valid token', async () => {
    stubFetch({ authOk: true });
    const res = await onRequestGet({
      request: makeRequest('GET', { auth: 'Bearer good-token' }), env: ENV,
    });
    expect(res.status).toBe(200);
  });

  it('403s an active non-owner admin', async () => {
    const f = stubFetch({ role: 'admin', owner: false });
    const res = await onRequestGet({
      request: makeRequest('GET', { auth: 'Bearer good-token' }), env: ENV,
    });
    expect(res.status).toBe(403);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
