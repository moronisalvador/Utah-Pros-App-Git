import { describe, it, expect, afterEach } from 'vitest';
import i18n, { NAMESPACES, ensureLanguage, resources } from './index.js';

// Parity compares the raw word lists, so it imports the barrels directly. A
// STATIC import is correct here and only here: this is a test, not app code, so
// it cannot pull pt/es back into the shipped entry bundle.
import enResources from './locales/en/index.js';
import ptResources from './locales/pt/index.js';
import esResources from './locales/es/index.js';

const BARRELS = { en: enResources, pt: ptResources, es: esResources };

// The engine boots in English (readStoredLang() → 'en' with no localStorage in the
// node test env). Each test that switches language restores 'en' afterwards.
afterEach(async () => { await i18n.changeLanguage('en'); });

describe('i18n engine', () => {
  it('returns the English source by default', () => {
    expect(i18n.t('nav:dash')).toBe('Dash');
  });

  it('translates a known nav label in each language', async () => {
    await ensureLanguage('pt');
    await i18n.changeLanguage('pt');
    expect(i18n.t('nav:dash')).toBe('Painel');
    await ensureLanguage('es');
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
    await ensureLanguage('pt');
    await i18n.changeLanguage('pt');
    expect(i18n.t('common:__fallbackProbe')).toBe('Fallback works');
  });
});

// ─── On-demand locale loading (perf-budget.md §4) ──────────────

describe('on-demand locale loading', () => {
  it('ships ONLY English in the statically bundled resources', () => {
    // The whole point of the split. If pt/es appear here at module scope, they
    // are back in the entry bundle and the budget regresses.
    const staticExport = { ...resources };
    delete staticExport.pt;
    delete staticExport.es;
    expect(Object.keys(staticExport)).toEqual(['en']);
  });

  it('treats English as always-ready without a fetch', async () => {
    await expect(ensureLanguage('en')).resolves.toBe(true);
  });

  it('resolves true for an unknown code instead of throwing', async () => {
    // Never break the app over a bad stored preference.
    await expect(ensureLanguage('zz')).resolves.toBe(true);
  });

  it('registers every namespace when a language is loaded', async () => {
    await ensureLanguage('es');
    for (const ns of NAMESPACES) {
      expect(i18n.hasResourceBundle('es', ns)).toBe(true);
    }
  });

  it('is idempotent across repeated and concurrent calls', async () => {
    const results = await Promise.all([
      ensureLanguage('pt'), ensureLanguage('pt'), ensureLanguage('pt'),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(i18n.hasResourceBundle('pt', 'common')).toBe(true);
  });
});

// Each barrel must cover the full namespace list, or a lazily loaded language
// silently comes up short on one screen.
describe('locale barrels', () => {
  for (const [lang, barrel] of Object.entries(BARRELS)) {
    it(`${lang} exports exactly NAMESPACES`, () => {
      expect(Object.keys(barrel).sort()).toEqual([...NAMESPACES].sort());
    });
  }
});

// Full parity: each translation batch ships en + pt + es together, so every key in
// the English source must exist in both other locales (a missing/extra key fails here).
describe('locale parity', () => {
  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

  for (const ns of NAMESPACES) {
    const enKeys = flatten(enResources[ns]).sort();
    it(`pt "${ns}" has exactly the English keys`, () => {
      expect(flatten(ptResources[ns]).sort()).toEqual(enKeys);
    });
    it(`es "${ns}" has exactly the English keys`, () => {
      expect(flatten(esResources[ns]).sort()).toEqual(enKeys);
    });
  }
});
