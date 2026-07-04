/**
 * ════════════════════════════════════════════════
 * FILE: TopNav.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The horizontal navigation bar across the top of the desktop app (big screens
 *   only, ≥1280px). It shows the logo, the most-used destinations (Home, Inbox,
 *   Schedule, Claims, Customers, My Money, Time), a search box, a "New" button,
 *   the notifications bell, a help link, a settings gear, and the user avatar. A hamburger
 *   button on the left opens a drawer with the less-used pages. On phones and
 *   iPads this bar is hidden and the old side menu + bottom bar are used instead.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered on every office page, ≥1280px)
 *   Rendered by:  src/components/Layout.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom
 *   Internal:  @/contexts/AuthContext (canAccess/isFeatureEnabled/employee),
 *              @/lib/navItems (PRIMARY_ITEMS, isItemVisible, IconHelp), NotificationBell,
 *              NewMenu, UserMenu, GlobalSearch, @/components/Icons (IconSettings)
 *   Data:      reads → none directly (gating helpers come from AuthContext) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Primary links are filtered through isItemVisible() so the SAME role/flag
 *     gating as the legacy sidebar applies. Labels are renamed (Home/Inbox/My
 *     Money/Time) but paths/nav_keys are unchanged.
 *   - The Inbox unread badge reuses Layout's existing `unreadCount`.
 *   - `onMenuClick` opens the OverflowDrawer; `onAction` opens create modals
 *     (handled by Layout.handleCreateAction).
 *   - Visibility is CSS-only: `.topnav { display:none }` until the
 *     @media (min-width:1280px) block shows it, so this never paints on mobile/iPad.
 * ════════════════════════════════════════════════
 */
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import NewMenu from '@/components/NewMenu';
import UserMenu from '@/components/UserMenu';
import GlobalSearch from '@/components/GlobalSearch';
import { PRIMARY_ITEMS, isItemVisible, IconHelp } from '@/lib/navItems';
import { IconSettings } from '@/components/Icons';

function IconMenu(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export default function TopNav({ unreadCount = 0, onAction, onMenuClick, showBell = true }) {
  const { employee, canAccess, isFeatureEnabled } = useAuth();
  const isMoroni = employee?.email === 'moroni@utah-pros.com';
  const ctx = { canAccess, isFeatureEnabled, employee, isMoroni };

  return (
    <header className="topnav">
      <button className="topnav-menu-btn" onClick={onMenuClick} aria-label="More menu" title="More">
        <IconMenu style={{ width: 20, height: 20 }} />
      </button>

      <NavLink to="/" end className="topnav-logo-link" aria-label="Home">
        <span className="topnav-logo">U</span>
      </NavLink>

      <nav className="topnav-primary">
        {PRIMARY_ITEMS.filter(item => isItemVisible(item, ctx)).map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            end={item.end}
            className={({ isActive }) => `topnav-link${isActive ? ' active' : ''}`}
          >
            {item.label}
            {item.badge && unreadCount > 0 && (
              <span className="topnav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="topnav-right">
        <GlobalSearch />
        <NewMenu onAction={onAction} />
        {showBell && <NotificationBell align="right" />}
        <NavLink to="/help" className="topnav-icon-btn" title="Help & Guides" aria-label="Help & Guides">
          <IconHelp style={{ width: 18, height: 18 }} />
        </NavLink>
        {/* Gear matches the sidebar's canAccess('settings') gate and the AccessRoute on
            /settings — it was the one ungated path into Settings (Phase 0, settings overhaul). */}
        {canAccess('settings') && (
          <NavLink to="/settings" className="topnav-icon-btn" title="Settings" aria-label="Settings">
            <IconSettings style={{ width: 18, height: 18 }} />
          </NavLink>
        )}
        <UserMenu />
      </div>
    </header>
  );
}
