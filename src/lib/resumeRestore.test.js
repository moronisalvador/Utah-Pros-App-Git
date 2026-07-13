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
import { pickRestoreUrl, shouldSaveRoute, RESUME_TTL_MS } from './resumeRestore.js';

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
  });

  it('rejects malformed saved values', () => {
    expect(pickRestoreUrl('/tech', { url: 'javascript:alert(1)', ts: NOW }, NOW)).toBe(null);
    expect(pickRestoreUrl('/tech', { url: 'https://evil.example/x', ts: NOW }, NOW)).toBe(null);
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
  });
  it('rejects junk', () => {
    expect(shouldSaveRoute('')).toBe(false);
    expect(shouldSaveRoute(null)).toBe(false);
    expect(shouldSaveRoute('not-a-path')).toBe(false);
  });
});
