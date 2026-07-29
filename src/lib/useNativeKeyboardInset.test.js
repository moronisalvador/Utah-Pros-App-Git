/**
 * KB-01 — the sticky-CTA offset helper.
 *
 * The four field forms anchor their Save button to the tab bar and the home
 * indicator. With a keyboard up BOTH are behind it, so keeping either offset
 * floats the button into the middle of the keyboard rather than onto it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

const { TECH_STICKY_CTA_BOTTOM, techStickyCtaBottom } = await import('./useNativeKeyboardInset.js');

describe('techStickyCtaBottom', () => {
  it('returns the resting offset unchanged with no keyboard', () => {
    expect(techStickyCtaBottom(0)).toBe(TECH_STICKY_CTA_BOTTOM);
  });

  it('returns the resting offset on web, where the inset is always 0', () => {
    // This is the PWA guarantee: the web build cannot produce a non-zero inset,
    // so the four forms render byte-identically to today.
    for (const webValue of [0, undefined, null, NaN]) {
      expect(techStickyCtaBottom(webValue)).toBe(TECH_STICKY_CTA_BOTTOM);
    }
  });

  it('sits on the keyboard, not above the tab bar, once one is open', () => {
    expect(techStickyCtaBottom(336)).toBe('348px');
    // Crucially it does NOT keep --tech-nav-height or the safe-area inset:
    // both sit behind the keyboard, and adding them would float the button.
    expect(techStickyCtaBottom(336)).not.toContain('tech-nav-height');
    expect(techStickyCtaBottom(336)).not.toContain('safe-area-inset');
  });

  it('keeps the same 12px breathing room in both states', () => {
    expect(TECH_STICKY_CTA_BOTTOM).toContain('12px');
    expect(techStickyCtaBottom(100)).toBe('112px');
  });

  it('ignores a negative inset rather than pulling the button off-screen', () => {
    expect(techStickyCtaBottom(-50)).toBe(TECH_STICKY_CTA_BOTTOM);
  });
});
