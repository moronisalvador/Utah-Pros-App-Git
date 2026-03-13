import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from './Sidebar';
import CreateMenu from './CreateMenu';
import AddContactModal from './AddContactModal';
import { IconDashboard, IconConversations, IconJobs, IconSchedule } from './Icons';

// Bottom bar items — the 4 most-used + More
const BOTTOM_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: IconDashboard },
  { key: 'conversations', label: 'Messages', path: '/conversations', icon: IconConversations },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: IconJobs },
  { key: 'schedule', label: 'Schedule', path: '/schedule', icon: IconSchedule },
];

// Pages that show the Create FAB
const CREATE_MENU_PATHS = ['/', '/jobs', '/production', '/schedule', '/customers', '/leads'];

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
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAddContact, setShowAddContact] = useState(false);
  const [carriers, setCarriers] = useState([]);
  const location = useLocation();
  const navigate = useNavigate();
  const { db } = useAuth();

  // ── Poll unread count for badge ──
  const fetchUnread = useCallback(async () => {
    try {
      const convs = await db.select('conversations', 'select=unread_count');
      const total = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      setUnreadCount(total);
    } catch { /* silent */ }
  }, [db]);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Refetch on navigation (catches mark-as-read when leaving conversations)
  useEffect(() => { fetchUnread(); }, [location.pathname, fetchUnread]);

  // ── Fetch carriers once (for AddContactModal) ──
  useEffect(() => {
    db.select('insurance_carriers', 'is_active=eq.true&order=sort_order.asc,name.asc&select=id,name,short_name')
      .then(setCarriers)
      .catch(() => {});
  }, [db]);

  const handleNavClick = () => setSidebarOpen(false);
  const handleBottomTab = (path) => navigate(path);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const showCreateMenu = CREATE_MENU_PATHS.some(p => {
    if (p === '/') return location.pathname === '/';
    return location.pathname === p;
  });

  // ── Handle CreateMenu actions ──
  const handleCreateAction = (key) => {
    switch (key) {
      case 'job': navigate('/jobs/new'); break;
      case 'estimate': navigate('/estimates/new'); break;
      case 'customer': setShowAddContact(true); break;
    }
  };

  // ── Save new contact from modal ──
  const handleSaveContact = async (data) => {
    try {
      const inserted = await db.insert('contacts', {
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setShowAddContact(false);
      // Navigate to the new contact's profile
      if (inserted?.length > 0) {
        navigate(`/contacts/${inserted[0].id}`);
      }
    } catch (err) {
      alert('Failed to add contact: ' + err.message);
    }
  };

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar isOpen={sidebarOpen} onNavClick={handleNavClick} />

      <main className="app-content">
        <Outlet />
      </main>

      {showCreateMenu && <CreateMenu onAction={handleCreateAction} />}

      {/* Add Contact Modal — accessible from any page via CreateMenu */}
      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onSave={handleSaveContact}
          carriers={carriers}
        />
      )}

      {/* ── Bottom Tab Bar (mobile only) ── */}
      <nav className="bottom-bar">
        {BOTTOM_TABS.map(tab => (
          <button
            key={tab.key}
            className={`bottom-tab${isActive(tab.path) ? ' active' : ''}`}
            onClick={() => handleBottomTab(tab.path)}
          >
            <span className="bottom-tab-icon-wrap">
              <tab.icon className="bottom-tab-icon" />
              {tab.key === 'conversations' && unreadCount > 0 && (
                <span className="bottom-tab-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </span>
            <span className="bottom-tab-label">{tab.label}</span>
          </button>
        ))}
        <button
          className={`bottom-tab${sidebarOpen ? ' active' : ''}`}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <span className="bottom-tab-icon-wrap">
            <IconMore className="bottom-tab-icon" />
          </span>
          <span className="bottom-tab-label">More</span>
        </button>
      </nav>
    </div>
  );
}
