import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToConversations } from '@/lib/realtime';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import OverflowDrawer from './OverflowDrawer';
import CreateJobModal from './CreateJobModal';
import AddContactModal from './AddContactModal';
import NewInvoiceModal from './NewInvoiceModal';
import NewEstimateModal from './NewEstimateModal';
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
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [showNewEstimate, setShowNewEstimate] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false); // desktop overflow drawer (≥1280px)
  const [carriers, setCarriers] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // True when the desktop top-nav is active (≥1024px). Used ONLY to decide where
  // the single NotificationBell mounts (TopNav vs Sidebar header) so we never run
  // two live notification subscriptions at once. The shell layout itself is CSS-only.
  const [isDesktopNav, setIsDesktopNav] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  const location = useLocation();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  // crm_partner accounts (external marketing-agency logins) may only reach
  // /crm/* (+ /help). Most other routes in this file have no per-route guard
  // of their own — they've always relied on the sidebar simply not showing a
  // link, which was fine when every authenticated user was trusted staff.
  // This is the one choke point that actually blocks direct-URL access for
  // that external role, instead of auditing/adding a guard to every route.
  useEffect(() => {
    if (
      employee?.role === 'crm_partner' &&
      !location.pathname.startsWith('/crm') &&
      !location.pathname.startsWith('/help')
    ) {
      navigate('/crm/leads', { replace: true });
    }
  }, [employee, location.pathname, navigate]);

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

  // ── Track the ≥1024px top-nav breakpoint (bell placement only) ──
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => {
      setIsDesktopNav(e.matches);
      if (!e.matches) setOverflowOpen(false); // don't leave the desktop drawer stuck open after shrinking
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
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

  // ── Unread badge — realtime, not polled ──
  // unreadByConv tracks each conversation's own unread_count so a single realtime row
  // update can adjust the total without a full-table refetch (was: 30s poll).
  const unreadByConvRef = useRef({});
  const recomputeUnread = useCallback(() => {
    const total = Object.values(unreadByConvRef.current).reduce((sum, n) => sum + (n || 0), 0);
    setUnreadCount(total);
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const convs = await db.select('conversations', 'select=id,unread_count');
      unreadByConvRef.current = Object.fromEntries(convs.map(c => [c.id, c.unread_count || 0]));
      recomputeUnread();
    } catch { /* silent */ }
  }, [db, recomputeUnread]);

  // One initial fetch to seed the map, then the shared realtime channel keeps it current.
  useEffect(() => { fetchUnread(); }, [fetchUnread]);

  useEffect(() => {
    const unsubscribe = subscribeToConversations((payload) => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old?.id;
        if (id != null) delete unreadByConvRef.current[id];
      } else if (payload.new) {
        unreadByConvRef.current[payload.new.id] = payload.new.unread_count || 0;
      }
      recomputeUnread();
    });
    return unsubscribe;
  }, [recomputeUnread]);

  // Load lookup data for AddContactModal — use rpc to bypass PostgREST schema cache
  useEffect(() => {
    db.rpc('get_insurance_carriers').then(setCarriers).catch(() => {});
    db.rpc('get_referral_sources').then(setReferralSources).catch(() => {});
  }, [db]); // db reference changes when auth token refreshes; reload to get fresh data

  const handleNavClick = () => setSidebarOpen(false);
  const handleBottomTab = (path) => navigate(path);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // ── Create action handler (Sidebar buttons + TopNav "New" menu) ──
  const handleCreateAction = (key) => {
    setSidebarOpen(false);
    setOverflowOpen(false);
    if (key === 'job') { setShowCreateJob(true); return; }
    if (key === 'customer') { setShowAddContact(true); return; }
    if (key === 'invoice') { setShowNewInvoice(true); return; }
    if (key === 'estimate') { setShowNewEstimate(true); return; }
  };

  // After contact saved — navigate to new contact, reload customers list if on that page
  const handleContactSaved = async (data) => {
    const goTo = (id, msg, type = 'success') => {
      setShowAddContact(false);
      window.dispatchEvent(new CustomEvent('upr:contact-created'));
      navigate(`/customers/${id}`);
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type } }));
    };
    try {
      const result = await db.insert('contacts', data);
      if (result?.length > 0) {
        goTo(result[0].id, `${data.name} added successfully`);
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('contacts_phone_key') || msg.includes('23505')) {
        // Duplicate phone — navigate to the existing customer instead of failing
        try {
          const existing = await db.select('contacts', `phone=eq.${encodeURIComponent(data.phone)}&select=id,name&limit=1`);
          if (existing?.length > 0) {
            goTo(existing[0].id, `Customer already exists: ${existing[0].name}`, 'success');
            return;
          }
        } catch { /* fall through */ }
        window.dispatchEvent(new CustomEvent('upr:toast', {
          detail: { message: 'A customer with this phone number already exists', type: 'error' }
        }));
        throw err;
      }
      window.dispatchEvent(new CustomEvent('upr:toast', {
        detail: { message: 'Failed to save contact: ' + msg, type: 'error' }
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

      {/* Desktop top nav (≥1280px) — hidden on phones/iPads via CSS */}
      <TopNav
        unreadCount={unreadCount}
        onAction={handleCreateAction}
        onMenuClick={() => setOverflowOpen(true)}
        showBell={isDesktopNav}
      />

      <Sidebar isOpen={sidebarOpen} onNavClick={handleNavClick} onAction={handleCreateAction} showBell={!isDesktopNav} />

      {/* Desktop "More" drawer (≥1280px) — opened by the TopNav hamburger */}
      <OverflowDrawer open={overflowOpen} onClose={() => setOverflowOpen(false)} />

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

      {showNewInvoice && (
        <NewInvoiceModal db={db} onClose={() => setShowNewInvoice(false)} />
      )}

      {showNewEstimate && (
        <NewEstimateModal db={db} onClose={() => setShowNewEstimate(false)} />
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
