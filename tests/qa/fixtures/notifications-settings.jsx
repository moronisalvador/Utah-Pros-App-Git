/**
 * ════════════════════════════════════════════════
 * FILE: notifications-settings.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Mounts the real Notifications Settings component inside a credential-free
 *   browser fixture for 390px, error/loading, and resume verification.
 *
 * WHERE IT LIVES:
 *   Route:        local QA fixture only
 *   Rendered by:  tests/qa/fixtures/notifications-settings.html
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom
 *   Internal:  src/components/tech/settings/NotificationsSection.jsx
 *   Data:      reads  → synthetic modules supplied by the QA runner only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This entry is not reachable from the production router or build.
 *   - The runner blocks every non-local request.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/i18n';
import NotificationsSection from '@/components/tech/settings/NotificationsSection';
import '@/index.css';

export function NotificationsSettingsFixture() {
  return (
    <div className="tech-layout">
      <main className="tech-content">
        <div style={{ minHeight: '1400px', padding: 'var(--space-4)' }}>
          <label htmlFor="synthetic-draft">Synthetic draft</label>
          <input id="synthetic-draft" defaultValue="" />
          <div style={{ height: '560px' }} aria-hidden="true" />
          <NotificationsSection />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NotificationsSettingsFixture />
  </React.StrictMode>,
);
