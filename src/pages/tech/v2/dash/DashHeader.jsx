/**
 * ════════════════════════════════════════════════
 * FILE: DashHeader.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The greeting bar at the top of the dashboard: today's date, "Hey <name> 👋",
 *   and a one-line summary of how many visits are on today. On the right are a
 *   Help button and a "⋮" menu with Admin View (admins only), Send Feedback, and
 *   Sign Out. Sign Out uses a two-tap confirm — no pop-up dialog. This bar stays
 *   fixed and does not move when the tech pulls down to refresh.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (fixed header of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/lib/nativeHaptics (impact)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Sign Out is a two-click inline confirm (CLAUDE.md rule 2 — no confirm()).
 *   - Rendered OUTSIDE the PullToRefresh content so it stays put on pull
 *     (tech-mobile-ux: sticky headers don't move).
 * ════════════════════════════════════════════════
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { impact } from '@/lib/nativeHaptics';
import { currentLocaleTag } from '@/lib/techDateUtils';
import NotificationBell from '@/components/NotificationBell';
import { adminDashHref } from '@/components/admin-mobile';

/**
 * @param {{ employee: object, count: number, isAdmin: boolean, onLogout: () => void }} props
 */
export default function DashHeader({ employee, count, isAdmin, onLogout }) {
  const { t } = useTranslation('dash');
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutTimer = useRef(null);

  useEffect(() => () => { if (logoutTimer.current) clearTimeout(logoutTimer.current); }, []);

  const handleLogoutTap = () => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      impact('light');
      logoutTimer.current = setTimeout(() => setConfirmLogout(false), 3000);
      return;
    }
    setConfirmLogout(false);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    onLogout();
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString(currentLocaleTag(), { weekday: 'long', month: 'long', day: 'numeric' });
  const firstName = (employee.display_name || employee.full_name || '').split(' ')[0];

  return (
    <div className="tv2-dash-header">
      {/* Notification bell — one slot left of Help, matching the icon buttons.
          Its badge + dropdown + realtime toast come from the shared component. */}
      <div style={{ position: 'absolute', top: '10px', right: 'calc(16px + 2 * (var(--tech-min-tap) + 8px))' }}>
        <NotificationBell align="right" triggerClassName="tv2-dash-header__icon-btn" />
      </div>

      <button type="button" className="tv2-dash-header__icon-btn" aria-label={t('helpAria')} onClick={() => navigate('/tech/help')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>

      <div className="tv2-dash-header__menu" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowMenu(false); }}>
        <button type="button" className="tv2-dash-header__icon-btn" data-active={showMenu ? 'true' : undefined} aria-label={t('moreAria')} onClick={() => setShowMenu((v) => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>
        {showMenu && (
          <div className="tv2-dash-menu">
            {isAdmin && (
              <button type="button" className="tv2-dash-menu__item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setShowMenu(false); navigate(adminDashHref()); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                {t('menu.adminView')}
              </button>
            )}
            <button type="button" className="tv2-dash-menu__item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setShowMenu(false); navigate('/tech/feedback'); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              {t('menu.sendFeedback')}
            </button>
            <button type="button" className="tv2-dash-menu__item" data-danger={confirmLogout ? 'true' : undefined} onMouseDown={(e) => e.preventDefault()} onBlur={() => { setConfirmLogout(false); if (logoutTimer.current) clearTimeout(logoutTimer.current); }} onClick={() => { if (confirmLogout) setShowMenu(false); handleLogoutTap(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              {confirmLogout ? t('menu.signOutConfirm') : t('menu.signOut')}
            </button>
          </div>
        )}
      </div>

      <div className="tv2-dash-header__date">{dateStr}</div>
      <div className="tv2-dash-header__name">{t('greeting', { name: firstName })}</div>
      <div className="tv2-dash-header__summary">{t('apptsToday', { count })}</div>
    </div>
  );
}
