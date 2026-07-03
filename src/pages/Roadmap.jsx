/**
 * ════════════════════════════════════════════════
 * FILE: Roadmap.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The in-app roadmap page reached from the side menu. It shows everything the
 *   team is currently working on — the mobile app, the desktop schedule
 *   improvements, the CRM, the settings overhaul, the security checks and a few
 *   other efforts — with a progress bar for each. Read-only: it is just a view
 *   of where things stand. The content comes from a plain file in the app, not
 *   from the database.
 *
 * WHERE IT LIVES:
 *   Route:        /roadmap
 *   Rendered by:  src/App.jsx, inside Layout (logged-in office app)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/lib/roadmapData (ROADMAP_INITIATIVES, ROADMAP_UPDATED),
 *              @/components/RoadmapView (shared with the public /roadmap/public page)
 *   Data:      reads  → none (content is hand-kept in @/lib/roadmapData)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The public, no-login mirror of this page is /roadmap/public. Both render
 *     the exact same RoadmapView from the same data, so they never drift.
 *   - Local light/dark toggle reuses the .crm-roadmap-page(.dark) token trick
 *     from CrmRoadmap.jsx; it is plain state (resets on reload).
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ROADMAP_INITIATIVES, ROADMAP_UPDATED } from '@/lib/roadmapData';
import RoadmapView from '@/components/RoadmapView';

export default function Roadmap() {
  const [dark, setDark] = useState(false);
  const pageClass = `crm-roadmap-page${dark ? ' dark' : ''}`;

  return (
    <div className={pageClass}>
      <div className="page">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div>
            <h1 className="page-title">Roadmap</h1>
            <p className="page-subtitle">
              Everything we're building right now and how far along each one is.
              Updated {ROADMAP_UPDATED}.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <Link
              to="/roadmap/public"
              target="_blank"
              rel="noopener noreferrer"
              className="crm-roadmap-theme-toggle"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              title="Open the public, no-login version (shareable)"
            >
              Public view ↗
            </Link>
            <button
              type="button"
              className="crm-roadmap-theme-toggle"
              onClick={() => setDark(d => !d)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>

        <RoadmapView initiatives={ROADMAP_INITIATIVES} />
      </div>
    </div>
  );
}
