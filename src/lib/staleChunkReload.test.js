/**
 * ════════════════════════════════════════════════
 * FILE: staleChunkReload.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the rule that decides whether to auto-reload the page after a
 *   JavaScript chunk fails to load (which happens after a deploy leaves an open
 *   tab pointing at files that no longer exist). The key property under test:
 *   it must reload AT MOST ONCE per cooldown window, so a chunk that keeps
 *   failing can't reload the page forever.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./staleChunkReload.js (shouldReloadForStaleChunk)
 *
 * NOTES / GOTCHAS:
 *   - Written test-first for the fix to the /crm infinite reload loop: the old
 *     guard cleared its flag on any successful chunk load, so a persistently
 *     missing chunk looped. This helper is time-based and successes never
 *     re-arm it.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { shouldReloadForStaleChunk, buildResetUrl } from './staleChunkReload.js';

describe('shouldReloadForStaleChunk', () => {
  it('reloads when it has never reloaded (last = 0)', () => {
    expect(shouldReloadForStaleChunk(100000, 0)).toBe(true);
  });

  it('does NOT reload again within the cooldown window', () => {
    // 5s after the last reload, default 20s window → still cooling down.
    expect(shouldReloadForStaleChunk(105000, 100000)).toBe(false);
  });

  it('reloads again once the cooldown window has fully elapsed', () => {
    // 20.001s later → past the window.
    expect(shouldReloadForStaleChunk(120001, 100000)).toBe(true);
  });

  it('treats exactly-at-the-window as still cooling down (strictly greater than)', () => {
    expect(shouldReloadForStaleChunk(120000, 100000)).toBe(false);
  });

  it('honors a custom window', () => {
    expect(shouldReloadForStaleChunk(105000, 100000, 3000)).toBe(true); // 5s > 3s window
    expect(shouldReloadForStaleChunk(102000, 100000, 3000)).toBe(false); // 2s < 3s window
  });
});

describe('buildResetUrl', () => {
  it('builds a /reset URL with the return path encoded', () => {
    expect(buildResetUrl('/crm/call-log')).toBe('/reset?to=%2Fcrm%2Fcall-log');
  });

  it('defaults to "/" when the path is empty/missing', () => {
    expect(buildResetUrl('')).toBe('/reset?to=%2F');
    expect(buildResetUrl(undefined)).toBe('/reset?to=%2F');
    expect(buildResetUrl(null)).toBe('/reset?to=%2F');
  });

  it('encodes query strings in the return path so they survive the round-trip', () => {
    expect(buildResetUrl('/a?b=c')).toBe('/reset?to=%2Fa%3Fb%3Dc');
  });
});
