import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { IconDashboard, IconConversations, IconJobs, IconProduction } from './Icons';

// Bottom bar items — the 4 most-used + More
const BOTTOM_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: IconDashboard },
  { key: 'conversations', label: 'Messages', path: '/conversations', icon: IconConversations },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: IconJobs },
  { key: 'production', label: 'Production', path: '/production', icon: IconProduction },
];

function IconMore(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavClick = () => setSidebarOpen(false);

  const handleBottomTab = (path) => {
    navigate(path);
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="app-layout">
      {/* Sidebar overlay backdrop (mobile) */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar isOpen={sidebarOpen} onNavClick={handleNavClick} />

      <main className="app-content">
        <Outlet />
      </main>

      {/* ── Bottom Tab Bar (mobile only) ── */}
      <nav className="bottom-bar">
        {BOTTOM_TABS.map(tab => (
          <button
            key={tab.key}
            className={`bottom-tab${isActive(tab.path) ? ' active' : ''}`}
            onClick={() => handleBottomTab(tab.path)}
          >
            <tab.icon className="bottom-tab-icon" />
            <span className="bottom-tab-label">{tab.label}</span>
          </button>
        ))}
        <button
          className={`bottom-tab${sidebarOpen ? ' active' : ''}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <IconMore className="bottom-tab-icon" />
          <span className="bottom-tab-label">More</span>
        </button>
      </nav>
    </div>
  );
}
