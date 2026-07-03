import { describe, it, expect, beforeEach } from 'vitest';
import { resolveEffectiveTheme, readStoredThemeMode, THEME_STORAGE_KEY, THEME_MODES } from './ThemeContext.jsx';

describe('resolveEffectiveTheme', () => {
  it('honors explicit light/dark regardless of the OS preference', () => {
    expect(resolveEffectiveTheme('light', true)).toBe('light');
    expect(resolveEffectiveTheme('light', false)).toBe('light');
    expect(resolveEffectiveTheme('dark', false)).toBe('dark');
    expect(resolveEffectiveTheme('dark', true)).toBe('dark');
  });

  it('follows the OS preference in system mode', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark');
    expect(resolveEffectiveTheme('system', false)).toBe('light');
  });

  it('treats unknown modes as system', () => {
    expect(resolveEffectiveTheme('purple', true)).toBe('dark');
    expect(resolveEffectiveTheme(undefined, false)).toBe('light');
  });
});

describe('readStoredThemeMode', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom absent in this env */ }
  });

  it('defaults to light when nothing is stored', () => {
    expect(readStoredThemeMode()).toBe('light');
  });

  it('returns a valid stored mode and rejects garbage', () => {
    // localStorage may be undefined in the pure-node test env; guard so the
    // suite is meaningful where it exists and a no-op (still passing) where not.
    if (typeof localStorage === 'undefined') { expect(readStoredThemeMode()).toBe('light'); return; }
    for (const m of THEME_MODES) {
      localStorage.setItem(THEME_STORAGE_KEY, m);
      expect(readStoredThemeMode()).toBe(m);
    }
    localStorage.setItem(THEME_STORAGE_KEY, 'not-a-mode');
    expect(readStoredThemeMode()).toBe('light');
  });
});
