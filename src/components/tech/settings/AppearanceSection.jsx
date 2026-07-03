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
 *   Packages:  react
 *   Internal:  @/contexts/ThemeContext (useTheme)
 *   Data:      none (theme lives in localStorage via ThemeContext)
 *
 * NOTES / GOTCHAS:
 *   - Dark mode currently repaints the tech shell; a few detail screens still
 *     have light-colored spots that a later polish pass converts to tokens.
 * ════════════════════════════════════════════════
 */
import { useTheme } from '@/contexts/ThemeContext';

const OPTIONS = [
  { key: 'system', label: 'System', sub: 'Match my phone' },
  { key: 'light', label: 'Light', sub: null },
  { key: 'dark', label: 'Dark', sub: null },
];

export default function AppearanceSection() {
  const { mode, effective, setMode } = useTheme();

  return (
    <div className="tech-settings-card">
      <div className="tech-settings-card-head">
        <div className="tech-settings-card-title">Appearance</div>
        <div className="tech-settings-card-sub">
          Currently showing the {effective} look.
        </div>
      </div>

      <div className="tech-settings-seg" role="radiogroup" aria-label="Theme">
        {OPTIONS.map((opt) => (
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
