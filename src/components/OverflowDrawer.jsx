/**
 * ════════════════════════════════════════════════
 * FILE: OverflowDrawer.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The slide-out "More" menu for the desktop top bar. The top bar only has room
 *   for the most-used pages, so the rest (Jobs, Production, Schedule Templates,
 *   Encircle Import, OOP Pricing, Leads, Marketing) live here. Clicking the
 *   hamburger button in the top bar slides this panel in from the left; clicking
 *   a link, the backdrop, or pressing Escape closes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (desktop overlay, ≥1280px only)
 *   Rendered by:  src/components/Layout.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (gating helpers), @/lib/navItems
 *              (OVERFLOW_ITEMS, isItemVisible)
 *   Data:      reads → none directly · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Only ever opened from the TopNav hamburger (≥1280px). Off-screen + inert
 *     otherwise (transform + pointer-events:none), so it's harmless on mobile.
 *   - Same role/feature-flag gating as everywhere else via isItemVisible().
 * ════════════════════════════════════════════════
 */
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { OVERFLOW_ITEMS, isItemVisible } from '@/lib/navItems';
import { isMoroni as isMoroniOwner } from '@/lib/owner';

function IconX(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function OverflowDrawer({ open, onClose }) {
  const { employee, canAccess, isFeatureEnabled } = useAuth();
  const isMoroni = isMoroniOwner(employee);
  const ctx = { canAccess, isFeatureEnabled, employee, isMoroni };

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const items = OVERFLOW_ITEMS.filter(item => isItemVisible(item, ctx));

  return (
    <>
      <div className={`overflow-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`overflow-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="overflow-drawer-head">
          <span className="overflow-drawer-title">More</span>
          <button className="overflow-drawer-close" onClick={onClose} aria-label="Close menu">
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <nav className="overflow-drawer-nav">
          {items.length === 0 ? (
            <div className="overflow-drawer-empty">No additional pages.</div>
          ) : (
            items.map(item => (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.end}
                className={({ isActive }) => `overflow-drawer-link${isActive ? ' active' : ''}`}
                onClick={onClose}
              >
                <item.icon className="nav-icon" />
                {item.label}
              </NavLink>
            ))
          )}
        </nav>
      </aside>
    </>
  );
}
