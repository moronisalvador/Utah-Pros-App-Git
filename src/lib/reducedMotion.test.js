/**
 * MOTION-02 — the JS half of honouring Reduce Motion.
 *
 * The CSS half is a global block in index.css. It cannot cover programmatic
 * scrolling: `scrollIntoView({ behavior: 'smooth' })` states its behaviour
 * explicitly, and per spec an explicit argument beats the CSS scroll-behavior
 * property. So every JS scroll has to ask, and this is what it asks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from './reducedMotion';

const withMatchMedia = (impl) => vi.stubGlobal('window', { matchMedia: impl });

afterEach(() => vi.unstubAllGlobals());

describe('prefersReducedMotion', () => {
  it('is true when the person asked for reduced motion', () => {
    withMatchMedia((q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false when they did not', () => {
    withMatchMedia(() => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it('queries the exact media feature', () => {
    const spy = vi.fn(() => ({ matches: false }));
    withMatchMedia(spy);
    prefersReducedMotion();
    expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('reads live rather than caching', () => {
    // Someone can flip the setting while the app is suspended and resume onto a
    // screen that is about to animate. A value captured at boot would be stale
    // exactly when it matters most.
    let on = false;
    withMatchMedia(() => ({ matches: on }));
    expect(prefersReducedMotion()).toBe(false);
    on = true;
    expect(prefersReducedMotion()).toBe(true);
  });

  it('says motion is fine when matchMedia is unavailable', () => {
    // Old WebViews, SSR, a node test env. Matching the platform default keeps
    // existing behaviour instead of silently flattening motion everywhere.
    vi.stubGlobal('window', {});
    expect(prefersReducedMotion()).toBe(false);
  });

  it('does not throw when matchMedia itself throws', () => {
    withMatchMedia(() => { throw new Error('bad query'); });
    expect(() => prefersReducedMotion()).not.toThrow();
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('scrollBehavior', () => {
  it('collapses to auto under Reduce Motion', () => {
    withMatchMedia(() => ({ matches: true }));
    expect(scrollBehavior('smooth')).toBe('auto');
  });

  it('keeps the requested behaviour otherwise', () => {
    withMatchMedia(() => ({ matches: false }));
    expect(scrollBehavior('smooth')).toBe('smooth');
  });

  it('defaults to smooth', () => {
    withMatchMedia(() => ({ matches: false }));
    expect(scrollBehavior()).toBe('smooth');
  });

  it('still scrolls — it only removes the travel, never the destination', () => {
    // 'auto' jumps to the target. Returning something falsy, or skipping the
    // scroll, would lose the information the scroll exists to convey — which is
    // the "no motion-dependent information loss" half of MOTION-02's acceptance.
    withMatchMedia(() => ({ matches: true }));
    expect(scrollBehavior('smooth')).toBe('auto');
    expect(scrollBehavior('smooth')).not.toBe('none');
  });
});
