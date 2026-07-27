/**
 * ════════════════════════════════════════════════
 * FILE: resumeRestore.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the rules that send a tech back to the screen they were working on
 *   after iOS killed the home-screen app in the background. We want a relaunch
 *   at the front page to jump back mid-task, but never hijack a deliberate
 *   fresh open (stale route), a deep link, or an auth/public page.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./resumeRestore.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
  PWA_ACCOUNT_TRANSITION_KEY,
  RESUME_TTL_MS,
  ROUTE_KEY,
  beginPwaOwnerTransition,
  clearSavedRoute,
  pickRestoreUrl,
  readSavedRoute,
  routeStorageKey,
  saveRoute,
  shouldSaveRoute,
  writePwaOwnerLease,
} from './resumeRestore.js';

const NOW = 1_700_000_000_000;
const fresh = (url) => ({ url, ts: NOW - 60_000 });      // saved a minute ago
const stale = (url) => ({ url, ts: NOW - RESUME_TTL_MS - 1 });

describe('pickRestoreUrl — eviction-relaunch route recovery', () => {
  it('restores a fresh mid-task route when relaunched at the start_url', () => {
    expect(pickRestoreUrl('/tech', fresh('/tech/tools/demo-sheet?id=d1'), NOW)).toBe('/tech/tools/demo-sheet?id=d1');
    expect(pickRestoreUrl('/tech/', fresh('/tech/appointment/a1'), NOW)).toBe('/tech/appointment/a1');
  });

  it('does nothing when there is no saved route', () => {
    expect(pickRestoreUrl('/tech', null, NOW)).toBe(null);
  });

  it('ignores a stale route (fresh morning open starts home)', () => {
    expect(pickRestoreUrl('/tech', stale('/tech/tools/demo-sheet?id=d1'), NOW)).toBe(null);
  });

  it('never hijacks a launch that is NOT at the start_url (deep links, normal nav)', () => {
    expect(pickRestoreUrl('/tech/appointment/a2', fresh('/tech/tools/demo-sheet'), NOW)).toBe(null);
    expect(pickRestoreUrl('/conversations', fresh('/tech/tools/demo-sheet'), NOW)).toBe(null);
  });

  it('stays put when the saved route IS the start_url', () => {
    expect(pickRestoreUrl('/tech', fresh('/tech'), NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', fresh('/tech?x=1'), NOW)).toBe(null);
  });

  it('never restores into auth/public routes', () => {
    expect(pickRestoreUrl('/tech', fresh('/login'), NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', fresh('/set-password'), NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', fresh('/sign/tok123'), NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', fresh('/s/short-signing-code'), NOW))
      .toBe(null);
  });

  it('rejects malformed saved values', () => {
    expect(pickRestoreUrl('/tech', { url: 'javascript:alert(1)', ts: NOW }, NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', { url: 'https://evil.example/x', ts: NOW }, NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', { url: '//evil.example/x', ts: NOW }, NOW)).toBe(null); // protocol-relative
    expect(pickRestoreUrl('/tech', { ts: NOW }, NOW)).toBe(null);
  });

  it('restores desktop/admin routes too when launched standalone at /tech', () => {
    // An installed PWA can navigate to office pages; coming back mid-task there counts too.
    expect(pickRestoreUrl('/tech', fresh('/jobs/j1'), NOW)).toBe('/jobs/j1');
  });
});

describe('shouldSaveRoute — what counts as "where the tech is working"', () => {
  it('saves normal app routes', () => {
    expect(shouldSaveRoute('/tech/tools/demo-sheet')).toBe(true);
    expect(shouldSaveRoute('/tech/appointment/a1')).toBe(true);
    expect(shouldSaveRoute('/conversations')).toBe(true);
  });
  it('never saves auth/public routes', () => {
    expect(shouldSaveRoute('/login')).toBe(false);
    expect(shouldSaveRoute('/reset')).toBe(false);
    expect(shouldSaveRoute('/set-password')).toBe(false);
    expect(shouldSaveRoute('/sign/tok123')).toBe(false);
    expect(shouldSaveRoute('/s/short-signing-code')).toBe(false);
  });
  it('rejects junk', () => {
    expect(shouldSaveRoute('')).toBe(false);
    expect(shouldSaveRoute(null)).toBe(false);
    expect(shouldSaveRoute('not-a-path')).toBe(false);
  });
});

describe('saved route account ownership', () => {
  function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      values,
    };
  }

  const ownerA = {
    owner: 'v1.aaaaaaaaaaaa',
    epoch: 'e1.session-a',
  };
  const ownerB = {
    owner: 'v1.bbbbbbbbbbbb',
    epoch: 'e1.session-b',
  };

  it('rejects raw identities and malformed session epochs', () => {
    expect(routeStorageKey({
      owner: 'employee-123',
      epoch: 'e1.session-a',
    })).toBeNull();
    expect(routeStorageKey({
      owner: ownerA.owner,
      epoch: 'session-a',
    })).toBeNull();
  });

  function withLease(lease) {
    return storage({
      [PWA_ACCOUNT_OWNER_KEY]: lease.owner,
      [PWA_ACCOUNT_EPOCH_KEY]: lease.epoch,
    });
  }

  it('saves and restores only under the immutable verified tab lease', () => {
    const target = withLease(ownerA);
    expect(saveRoute('/tech/appointment/a1', ownerA, {
      storage: target,
      now: NOW,
    })).toBe(true);
    expect(readSavedRoute(ownerA, { storage: target })).toMatchObject({
      url: '/tech/appointment/a1',
      owner: ownerA.owner,
      epoch: ownerA.epoch,
      ts: NOW,
    });
  });

  it('uses separate storage keys for separate accounts and login epochs', () => {
    expect(routeStorageKey(ownerA)).not.toBe(routeStorageKey(ownerB));
    expect(routeStorageKey(ownerA)).toContain(encodeURIComponent(ownerA.owner));
    expect(routeStorageKey(ownerA)).toContain(encodeURIComponent(ownerA.epoch));
  });

  it('prevents a stale A tab from relabeling or overwriting B after a cross-tab switch', () => {
    const target = withLease(ownerA);
    saveRoute('/tech/appointment/a1', ownerA, {
      storage: target,
      now: NOW,
    });
    target.setItem(PWA_ACCOUNT_OWNER_KEY, ownerB.owner);
    target.setItem(PWA_ACCOUNT_EPOCH_KEY, ownerB.epoch);
    saveRoute('/tech/appointment/b1', ownerB, {
      storage: target,
      now: NOW + 1,
    });

    expect(saveRoute('/tech/appointment/a2', ownerA, {
      storage: target,
      now: NOW + 2,
    })).toBe(false);
    expect(readSavedRoute(ownerA, { storage: target })).toBe(null);
    expect(readSavedRoute(ownerB, { storage: target })).toMatchObject({
      url: '/tech/appointment/b1',
      owner: ownerB.owner,
    });
  });

  it('refuses legacy unowned route state and clears it explicitly', () => {
    const target = storage({
      [ROUTE_KEY]: JSON.stringify({ url: '/tech/appointment/a1', ts: NOW }),
    });
    writePwaOwnerLease(ownerA, target);
    expect(readSavedRoute(ownerA, { storage: target })).toBe(null);
    expect(clearSavedRoute(ownerA, { storage: target })).toBe(true);
    expect(target.getItem(ROUTE_KEY)).toBe(null);
  });

  it('blocks route writes immediately while an account transition is active', () => {
    const target = withLease(ownerA);
    beginPwaOwnerTransition('t1.switching', target);
    expect(target.getItem(PWA_ACCOUNT_TRANSITION_KEY)).toBe('t1.switching');
    expect(saveRoute('/tech/appointment/a1', ownerA, {
      storage: target,
      now: NOW,
    })).toBe(false);
  });
});
