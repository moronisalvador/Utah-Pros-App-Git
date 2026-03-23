import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from './Sidebar';
import CreateJobModal from './CreateJobModal';
import AddContactModal from './AddContactModal';
import { IconDashboard, IconConversations, IconJobs, IconSchedule } from './Icons';

// Bottom bar items — the 4 most-used + More
const BOTTOM_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: IconDashboard },
  { key: 'conversations', label: 'Messages', path: '/conversations', icon: IconConversations },
  { key: 'jobs', label: 'Jobs', path: '/jobs', icon: IconJobs },
  { key: 'schedule', label: 'Schedule', path: '/schedule', icon: IconSchedule },
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [carriers, setCarriers] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const location = useLocation();
  const navigate = useNavigate();
  const { db } = useAuth();

  // ── Offline detection ──
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ── Global toast system — fire from anywhere with:
  //    window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type, title } }))
  useEffect(() => {
    const handler = (e) => {
      const { message, type = 'success', title } = e.detail || {};
      if (!message) return;
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, message, type, title }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
    };
    window.addEventListener('upr:toast', handler);
    return () => window.removeEventListener('upr:toast', handler);
  }, []);

  // ── Poll unread count for badge ──
  const fetchUnread = useCallback(async () => {
    try {
      const convs = await db.select('conversations', 'select=unread_count');
      const total = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
      setUnreadCount(total);
    } catch { /* silent */ }
  }, [db]);

  // Mount + interval — single source of truth
  const mountedRef = useRef(false);
  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  // Refetch on navigation but skip the very first render (already fetched above)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    fetchUnread();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load lookup data for AddContactModal — use rpc to bypass PostgREST schema cache
  useEffect(() => {
    db.rpc('get_insurance_carriers').then(setCarriers).catch(() => {});
    db.rpc('get_referral_sources').then(setReferralSources).catch(() => {});
  }, []);

  const handleNavClick = () => setSidebarOpen(false);
  const handleBottomTab = (path) => navigate(path);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // ── CreateMenu / Sidebar action handler ──
  const handleCreateAction = (key) => {
    setSidebarOpen(false);
    if (key === 'job') { setShowCreateJob(true); return; }
    if (key === 'customer') { setShowAddContact(true); return; }
  };

  // After contact saved — navigate to new contact, reload customers list if on that page
  const handleContactSaved = async (data) => {
    try {
      const result = await db.insert('contacts', data);
      setShowAddContact(false);
      if (result?.length > 0) {
        // Fire event so Customers.jsx can reload its list if mounted
        window.dispatchEvent(new CustomEvent('upr:contact-created'));
        navigate(`/customers/${result[0].id}`);
        window.dispatchEvent(new CustomEvent('upr:toast', {
          detail: { message: `${data.name} added successfully`, type: 'success' }
        }));
      }
    } catch (err) {
      window.dispatchEvent(new CustomEvent('upr:toast', {
        detail: { message: 'Failed to save contact: ' + err.message, type: 'error' }
      }));
      throw err;
    }
  };

  // ── After job created — navigate to new job page ──
  const handleJobCreated = (result) => {
    setShowCreateJob(false);
    const jobId = result?.job?.id || result?.id;
    if (jobId) {
      navigate(`/jobs/${jobId}`);
      window.dispatchEvent(new CustomEvent('upr:toast', {
        detail: { message: `Job created successfully`, type: 'success' }
      }));
    }
  };

  return (
    <div className="app-layout">
      {/* ── Offline Banner ── */}
      {!isOnline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10001,
          background: '#1c1917', color: '#fef3c7',
          padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px', textAlign: 'center',
          fontSize: 13, fontWeight: 600, letterSpacing: '0.01em',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <span>⚠️</span>
          <span>You're offline — changes can't be saved right now</span>
        </div>
      )}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar isOpen={sidebarOpen} onNavClick={handleNavClick} onAction={handleCreateAction} />

      <main className="app-content">
        <Outlet />
      </main>

      {showCreateJob && (
        <CreateJobModal
          db={db}
          onClose={() => setShowCreateJob(false)}
          onCreated={handleJobCreated}
        />
      )}

      {showAddContact && (
        <AddContactModal
          onClose={() => setShowAddContact(false)}
          onSave={handleContactSaved}
          carriers={carriers}
          referralSources={referralSources}
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

      {/* ── Toast Notifications ── */}
      <div style={{position:'fixed',bottom:'calc(var(--bottom-bar-h) + var(--safe-bottom) + 12px)',left:'50%',transform:'translateX(-50%)',zIndex:10000,display:'flex',flexDirection:'column-reverse',gap:10,alignItems:'center',pointerEvents:'none',width:'calc(100% - 32px)',maxWidth:420}}>
        {toasts.map(toast => (
          <div key={toast.id}
            style={{
              background: toast.type==='error' ? '#fef2f2' : toast.type==='warning' ? '#fffbeb' : '#f0fdf4',
              border: `1px solid ${toast.type==='error' ? '#fecaca' : toast.type==='warning' ? '#fde68a' : '#bbf7d0'}`,
              borderLeft: `4px solid ${toast.type==='error' ? '#ef4444' : toast.type==='warning' ? '#f59e0b' : '#22c55e'}`,
              borderRadius:12,padding:'14px 18px',boxShadow:'0 4px 20px rgba(0,0,0,0.12)',
              pointerEvents:'all',width:'100%',
              animation:'slideUp 0.25s ease',
            }}>
            <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
              <span style={{fontSize:20,flexShrink:0,lineHeight:1.2}}>
                {toast.type==='error' ? '❌' : toast.type==='warning' ? '⚠️' : '✅'}
              </span>
              <div style={{flex:1,minWidth:0}}>
                {toast.title && <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:2}}>{toast.title}</div>}
                <div style={{fontSize:13,color:'#334155',lineHeight:1.5}}>{toast.message}</div>
              </div>
              <button onClick={()=>setToasts(prev=>prev.filter(t=>t.id!==toast.id))}
                style={{background:'none',border:'none',cursor:'pointer',fontSize:16,color:'#94a3b8',padding:0,flexShrink:0,lineHeight:1}}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
