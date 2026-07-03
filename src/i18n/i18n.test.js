import { describe, it, expect, afterEach } from 'vitest';
import i18n, { resources, NAMESPACES } from './index.js';

// The engine boots in English (readStoredLang() → 'en' with no localStorage in the
// node test env). Each test that switches language restores 'en' afterwards.
afterEach(async () => { await i18n.changeLanguage('en'); });

describe('i18n engine', () => {
  it('returns the English source by default', () => {
    expect(i18n.t('nav:dash')).toBe('Dash');
  });

  it('translates a known nav label in each language', async () => {
    await i18n.changeLanguage('pt');
    expect(i18n.t('nav:dash')).toBe('Painel');
    await i18n.changeLanguage('es');
    expect(i18n.t('nav:dash')).toBe('Panel');
    await i18n.changeLanguage('en');
    expect(i18n.t('nav:dash')).toBe('Dash');
  });

  it('interpolates variables', () => {
    expect(i18n.t('settings:appearance.current', { look: 'light' }))
      .toBe('Currently showing the light look.');
  });

  it('falls back to English when a key is missing in the active language', async () => {
    // Probe key exists only in English → pt must render the English source, not blank.
    i18n.addResource('en', 'common', '__fallbackProbe', 'Fallback works');
    await i18n.changeLanguage('pt');
    expect(i18n.t('common:__fallbackProbe')).toBe('Fallback works');
  });
});

// Full parity: each translation batch ships en + pt + es together, so every key in
// the English source must exist in both other locales (a missing/extra key fails here).
describe('locale parity', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

  for (const ns of NAMESPACES) {
    const enKeys = flatten(resources.en[ns]).sort();
    it(`pt "${ns}" has exactly the English keys`, () => {
      expect(flatten(resources.pt[ns]).sort()).toEqual(enKeys);
    });
    it(`es "${ns}" has exactly the English keys`, () => {
      expect(flatten(resources.es[ns]).sort()).toEqual(enKeys);
    });
  }
});
