/**
 * ════════════════════════════════════════════════
 * FILE: SettingsLayout.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Settings" area shell. On big screens (≥1024px) it shows a grouped left
 *   rail listing every settings page you're allowed to see (Workspace, Team,
 *   Connections, Personal, Owner) next to the page you're viewing. On phones and
 *   iPads (<1024px) the rail is hidden: the /settings landing page is the tappable
 *   index, and each sub-page shows a "← Settings" link to get back — the classic
 *   home/back pattern.
 *
 * WHERE IT LIVES:
 *   Route:        wraps /settings + /settings/* and /dev-tools (pathless layout route)
 *   Rendered by:  src/App.jsx (inside the main Layout's <Outlet/>)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (NavLink, Link, Outlet, useLocation)
 *   Internal:  @/contexts/AuthContext (gating helpers), @/lib/owner (isMoroni),
 *              @/lib/navItems (SETTINGS_GROUPS, isSettingsItemVisible)
 *   Data:      reads → none directly · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Below 1024px the wrapper is `display:contents` and the rail is hidden, so
 *     the wrapped page renders as a direct child of .app-content. The desktop
 *     breakpoint is 1024px (NOT 1280 — that comment was historically stale).
 *   - The rail lists only pages the user may see (isSettingsItemVisible), matching
 *     the SettingsHome index groups exactly (both read SETTINGS_GROUPS).
 *   - The "← Settings" back link shows only on sub-pages (<1024px) — never on the
 *     /settings index itself.
 * ════════════════════════════════════════════════
 */
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isMoroni } from '@/lib/owner';
import { SETTINGS_GROUPS, isSettingsItemVisible } from '@/lib/navItems';

export default function SettingsLayout() {
  const { canAccess, employee } = useAuth();
  const location = useLocation();
  const ctx = { canAccess, employee, isMoroni: isMoroni(employee) };

  const groups = SETTINGS_GROUPS
    .map(g => ({ ...g, items: g.items.filter(it => isSettingsItemVisible(it, ctx)) }))
    .filter(g => g.items.length > 0);

  const onIndex = location.pathname === '/settings' || location.pathname === '/settings/';

  return (
    <div className="settings-hub">
      <nav className="settings-hub-rail">
        <NavLink to="/settings" end className={({ isActive }) => `settings-hub-home${isActive ? ' active' : ''}`}>
          Settings
        </NavLink>
        {groups.map(g => (
          <div key={g.group} className="settings-hub-group">
            <div className="settings-hub-group-label">{g.group}</div>
            {g.items.map(item => (
              <NavLink
                key={item.key}
                to={item.path}
                className={({ isActive }) => `settings-hub-link${isActive ? ' active' : ''}`}
              >
                <item.icon className="nav-icon" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-hub-content">
        {!onIndex && (
          <Link to="/settings" className="settings-hub-back">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Settings
          </Link>
        )}
        <Outlet />
      </div>
    </div>
  );
}
