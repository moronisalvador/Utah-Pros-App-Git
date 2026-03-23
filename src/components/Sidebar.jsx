import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  IconDashboard, IconConversations, IconJobs,
  IconCustomers, IconSchedule, IconTimeTracking,
  IconAdmin, IconSettings, IconLogout,
} from './Icons';

function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconTemplates(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 14v7"/></svg>);}

const NAV_ITEMS = [
  { section: 'Main' },
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: IconDashboard },
  { key: 'conversations', label: 'Conversations', path: '/conversations', icon: IconConversations, badge: true },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: IconJobs },
  { key: 'customers', label: 'Customers', path: '/customers', icon: IconCustomers },

  { section: 'Operations' },
  { key: 'schedule', label: 'Schedule', path: '/schedule', icon: IconSchedule },
  { key: 'schedule_templates', label: 'Schedule Templates', path: '/schedule/templates', icon: IconTemplates },
  { key: 'time_tracking', label: 'Time Tracking', path: '/time-tracking', icon: IconTimeTracking },

  { section: 'System' },
  { key: 'admin_panel', label: 'Admin', path: '/admin', icon: IconAdmin },
  { key: 'settings', label: 'Settings', path: '/settings', icon: IconSettings },
];

export default function Sidebar({ isOpen, onNavClick, onAction }) {
  const { employee, canAccess, logout } = useAuth();

  const initials = employee?.full_name
    ? employee.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
    : '?';

  const handleAction = (key) => {
    onNavClick?.();
    onAction?.(key);
  };

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

          if (!canAccess(item.key)) return null;

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
              {item.badge && null}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user" onClick={logout} title="Click to sign out">
          <div className="sidebar-avatar">{initials}</div>
          <div>
            <div className="sidebar-user-name">{employee?.full_name || 'User'}</div>
            <div className="sidebar-user-role">{employee?.role || ''}</div>
          </div>
          <IconLogout className="nav-icon" style={{ marginLeft: 'auto', width: 16, height: 16 }} />
        </div>
      </div>
    </aside>
  );
}
