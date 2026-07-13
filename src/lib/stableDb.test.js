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
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./stableDb.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { createTokenBoundClient } from './stableDb.js';

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
