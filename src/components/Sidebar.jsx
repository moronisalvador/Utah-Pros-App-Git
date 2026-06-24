import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import NotificationBell from '@/components/NotificationBell';
import { IconLogout } from './Icons';
import { NAV_ITEMS, IconPlus, IconHelp, IconDevTools } from '@/lib/navItems';

export default function Sidebar({ isOpen, onNavClick, onAction }) {
  const { employee, canAccess, isFeatureEnabled, logout } = useAuth();

  const initials = employee?.full_name
    ? employee.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
    : '?';

  const handleAction = (key) => {
    onNavClick?.();
    onAction?.(key);
  };

  const isMoroni = employee?.email === 'moroni@utah-pros.com';

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">U</div>
        <span className="sidebar-title">UPR Platform</span>
        <div style={{ marginLeft: 'auto' }}><NotificationBell /></div>
      </div>

      {/* Quick create buttons */}
      <div style={{ padding: '0 var(--space-3)', marginBottom: 'var(--space-2)', display: 'flex', gap: 'var(--space-2)' }}>
        <button className="btn btn-primary btn-sm" onClick={() => handleAction('job')}
          style={{ flex: 1, gap: 4, height: 34, fontSize: 12 }}>
          <IconPlus style={{ width: 13, height: 13 }} /> New Job
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => handleAction('customer')}
          style={{ flex: 1, gap: 4, height: 34, fontSize: 12 }}>
          <IconPlus style={{ width: 13, height: 13 }} /> Customer
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, i) => {
          if (item.section) {
            return (
              <div key={`section-${i}`} className="sidebar-section-label">
                {item.section}
              </div>
            );
          }

          // Admin-only override (skip canAccess check for admins)
          if (item.adminOnly) {
            if (employee?.role !== 'admin') return null;
          } else if (!canAccess(item.key)) {
            // Role-based nav permission check
            return null;
          }

          // Feature flag check — hides item when flag is disabled
          if (item.featureFlag && !isFeatureEnabled(item.featureFlag)) return null;

          return (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' active' : ''}`
              }
              onClick={onNavClick}
            >
              <item.icon className="nav-icon" />
              {item.label}
              {item.badge && <span className="sidebar-badge">{item.badge}</span>}
            </NavLink>
          );
        })}

        {/* Help & Guides — always visible to every logged-in user (not role-gated) */}
        <NavLink
          to="/help"
          className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          onClick={onNavClick}
        >
          <IconHelp className="nav-icon" />
          Help &amp; Guides
        </NavLink>

        {/* Dev Tools — only visible to Moroni, not in NAV_ITEMS so never role-gated */}
        {isMoroni && (
          <NavLink
            to="/dev-tools"
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            onClick={onNavClick}
          >
            <IconDevTools className="nav-icon" />
            Dev Tools
          </NavLink>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user" style={{ cursor: 'default' }}>
          <div className="sidebar-avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name">{employee?.full_name || 'User'}</div>
            <div className="sidebar-user-role">{employee?.role || ''}</div>
          </div>
        </div>
        {employee?.role === 'admin' && (
          <NavLink
            to="/tech"
            onClick={onNavClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', marginTop: 6,
              fontSize: 12, color: 'var(--text-tertiary)',
              textDecoration: 'none', fontFamily: 'var(--font-sans)',
              borderRadius: 'var(--radius-md)',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01"/></svg>
            Tech View
          </NavLink>
        )}
        <button
          onClick={logout}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            background: 'none',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginTop: 6,
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#fecaca'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-light)'; }}
          title="Sign out"
        >
          <IconLogout style={{ width: 15, height: 15, flexShrink: 0 }} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
