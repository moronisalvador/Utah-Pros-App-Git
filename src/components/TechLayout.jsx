import { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSchedule, IconConversations } from '@/components/Icons';

/* ── Tab icons (inline SVGs for filled variants) ── */

function IconHome({ filled, ...props }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
        <path d="M3 12l2-2V5a1 1 0 011-1h2a1 1 0 011 1v1l3-3a1 1 0 011.4 0l8 8a1 1 0 01-.7 1.7H19v7a2 2 0 01-2 2h-3v-5a1 1 0 00-1-1h-2a1 1 0 00-1 1v5H7a2 2 0 01-2-2v-7H3.7a1 1 0 01-.7-1.7z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconCalendar({ filled, ...props }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
        <path d="M8 2a1 1 0 011 1v1h6V3a1 1 0 112 0v1h2a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h2V3a1 1 0 011-1zM5 10v10h14V10H5z" />
      </svg>
    );
  }
  return <IconSchedule {...props} />;
}

function IconChecklist({ filled, ...props }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" {...props}>
        <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" />
        <polyline points="9 12 12 15 20 5" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconChat({ filled, ...props }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    );
  }
  return <IconConversations {...props} />;
}

function IconFolder({ filled, ...props }) {
  if (filled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
        <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* ── Tab definitions ── */

const TABS = [
  { key: 'dash', label: 'Dash', path: '/tech', Icon: IconHome, exact: true },
  { key: 'schedule', label: 'Schedule', path: '/tech/schedule', Icon: IconCalendar },
  { key: 'tasks', label: 'Tasks', path: '/tech/tasks', Icon: IconChecklist },
  { key: 'messages', label: 'Messages', path: '/tech/conversations', Icon: IconChat },
  { key: 'claims', label: 'Claims', path: '/tech/claims', Icon: IconFolder },
];

/* ── PWA Install Banner ── */

function InstallBanner() {
  const { employee } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);
    if (sessionStorage.getItem('pwa-dismissed')) setDismissed(true);
  }, []);

  // Android/Chrome: listen for install prompt
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (employee?.role !== 'field_tech') return null;
  if (isStandalone || dismissed) return null;

  const isIOS = /iPhone|iPad/.test(navigator.userAgent) && !window.navigator.standalone;
  const showAndroid = !!deferredPrompt;

  if (!isIOS && !showAndroid) return null;

  const dismiss = () => {
    sessionStorage.setItem('pwa-dismissed', '1');
    setDismissed(true);
  };

  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      dismiss();
    }
  };

  return (
    <div style={{
      background: 'var(--accent)', color: '#fff',
      padding: '10px var(--space-4)',
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 13, fontWeight: 500,
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ flex: 1 }}>
        {isIOS
          ? <>Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install UPR</>
          : 'Install UPR for the best experience'
        }
      </div>
      {showAndroid && (
        <button
          onClick={install}
          style={{
            background: '#fff', color: 'var(--accent)',
            border: 'none', borderRadius: 'var(--radius-md)',
            padding: '5px 12px', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0,
          }}
        >
          Install App
        </button>
      )}
      <button
        onClick={dismiss}
        style={{
          background: 'none', border: 'none', color: '#fff',
          cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1,
          opacity: 0.8, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

/* ── TechLayout ── */

export default function TechLayout() {
  const location = useLocation();
  const { employee, db, logout } = useAuth();
  const [taskCount, setTaskCount] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutTimer = useRef(null);

  useEffect(() => {
    if (!employee?.id || !db) return;
    const load = async () => {
      try {
        const tasks = await db.rpc('get_assigned_tasks', { p_employee_id: employee.id });
        setTaskCount((tasks || []).filter(t => t.is_today).length);
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [db, employee]);

  const isActive = (tab) => {
    if (tab.exact) return location.pathname === tab.path;
    return location.pathname.startsWith(tab.path);
  };

  const isAdmin = employee?.role === 'admin';

  const handleLogoutTap = () => {
    if (!confirmLogout) {
      setConfirmLogout(true);
      logoutTimer.current = setTimeout(() => setConfirmLogout(false), 3000);
      return;
    }
    setConfirmLogout(false);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    logout();
  };

  return (
    <div className="tech-layout">
      {/* Top-right controls */}
      <div style={{
        position: 'fixed', top: 12, right: 12, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {/* Sign out button */}
        <button
          onClick={handleLogoutTap}
          onBlur={() => { setConfirmLogout(false); if (logoutTimer.current) clearTimeout(logoutTimer.current); }}
          style={{
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: confirmLogout ? 'rgba(254,242,242,0.9)' : 'rgba(248,249,251,0.8)',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            borderRadius: 'var(--radius-full)',
            border: `1px solid ${confirmLogout ? '#fecaca' : 'var(--border-light)'}`,
            cursor: 'pointer', padding: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background 0.15s, border-color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={confirmLogout ? '#dc2626' : 'var(--text-tertiary)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>

        {/* Admin view pill */}
        {isAdmin && (
          <Link
            to="/"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 12px',
              fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-light)',
              textDecoration: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
            Admin
          </Link>
        )}
      </div>
      <div className="tech-content">
        <Outlet />
      </div>
      <InstallBanner />
      <nav className="tech-nav">
        {TABS.map(tab => {
          const active = isActive(tab);
          const showDot = tab.key === 'tasks' && taskCount > 0;
          return (
            <Link
              key={tab.key}
              to={tab.path}
              className={`tech-nav-tab${active ? ' active' : ''}`}
            >
              <tab.Icon filled={active} />
              {showDot && (
                <span style={{
                  position: 'absolute', top: 4, right: '50%', marginRight: -16,
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#ef4444',
                }} />
              )}
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
