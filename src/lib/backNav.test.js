/**
 * Field-polish 2026-07-29 — trapped-screens batch.
 *
 * canGoBack() keys on the `idx` counter React Router v7 stamps onto
 * window.history.state. idx > 0 = there is an in-app screen to pop back to;
 * idx 0 / absent = this is the first in-app entry (cold start, notification
 * deep link, pasted URL) and Back must use the caller's fallback route.
 *
 * The unit lane runs in a plain node environment, so `window` is stubbed the
 * same way nativeKeyboardLayout.test.js does.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { canGoBack, goBackOr } from './backNav.js';

const stubIdx = (idx) => vi.stubGlobal('window', { history: { state: idx == null ? null : { idx } } });

afterEach(() => vi.unstubAllGlobals());

describe('canGoBack', () => {
  it('is false on a first in-app entry (idx 0 or no router state)', () => {
    stubIdx(null);
    expect(canGoBack()).toBe(false);
    stubIdx(0);
    expect(canGoBack()).toBe(false);
  });

  it('is false when window is unavailable entirely', () => {
    expect(canGoBack()).toBe(false);
  });

  it('is true once an in-app entry exists behind this one', () => {
    stubIdx(1);
    expect(canGoBack()).toBe(true);
    stubIdx(7);
    expect(canGoBack()).toBe(true);
  });
});

describe('goBackOr', () => {
  it('pops history when an in-app entry exists', () => {
    stubIdx(2);
    const navigate = vi.fn();
    goBackOr(navigate, '/tech');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('replaces to the fallback when the screen was opened cold', () => {
    stubIdx(0);
    const navigate = vi.fn();
    goBackOr(navigate, '/tech/claims/abc');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/tech/claims/abc', { replace: true });
  });
});
