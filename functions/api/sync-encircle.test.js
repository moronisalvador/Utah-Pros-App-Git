/**
 * ════════════════════════════════════════════════
 * FILE: sync-encircle.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Encircle bulk-sync endpoint now refuses to run for anyone who is
 *   not logged in — for BOTH the browser-test GET and the POST that actually
 *   triggers the sync. Before DB-Foundation P1 the POST was wide open: anyone
 *   who knew the URL could kick off a bulk import. These tests lock the gate:
 *   no Bearer token → 401 and the sync never starts; a valid token → the sync
 *   proceeds (here it finds zero claims and returns cleanly).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./sync-encircle.js (system under test). Global fetch is stubbed
 *              so no real Encircle / Supabase network calls happen.
 *
 * NOTES / GOTCHAS:
 *   - requireAuth short-circuits before touching fetch when the Bearer token is
 *     absent, so the "no token" cases assert the sync body is never reached.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost, onRequestGet } from './sync-encircle.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  ENCIRCLE_API_KEY: 'enc-test-key',
};

function makeRequest(method, { auth } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://app.test/api/sync-encircle', { method, headers });
}

// Stub global fetch: /auth/v1/user reflects authOk; the Encircle list returns
// an empty array so doSync returns early (200, synced:0) without any upsert.
function stubFetch({ authOk = true } = {}) {
  const impl = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return { ok: authOk, status: authOk ? 200 : 401 };
    }
    if (u.includes('encircleapp.com')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    throw new Error(`unexpected fetch to ${u}`);
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

afterEach(() => vi.unstubAllGlobals());

describe('sync-encircle POST — auth gate (DB-Foundation P1)', () => {
  it('401s without a Bearer token and never starts the sync', async () => {
    const f = stubFetch();
    const res = await onRequestPost({ request: makeRequest('POST'), env: ENV });
    expect(res.status).toBe(401);
    // No token → requireAuth returns before calling fetch at all.
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
});

describe('sync-encircle GET — auth gate (unchanged, regression guard)', () => {
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
});
