/**
 * ════════════════════════════════════════════════
 * FILE: TechSettings.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Settings screen for the field-tech app. It's a simple list of preference
 *   blocks the technician can adjust on their own phone: how the app looks
 *   (light/dark) and whether they get push notifications. It's built as a
 *   container that holds separate blocks, so more preferences (like language)
 *   can be dropped in later without rewriting the page.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/settings
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./../../components/tech/settings/AppearanceSection,
 *              ./../../components/tech/settings/NotificationsSection
 *   Data:      none directly (each section owns its own data/prefs)
 *
 * NOTES / GOTCHAS:
 *   - Slot-host pattern: this page only lays out sections; each section is its
 *     own component so later work (notification prefs matrix, language) fills a
 *     slot rather than editing this shell.
 * ════════════════════════════════════════════════
 */
import AppearanceSection from '@/components/tech/settings/AppearanceSection';
import NotificationsSection from '@/components/tech/settings/NotificationsSection';

export default function TechSettings() {
  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        <div className="tech-page-header" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="tech-page-title">Settings</div>
          <div className="tech-page-subtitle">Preferences for this device</div>
        </div>

        <div className="tech-settings-stack">
          <AppearanceSection />
          <NotificationsSection />
          {/* Language section slot — added in a later phase. */}
        </div>
      </div>
    </div>
  );
}
