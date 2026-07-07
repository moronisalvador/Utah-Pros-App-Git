/**
 * ════════════════════════════════════════════════
 * FILE: SettingsHome.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Settings landing page — the "one place for everything" index. It shows
 *   the settings grouped into cards (Workspace, Team, Connections, Personal,
 *   Owner), only the ones you're allowed to see, with a search box to jump
 *   straight to a setting by name. On phones this IS the settings experience;
 *   you tap a card to open that page and use Back to return.
 *
 * WHERE IT LIVES:
 *   Route:        /settings  (index of the settings hub)
 *   Rendered by:  src/App.jsx (inside SettingsLayout)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (Link, Navigate, useLocation)
 *   Internal:  @/contexts/AuthContext (canAccess, employee), @/lib/owner
 *              (isMoroni), @/lib/navItems (SETTINGS_GROUPS, isSettingsItemVisible)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - ?gdrive= forwarder: the google-drive-callback worker still 302s to
 *     /settings?gdrive= until P4 retargets it. When that param is present we
 *     forward to /settings/my-account?gdrive=… (which toasts + strips it).
 *   - Visibility is any-visible-child (GC3): the route itself is guarded so the
 *     index only renders for users who can see at least one child.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isMoroni } from '@/lib/owner';
import { SETTINGS_GROUPS, isSettingsItemVisible } from '@/lib/navItems';
import { buildResetUrl } from '@/lib/staleChunkReload';

function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}
function IconChevronRight(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="9 18 15 12 9 6"/></svg>);}

export default function SettingsHome() {
  const { canAccess, employee } = useAuth();
  const location = useLocation();
  const [query, setQuery] = useState('');

  // ?gdrive= forwarder → /settings/my-account (permanent shim until P4 retargets
  // the google-drive-callback worker).
  const params = new URLSearchParams(location.search);
  if (params.has('gdrive')) {
    return <Navigate to={`/settings/my-account${location.search}`} replace />;
  }

  const ctx = { canAccess, employee, isMoroni: isMoroni(employee) };
  const q = query.trim().toLowerCase();

  const groups = SETTINGS_GROUPS
    .map(g => ({
      ...g,
      items: g.items.filter(it =>
        isSettingsItemVisible(it, ctx) &&
        (!q || it.label.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)),
      ),
    }))
    .filter(g => g.items.length > 0);

  return (
    <div className="settings-home">
      <div className="settings-home-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Everything you can manage, in one place.</p>
      </div>

      <div className="settings-home-search">
        <IconSearch className="settings-home-search-icon" style={{ width: 16, height: 16 }} />
        <input
          className="input"
          type="search"
          placeholder="Search settings…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search settings"
        />
      </div>

      {groups.length === 0 ? (
        <div className="settings-home-empty">No settings match “{query}”.</div>
      ) : (
        groups.map(g => (
          <section key={g.group} className="settings-home-group">
            <div className="settings-home-group-head">
              <h2 className="settings-home-group-title">{g.group}</h2>
              {g.description && <span className="settings-home-group-sub">{g.description}</span>}
            </div>
            <div className="settings-home-grid">
              {g.items.map(it => (
                <Link key={it.key} to={it.path} className="settings-home-card">
                  <span className="settings-home-card-icon"><it.icon /></span>
                  <span className="settings-home-card-body">
                    <span className="settings-home-card-label">{it.label}</span>
                    <span className="settings-home-card-desc">{it.description}</span>
                  </span>
                  <IconChevronRight className="settings-home-card-chevron" style={{ width: 16, height: 16 }} />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      {/* Trouble-loading recovery — reachable without an address bar (installed
          PWA). /reset is served with Clear-Site-Data:"cache", so it clears the
          cached app shell and reloads without logging you out. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
        marginTop: 'var(--space-6)', paddingTop: 'var(--space-5)',
        borderTop: '1px solid var(--border-light)',
      }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', flex: 1, minWidth: 180 }}>
          A page won’t load or looks out of date?
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => { window.location.href = buildResetUrl('/settings'); }}
        >
          Clear cache &amp; reload
        </button>
      </div>
    </div>
  );
}
