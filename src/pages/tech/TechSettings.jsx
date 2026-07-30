/**
 * ════════════════════════════════════════════════
 * FILE: TechSettings.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Settings screen for the field-tech app. It's a simple list of preference
 *   blocks the technician can use on their own phone: appearance, language,
 *   notifications, account deletion, and legal/support information. It reuses
 *   the same account-deletion request shown in desktop My Account settings.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/settings
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react-i18next, react-router-dom
 *   Internal:  @/components/tech/settings/AppearanceSection, LanguageSection,
 *              NotificationsSection, AppVersionSection,
 *              @/components/settings/AccountDeletionPanel
 *   Data:      account-deletion status/request via AccountDeletionPanel; other
 *              sections own their own data and device preferences
 *
 * NOTES / GOTCHAS:
 *   - Slot-host pattern: this page only lays out sections; each section is its
 *     own component so later work (notification prefs matrix, language) fills a
 *     slot rather than editing this shell.
 * ════════════════════════════════════════════════
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import AccountDeletionPanel from '@/components/settings/AccountDeletionPanel';
import AppearanceSection from '@/components/tech/settings/AppearanceSection';
import AppVersionSection from '@/components/tech/settings/AppVersionSection';
import LanguageSection from '@/components/tech/settings/LanguageSection';
import NotificationsSection from '@/components/tech/settings/NotificationsSection';

export default function TechSettings() {
  const { t } = useTranslation('settings');

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) var(--space-6)' }}>
        <div className="tech-page-header" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="tech-page-title">{t('title')}</div>
          <div className="tech-page-subtitle">{t('subtitle')}</div>
        </div>

        <div className="tech-settings-stack">
          <AppearanceSection />
          <LanguageSection />
          <NotificationsSection />
          <AccountDeletionPanel variant="tech" />
          <AppVersionSection />

          <section className="tech-settings-card" aria-labelledby="legal-support-title">
            <div className="tech-settings-card-head">
              <h2
                id="legal-support-title"
                className="tech-settings-card-title"
                style={{ margin: 0 }}
              >
                Legal and support
              </h2>
              <div className="tech-settings-card-sub">
                Read how the app handles data, review its terms, or get help.
              </div>
            </div>
            <nav
              className="tech-settings-row"
              aria-label="Legal and support"
              style={{ alignItems: 'stretch' }}
            >
              {/* /tech/legal/* — the SAME components as the office /privacy,
                  /terms and /support routes, rendered inside the field shell.
                  Never link the bare office paths from here: they render with no
                  nav, and the PWA/Capacitor container has no browser back button,
                  so a tech who tapped one had to force-quit to get back. */}
              {[
                ['/tech/legal/privacy', 'Privacy'],
                ['/tech/legal/terms', 'Terms'],
                ['/tech/legal/support', 'Support'],
              ].map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  className="tech-settings-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '1 1 30%',
                    textDecoration: 'none',
                  }}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      </div>
    </div>
  );
}
