/**
 * ════════════════════════════════════════════════
 * FILE: AppearanceSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Appearance" block on the tech Settings screen. It lets a technician
 *   pick how the app looks: follow the phone's setting ("System"), always Light,
 *   or always Dark. The choice is saved on this phone and applies right away.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/settings
 *   Rendered by:  src/pages/tech/TechSettings.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-i18next
 *   Internal:  @/contexts/ThemeContext (useTheme)
 *   Data:      none (theme lives in localStorage via ThemeContext)
 *
 * NOTES / GOTCHAS:
 *   - Dark mode currently repaints the tech shell; a few detail screens still
 *     have light-colored spots that a later polish pass converts to tokens.
 * ════════════════════════════════════════════════
 */
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';

export default function AppearanceSection() {
  const { t } = useTranslation('settings');
  const { mode, effective, setMode } = useTheme();

  const options = [
    { key: 'system', label: t('appearance.optSystem'), sub: t('appearance.optSystemSub') },
    { key: 'light', label: t('appearance.optLight'), sub: null },
    { key: 'dark', label: t('appearance.optDark'), sub: null },
  ];
  // The sentence agrees with the noun "look/aparência/apariencia", so the word is
  // its own key (feminine in pt/es) rather than reusing the button label.
  const lookWord = effective === 'dark' ? t('appearance.lookDark') : t('appearance.lookLight');

  return (
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">{t('appearance.title')}</div>
        <div className="tech-settings-card-sub">
          {t('appearance.current', { look: lookWord })}
        </div>
      </div>

      <div className="tech-settings-seg" role="radiogroup" aria-label={t('appearance.title')}>
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={mode === opt.key}
            className="tech-settings-seg-btn"
            data-active={mode === opt.key ? 'true' : 'false'}
            onClick={() => setMode(opt.key)}
          >
            <span className="tech-settings-seg-label">{opt.label}</span>
            {opt.sub && <span className="tech-settings-seg-sub">{opt.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
