import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  IconDashboard, IconConversations, IconJobs,
  IconCustomers, IconSchedule, IconTimeTracking,
  IconAdmin, IconSettings, IconLogout,
} from './Icons';

function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconTemplates(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 14v7"/></svg>);}
function IconProduction(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="4" height="18" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="5" width="4" height="16" rx="1"/></svg>);}
function IconCollections(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M9 3.5C10 3.2 11 3 12 3"/><path d="M3.5 9C3.2 10 3 11 3 12"/></svg>);}
function IconClaim(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>);}
function IconDevTools(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>);}
function IconImport(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>);}

// featureFlag: if set, this nav item is hidden when that flag is disabled
// No featureFlag = always show (existing pages are unrestricted)
const NAV_ITEMS = [
  { section: 'Main' },
  { key: 'dashboard',    label: 'Dashboard',    path: '/',             icon: IconDashboard },
  { key: 'conversations',label: 'Conversations',path: '/conversations', icon: IconConversations, badge: true },
  { key: 'claims',       label: 'Claims',       path: '/claims',       icon: IconClaim },
  { key: 'jobs',         label: 'Jobs',         path: '/jobs',         icon: IconJobs },
  { key: 'production',   label: 'Production',   path: '/production',   icon: IconProduction },
  { key: 'customers',    label: 'Customers',    path: '/customers',    icon: IconCustomers },

  { section: 'Operations' },
  { key: 'schedule',           label: 'Schedule',           path: '/schedule',           icon: IconSchedule },
  { key: 'schedule_templates', label: 'Schedule Templates', path: '/schedule/templates', icon: IconTemplates },
  { key: 'time_tracking',      label: 'Time Tracking',      path: '/time-tracking',      icon: IconTimeTracking, featureFlag: 'page:time_tracking' },
  { key: 'collections',        label: 'Collections',        path: '/collections',        icon: IconCollections,  featureFlag: 'page:collections' },
  { key: 'leads',              label: 'Leads',              path: '/leads',              icon: IconJobs,         featureFlag: 'page:leads' },
  { key: 'encircle_import',    label: 'Encircle Import',    path: '/import/encircle',    icon: IconImport,       featureFlag: 'page:encircle_import' },

  { section: 'System' },
  { key: 'admin_panel', label: 'Admin',    path: '/admin',    icon: IconAdmin },
  { key: 'settings',    label: 'Settings', path: '/settings', icon: IconSettings },
];

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

          // Role-based nav permission check
          if (!canAccess(item.key)) return null;

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
