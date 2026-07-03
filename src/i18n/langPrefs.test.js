import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveLang, readStoredLang, writeStoredLang,
  LANG_STORAGE_KEY, LANGS, DEFAULT_LANG,
} from './langPrefs.js';

describe('resolveLang', () => {
  it('accepts every supported language', () => {
    for (const l of LANGS) expect(resolveLang(l)).toBe(l);
  });

  it('falls back to English for anything unsupported', () => {
    expect(resolveLang('fr')).toBe('en');
    expect(resolveLang(undefined)).toBe('en');
    expect(resolveLang(null)).toBe('en');
    expect(resolveLang('')).toBe('en');
  });
});

describe('readStoredLang', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom absent in this env */ }
  });

  it('defaults to English when nothing is stored', () => {
    expect(readStoredLang()).toBe(DEFAULT_LANG);
    expect(DEFAULT_LANG).toBe('en');
  });

  it('returns a valid stored language and rejects garbage', () => {
    // localStorage may be undefined in the pure-node test env; guard so the
    // suite is meaningful where it exists and a no-op (still passing) where not.
    if (typeof localStorage === 'undefined') { expect(readStoredLang()).toBe('en'); return; }
    for (const l of LANGS) {
      localStorage.setItem(LANG_STORAGE_KEY, l);
      expect(readStoredLang()).toBe(l);
    }
    localStorage.setItem(LANG_STORAGE_KEY, 'klingon');
    expect(readStoredLang()).toBe('en');
  });

  it('round-trips through writeStoredLang and coerces garbage to the default', () => {
    if (typeof localStorage === 'undefined') return;
    writeStoredLang('pt');
    expect(readStoredLang()).toBe('pt');
    writeStoredLang('nonsense');
    expect(readStoredLang()).toBe('en');
  });
});
