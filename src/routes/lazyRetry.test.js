/**
 * ════════════════════════════════════════════════
 * FILE: lazyRetry.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that moving lazy screen loading out of App keeps the existing
 *   stale-file recovery behavior unchanged. Success stays quiet, one eligible
 *   failure redirects through reset, and a repeat failure surfaces normally.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/routes/lazyRetry.js
 *   Data:      reads  → in-memory test storage only
 *              writes → in-memory test storage only
 *
 * NOTES / GOTCHAS:
 *   - The redirect case intentionally returns a promise that never settles;
 *     rendering is held until browser navigation replaces the document.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

import {
  CHUNK_RELOAD_KEY,
  lazyRetry,
  loadLazyModule,
} from './lazyRetry.js';

function runtime({ last = null, now = [100_000, 100_001], shouldReload = true } = {}) {
  const values = [...now];
  return {
    storage: {
      getItem: vi.fn(() => last),
      setItem: vi.fn(),
    },
    location: {
      pathname: '/tech/jobs/123',
      search: '?tab=photos',
      replace: vi.fn(),
    },
    now: vi.fn(() => values.shift()),
    shouldReload: vi.fn(() => shouldReload),
    resetUrl: vi.fn((path) => `/reset?to=${encodeURIComponent(path)}`),
  };
}

describe('loadLazyModule', () => {
  it('returns a successful module without touching stale-chunk state', async () => {
    const state = runtime();
    const module = { default: () => null };

    await expect(loadLazyModule(async () => module, state)).resolves.toBe(module);
    expect(state.storage.getItem).not.toHaveBeenCalled();
    expect(state.storage.setItem).not.toHaveBeenCalled();
    expect(state.location.replace).not.toHaveBeenCalled();
  });

  it('records the cooldown and redirects through reset after an eligible failure', async () => {
    const state = runtime();
    const failure = new Error('stale chunk');
    const result = loadLazyModule(async () => {
      throw failure;
    }, state);

    await Promise.resolve();
    await Promise.resolve();

    expect(state.shouldReload).toHaveBeenCalledWith(100_000, 0);
    expect(state.storage.setItem).toHaveBeenCalledWith(CHUNK_RELOAD_KEY, '100001');
    expect(state.resetUrl).toHaveBeenCalledWith('/tech/jobs/123?tab=photos');
    expect(state.location.replace).toHaveBeenCalledWith(
      '/reset?to=%2Ftech%2Fjobs%2F123%3Ftab%3Dphotos',
    );
    expect(result).toBeInstanceOf(Promise);
  });

  it('rethrows the original failure during the cooldown', async () => {
    const state = runtime({ last: '95000', shouldReload: false });
    const failure = new Error('still missing');

    await expect(loadLazyModule(async () => {
      throw failure;
    }, state)).rejects.toBe(failure);

    expect(state.shouldReload).toHaveBeenCalledWith(100_000, 95_000);
    expect(state.storage.setItem).not.toHaveBeenCalled();
    expect(state.location.replace).not.toHaveBeenCalled();
  });
});

describe('lazyRetry', () => {
  it('returns a React lazy component wrapper', () => {
    const component = lazyRetry(async () => ({ default: () => null }));
    expect(component).toEqual(expect.objectContaining({
      _payload: expect.any(Object),
      _init: expect.any(Function),
    }));
  });
});
