/**
 * ════════════════════════════════════════════════
 * FILE: LanguageSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Language" block on the tech Settings screen. It lets a technician pick
 *   the language the app shows in — English, Portuguese, or Spanish — for this
 *   phone. The choice is saved on the device and the whole app switches right away.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/settings
 *   Rendered by:  src/pages/tech/TechSettings.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-i18next
 *   Internal:  @/contexts/LanguageContext (useLanguage, LANGS, LANG_LABELS)
 *   Data:      none (the language lives in localStorage via LanguageContext)
 *
 * NOTES / GOTCHAS:
 *   - Reuses the Appearance card's segmented-control classes verbatim
 *     (tech-settings-seg / -seg-btn) — no new CSS. Three languages fit the same
 *     three-button layout as System/Light/Dark.
 *   - Button labels are ENDONYMS (each language in its own name), so they read the
 *     same no matter which language is currently active — a Spanish speaker still
 *     recognizes "Português" and "English".
 * ════════════════════════════════════════════════
 */
import { useTranslation } from 'react-i18next';
import { useLanguage, LANGS, LANG_LABELS } from '@/contexts/LanguageContext';

export default function LanguageSection() {
  const { t } = useTranslation('settings');
  const { lang, setLang } = useLanguage();

  return (
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">{t('language.title')}</div>
        <div className="tech-settings-card-sub">{t('language.sub')}</div>
      </div>

      <div className="tech-settings-seg" role="radiogroup" aria-label={t('language.title')}>
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={lang === code}
            className="tech-settings-seg-btn"
            data-active={lang === code ? 'true' : 'false'}
            onClick={() => setLang(code)}
          >
            <span className="tech-settings-seg-label">{LANG_LABELS[code]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
