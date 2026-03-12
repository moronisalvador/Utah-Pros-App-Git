import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  IconDashboard, IconConversations, IconJobs, IconLeads,
  IconCustomers, IconSchedule, IconTimeTracking, IconMarketing,
  IconAdmin, IconSettings, IconLogout,
} from './Icons';

const NAV_ITEMS = [
  { section: 'Main' },
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: IconDashboard },
  { key: 'conversations', label: 'Conversations', path: '/conversations', icon: IconConversations, badge: true },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: IconJobs },
  { key: 'leads', label: 'Leads', path: '/leads', icon: IconLeads },
  { key: 'customers', label: 'Customers', path: '/customers', icon: IconCustomers },

  { section: 'Operations' },
  { key: 'schedule', label: 'Schedule', path: '/schedule', icon: IconSchedule },
  { key: 'time_tracking', label: 'Time Tracking', path: '/time-tracking', icon: IconTimeTracking },

  { section: 'Growth' },
  { key: 'marketing', label: 'Marketing', path: '/marketing', icon: IconMarketing },

  { section: 'System' },
  { key: 'admin_panel', label: 'Admin', path: '/admin', icon: IconAdmin },
  { key: 'settings', label: 'Settings', path: '/settings', icon: IconSettings },
];

export default function Sidebar({ isOpen, onNavClick }) {
  const { employee, canAccess, logout } = useAuth();

  const initials = employee?.full_name
    ? employee.full_name.split(' ').map(n => n[0]).join('').toUpperCase()
    : '?';

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">U</div>
        <span className="sidebar-title">UPR Platform</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, i) => {
          // Section header
          if (item.section) {
            return (
              <div key={`section-${i}`} className="sidebar-section-label">
                {item.section}
              </div>
            );
          }

          // Check role-based access
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
