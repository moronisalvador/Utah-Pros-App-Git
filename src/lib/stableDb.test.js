/**
 * ════════════════════════════════════════════════
 * FILE: stableDb.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the token-bound database client keeps ONE stable identity while
 *   always using the newest access token. Screens watch the client object to
 *   know when to reload — if its identity changed on every hourly token
 *   renewal, pages would visibly reset. These tests pin both halves: the
 *   object never changes, and the token it sends always does.
 *
 *   The second half pins the session-recovery contract: when the database
 *   rejects the token, the client renews the session and repeats the request
 *   exactly once — and when the session is truly gone, the error comes back out
 *   so the app can tell the user, instead of failing silently forever.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./stableDb.js
 *
 * NOTES / GOTCHAS:
 *   - `./supabase.js` is mocked: these are pure contract tests, no network.
 *     The network-blocking setup file would fail a real fetch anyway.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the per-request worker so we can drive responses without a network.
// `handler` is swapped per test; every method routes through it.
const handler = { fn: null };
vi.mock('./supabase.js', () => {
  const make = (method) => (...args) => handler.fn(method, ...args);
  return {
    createSupabaseClient: (token) => ({
      select: make('select'), insert: make('insert'), update: make('update'),
      delete: make('delete'), rpc: make('rpc'),
      baseUrl: 'https://example.test', apiKey: token || 'anon-key',
    }),
    db: { baseUrl: 'https://example.test', apiKey: 'anon-key' },
  };
});

import { createTokenBoundClient } from './stableDb.js';

// Build the shape supabase.js throws: message string + additive status/body.
function httpError(status, label = 'RPC some_fn') {
  const e = new Error(`${label}: ${status} boom`);
  e.status = status;
  e.body = 'boom';
  return e;
}

describe('createTokenBoundClient — stable identity, live token', () => {
  it('keeps the same object identity across token changes', () => {
    const holder = { token: 'jwt-1' };
    const client = createTokenBoundClient(() => holder.token);
    const before = client;
    holder.token = 'jwt-2'; // simulate TOKEN_REFRESHED
    expect(client).toBe(before);
    expect(client.select).toBe(before.select);
    expect(client.rpc).toBe(before.rpc);
  });

  it('apiKey getter reflects the CURRENT token at read time', () => {
    const holder = { token: 'jwt-1' };
    const client = createTokenBoundClient(() => holder.token);
    expect(client.apiKey).toBe('jwt-1');
    holder.token = 'jwt-2';
    expect(client.apiKey).toBe('jwt-2');
  });

  it('exposes the full db client surface (CLAUDE.md DB Client API)', () => {
    const client = createTokenBoundClient(() => null);
    for (const method of ['select', 'insert', 'update', 'delete', 'rpc']) {
      expect(typeof client[method]).toBe('function');
    }
    expect('baseUrl' in client).toBe(true);
    expect('apiKey' in client).toBe(true);
  });
});

describe('createTokenBoundClient — 401 session recovery', () => {
  beforeEach(() => { handler.fn = null; });

  it('renews the session and retries ONCE when the DB rejects the token', async () => {
    let calls = 0;
    handler.fn = () => {
      calls += 1;
      if (calls === 1) throw httpError(401);
      return 'fresh-data';
    };
    const onAuthError = vi.fn(async () => true);
    const client = createTokenBoundClient(() => 'jwt-1', { onAuthError });

    await expect(client.rpc('get_unread_notification_count', {})).resolves.toBe('fresh-data');
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('surfaces the original error when recovery fails — no silent forever-retry', async () => {
    let calls = 0;
    handler.fn = () => { calls += 1; throw httpError(401); };
    const onAuthError = vi.fn(async () => false);
    const client = createTokenBoundClient(() => 'jwt-1', { onAuthError });

    await expect(client.select('employees', '')).rejects.toThrow(/401/);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1); // never retried after a failed recovery
  });

  it('retries at most once — a second 401 propagates instead of looping', async () => {
    let calls = 0;
    handler.fn = () => { calls += 1; throw httpError(401); };
    const onAuthError = vi.fn(async () => true);
    const client = createTokenBoundClient(() => 'jwt-1', { onAuthError });

    await expect(client.rpc('anything', {})).rejects.toThrow(/401/);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('never attempts recovery for 403/42501 — that is a real permission denial (DEV anon mode)', async () => {
    let calls = 0;
    handler.fn = () => { calls += 1; throw httpError(403, 'RPC get_dispatch_board'); };
    const onAuthError = vi.fn(async () => true);
    const client = createTokenBoundClient(() => 'jwt-1', { onAuthError });

    await expect(client.rpc('get_dispatch_board', {})).rejects.toThrow(/403/);
    expect(onAuthError).not.toHaveBeenCalled();
    expect(calls).toBe(1);
  });

  it('never attempts recovery for 500 or other non-auth failures', async () => {
    handler.fn = () => { throw httpError(500); };
    const onAuthError = vi.fn(async () => true);
    const client = createTokenBoundClient(() => 'jwt-1', { onAuthError });

    await expect(client.rpc('anything', {})).rejects.toThrow(/500/);
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('never attempts recovery on the anon path (no token = no session to renew)', async () => {
    handler.fn = () => { throw httpError(401); };
    const onAuthError = vi.fn(async () => true);
    const client = createTokenBoundClient(() => null, { onAuthError });

    await expect(client.select('feature_flags', '')).rejects.toThrow(/401/);
    expect(onAuthError).not.toHaveBeenCalled();
  });

  it('behaves exactly as before when no recovery handler is wired', async () => {
    handler.fn = () => { throw httpError(401); };
    const client = createTokenBoundClient(() => 'jwt-1'); // one-arg call still valid

    await expect(client.rpc('anything', {})).rejects.toThrow(/401/);
  });

  it('passes arguments through untouched on both the first try and the retry', async () => {
    const seen = [];
    let calls = 0;
    handler.fn = (method, ...args) => {
      calls += 1;
      seen.push([method, ...args]);
      if (calls === 1) throw httpError(401);
      return null;
    };
    const client = createTokenBoundClient(() => 'jwt-1', { onAuthError: async () => true });

    await client.update('invoices', 'id=eq.7', { total: 250 });
    expect(seen).toEqual([
      ['update', 'invoices', 'id=eq.7', { total: 250 }],
      ['update', 'invoices', 'id=eq.7', { total: 250 }],
    ]);
  });
});
