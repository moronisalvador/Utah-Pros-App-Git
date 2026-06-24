/**
 * ════════════════════════════════════════════════
 * FILE: SettingsLayout.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Settings" area shell. On big desktop screens it shows a left sub-menu
 *   listing the system pages (Admin, Scope Sheet Builder, Tech Feedback,
 *   Settings, Help, Dev Tools) next to the page you're viewing — like the gear
 *   area in other tools. The page itself is unchanged; this just wraps it with
 *   the sub-menu. On phones and iPads it adds nothing (it gets out of the way),
 *   so those pages look exactly as they did before.
 *
 * WHERE IT LIVES:
 *   Route:        wraps /settings, /help, /admin, /admin/demo-sheet-builder,
 *                 /tech-feedback, /dev-tools (as a pathless layout route)
 *   Rendered by:  src/App.jsx (inside the main Layout's <Outlet/>)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (NavLink, Outlet)
 *   Internal:  @/contexts/AuthContext (gating helpers), @/lib/navItems
 *              (SYSTEM_ITEMS, isItemVisible)
 *   Data:      reads → none directly · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Below 1280px the wrapper uses `display:contents` (and the rail is hidden),
 *     so the wrapped page renders as a direct child of .app-content exactly like
 *     before — zero behavioral change on mobile/iPad.
 *   - The rail only lists pages the user may see (isItemVisible), matching the
 *     legacy sidebar's System section + Help + (Moroni) Dev Tools.
 *   - Settings.jsx has its OWN internal left nav (Carriers/Referrals/Templates);
 *     that stays inside its content. The hub rail is a separate, outer menu.
 * ════════════════════════════════════════════════
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { SYSTEM_ITEMS, isItemVisible } from '@/lib/navItems';

export default function SettingsLayout() {
  const { employee, canAccess, isFeatureEnabled } = useAuth();
  const isMoroni = employee?.email === 'moroni@utah-pros.com';
  const ctx = { canAccess, isFeatureEnabled, employee, isMoroni };
  const items = SYSTEM_ITEMS.filter(item => isItemVisible(item, ctx));

  return (
    <div className="settings-hub">
      <nav className="settings-hub-rail">
        <div className="settings-hub-title">Settings</div>
        {items.map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            end={item.end}
            className={({ isActive }) => `settings-hub-link${isActive ? ' active' : ''}`}
          >
            <item.icon className="nav-icon" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="settings-hub-content">
        <Outlet />
      </div>
    </div>
  );
}
