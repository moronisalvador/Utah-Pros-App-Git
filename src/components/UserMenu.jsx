/**
 * ════════════════════════════════════════════════
 * FILE: UserMenu.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The round avatar at the far right of the desktop top bar. Clicking it opens
 *   a small menu showing who's signed in, a shortcut to the field-tech view
 *   (admins only), and a Sign Out button. It's the top-bar version of the user
 *   card that used to live at the bottom of the side menu.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (desktop top bar, ≥1280px only)
 *   Rendered by:  src/components/TopNav.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (employee, logout), @/components/Icons (IconLogout)
 *   Data:      reads → employees (via AuthContext.employee) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - "Tech View" link is admin-only (same gate as the old sidebar footer).
 *   - Closes on outside-click and Escape.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconLogout } from '@/components/Icons';

function IconPhone(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" />
    </svg>
  );
}

export default function UserMenu() {
  const { employee, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const initials = employee?.full_name
    ? employee.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
    : '?';

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="topnav-user" ref={ref}>
      <button className="topnav-avatar" onClick={() => setOpen(o => !o)} title={employee?.full_name || 'Account'} aria-haspopup="menu" aria-expanded={open}>
        {initials}
      </button>
      {open && (
        <div className="topnav-menu topnav-menu--user" role="menu">
          <div className="topnav-user-head">
            <div className="topnav-user-name">{employee?.full_name || 'User'}</div>
            <div className="topnav-user-role">{employee?.role || ''}</div>
          </div>
          {employee?.role === 'admin' && (
            <NavLink to="/tech" className="topnav-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <IconPhone style={{ width: 15, height: 15 }} />
              <span className="topnav-menu-label">Tech View</span>
            </NavLink>
          )}
          <button className="topnav-menu-item topnav-menu-item--danger" role="menuitem" onClick={logout}>
            <IconLogout style={{ width: 15, height: 15 }} />
            <span className="topnav-menu-label">Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
