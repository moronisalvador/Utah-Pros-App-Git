/**
 * Render smoke-test for the translated Settings cards. Uses renderToStaticMarkup
 * (no jsdom needed — vitest runs in plain node here) to prove the REAL components
 * emit translated text in each language and that switching flips them. Guards the
 * pilot end-to-end: engine + provider + component wiring, not just t() in isolation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import AppearanceSection from '@/components/tech/settings/AppearanceSection';
import LanguageSection from '@/components/tech/settings/LanguageSection';

afterEach(() => { i18n.changeLanguage('en'); });

function renderCards(lang) {
  i18n.changeLanguage(lang); // useTranslation reads i18n.language at render time
  return renderToStaticMarkup(
    <ThemeProvider>
      <LanguageProvider>
        <AppearanceSection />
        <LanguageSection />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe('Settings cards render translated', () => {
  it('English', () => {
    const out = renderCards('en');
    expect(out).toContain('Appearance');
    expect(out).toContain('Language');
    expect(out).toContain('Currently showing the light look.');
  });

  it('Portuguese', () => {
    const out = renderCards('pt');
    expect(out).toContain('Aparência');
    expect(out).toContain('Idioma');
    expect(out).toContain('Mostrando a aparência clara no momento.');
  });

  it('Spanish', () => {
    const out = renderCards('es');
    expect(out).toContain('Apariencia');
    expect(out).toContain('Idioma');
    expect(out).toContain('Mostrando la apariencia clara en este momento.');
  });

  it('always shows the language endonyms regardless of active language', () => {
    for (const lang of ['en', 'pt', 'es']) {
      const out = renderCards(lang);
      expect(out).toContain('English');
      expect(out).toContain('Português');
      expect(out).toContain('Español');
    }
  });
});
