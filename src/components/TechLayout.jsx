/**
 * ════════════════════════════════════════════════
 * FILE: TechLayout.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shell around every field-tech screen: the bottom tab bar, the offline
 *   indicator, the install banner, and the toast pop-ups. It also hosts the Tech
 *   Mobile v2 "panes" — the rebuilt dashboard and schedule stay alive in the
 *   background so switching tabs is instant and nothing reloads; each other
 *   screen still renders in the normal spot.
 *
 * WHERE IT LIVES:
 *   Route:        wraps all /tech/* routes
 *   Rendered by:  src/App.jsx (TechRoutes → <TechLayout/> layout element)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  contexts/AuthContext, components/Icons, components/tech/OfflineStatusPill,
 *              components/ErrorBoundary, components/tech/v2 (TechPane, skeletons),
 *              lib/resumeRestore, lib/pwaDiagnostics, pages/tech/v2 (TechDashV2,
 *              TechScheduleV2 — lazy)
 *   Data:      reads → get_assigned_tasks (60s poll for the "More" tab badge)
 *
 * NOTES / GOTCHAS:
 *   - Pane host: v2 panes render OUTSIDE the pathname-keyed <Outlet/> wrapper so
 *     they never remount on navigation; hidden with display:none (transforms are
 *     banned on WKWebView). Dashboard/Schedule are the only live implementations.
 *   - The keyed <Outlet/> replays the 0.2s fade on each route change and is not
 *     rendered while a v2 pane covers the screen.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, Suspense, lazy } from 'react';
import { Outlet, Link, useLocation, useNavigationType } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { IconSchedule, IconConversations } from '@/components/Icons';
import ErrorBoundary from '@/components/ErrorBoundary';
import OfflineStatusPill from '@/components/tech/OfflineStatusPill';
import TechPane from '@/components/tech/v2/TechPane.jsx';
import { SkeletonList } from '@/components/tech/v2/skeletons.jsx';
import { isStandaloneDisplay } from '@/lib/resumeRestore.js';
import { recordPwaDiagnostic } from '@/lib/pwaDiagnostics.js';
import { useTechConversations } from '@/pages/tech/v2/messages/useTechConversations.js';

// Tech Mobile v2 panes render PERSISTENTLY in the pane host below, outside the
// keyed <Outlet/>, so tab switches don't remount them.
const TechDashV2 = lazy(() => import('@/pages/tech/v2/TechDashV2.jsx'));
const TechScheduleV2 = lazy(() => import('@/pages/tech/v2/TechScheduleV2.jsx'));
// Tech Messages v2 (Phase F-M) — the dedicated messaging pane, behind
// page:tech_msgs_v2 on web (legacy Conversations remains the rollback surface).
const TechMessagesV2 = lazy(() => import('@/pages/tech/v2/TechMessagesV2.jsx'));

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

// eslint-disable-next-line no-unused-vars
function IconMoreDots({ filled, ...props }) {
  // Horizontal three-dots — solid in both active/inactive states
  // (active state is conveyed by the accent color pill behind it).
  // `filled` is accepted/ignored so render stays consistent with other tab icons.
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="5" cy="12" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <circle cx="19" cy="12" r="1.9" fill="currentColor" />
    </svg>
  );
}

/* ── Tab definitions ── */

const TABS = [
  { key: 'dash', label: 'Dash', path: '/tech', Icon: IconHome, exact: true },
  { key: 'claims', label: 'Claims', path: '/tech/claims', Icon: IconFolder },
  { key: 'schedule', label: 'Schedule', path: '/tech/schedule', Icon: IconCalendar },
  { key: 'messages', label: 'Messages', path: '/tech/conversations', Icon: IconChat },
  { key: 'more', label: 'More', path: '/tech/more', Icon: IconMoreDots },
];

/* ── Messages-tab unread badge (Phase F-M) ── */
// Mounted when Messages v2 is active, so the convos poll + realtime channel run
// only for that implementation. Reads unread_total from the shared
// useTechConversations hook (the sole convos-cache owner). NEVER gated on the pane
// being the active tab — a new-message badge matters most when the tech is elsewhere.
function MessagesUnreadBadge() {
  const { unreadTotal } = useTechConversations();
  if (!unreadTotal) return null;
  return (
    <span className="tv2-msgs-nav-badge" title={`${unreadTotal} unread`}>
      {unreadTotal > 99 ? '99+' : unreadTotal}
    </span>
  );
}

/* ── PWA Install Banner ── */

function InstallBanner() {
  const { t } = useTranslation('nav');
  const { employee } = useAuth();
  // Read display-mode + dismissed state once during render (client-only SPA) —
  // lazy init avoids a setState-in-effect cascade and a first-render banner flash.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!sessionStorage.getItem('pwa-dismissed');
    } catch {
      return false;
    }
  });
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(isStandaloneDisplay);

  // Android/Chrome: retain the install prompt. All platforms: stop advertising
  // once the browser confirms installation.
  useEffect(() => {
    const beforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const installed = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setDismissed(true);
      recordPwaDiagnostic('install', { section: 'installed' });
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (employee?.role !== 'field_tech') return null;
  if (isStandalone || dismissed) return null;

  const isIOS = /iPhone|iPad/.test(navigator.userAgent) && !window.navigator.standalone;
  const showAndroid = !!deferredPrompt;

  if (!isIOS && !showAndroid) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem('pwa-dismissed', '1');
    } catch {
      // Private/blocked storage still allows dismissal for this render.
    }
    setDismissed(true);
  };

  const install = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        recordPwaDiagnostic('install', {
          section: choice?.outcome === 'accepted' ? 'accepted' : 'dismissed',
        });
        setDeferredPrompt(null);
        if (choice?.outcome === 'accepted') dismiss();
      } catch (error) {
        recordPwaDiagnostic('install', { section: 'prompt-error', error });
      }
    }
  };

  return (
    <div
      role="region"
      aria-label={t('installRegionLabel')}
      style={{
      background: 'var(--accent)', color: 'var(--text-inverse)',
      padding: '10px var(--space-4)',
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 13, fontWeight: 500,
      fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ flex: 1 }}>
        <div>
          {isIOS
            ? <Trans t={t} i18nKey="installIos" components={{ b: <strong /> }} />
            : t('installBanner')
          }
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.35, marginTop: 3, opacity: 0.9 }}>
          {t('installOnlineRequired')}
        </div>
      </div>
      {showAndroid && (
        <button
          type="button"
          onClick={install}
          style={{
            background: 'var(--bg-elevated)', color: 'var(--accent)',
            border: 'none', borderRadius: 'var(--radius-md)',
            padding: '8px 14px', minHeight: 48, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0,
          }}
        >
          {t('installApp')}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismissInstall')}
        title={t('dismissInstall')}
        style={{
          background: 'none', border: 'none', color: 'var(--text-inverse)',
          cursor: 'pointer', padding: 8, minWidth: 44, minHeight: 44,
          fontSize: 18, lineHeight: 1,
          opacity: 0.8, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

/* ── TechLayout ── */

export default function TechLayout({ nativeBuild = false }) {
  const { t } = useTranslation('nav');
  const location = useLocation();
  const navType = useNavigationType(); // 'PUSH' | 'POP' | 'REPLACE' — drives slide direction
  const { employee, db, isFeatureEnabled } = useAuth();
  const [taskCount, setTaskCount] = useState(0);
  const [toasts, setToasts] = useState([]);

  // ── Tech v2 pane host ──
  // Dashboard and Schedule have no legacy implementation, so their retired
  // rollout flags must never blank these core routes. Messages retains its web
  // rollback; native excludes desktop Conversations and always mounts v2.
  const msgsV2 = nativeBuild
    || isFeatureEnabled('page:tech_msgs_v2');
  const dashActive = location.pathname === '/tech';
  const schedActive = location.pathname === '/tech/schedule';
  const msgsActive = msgsV2 && location.pathname === '/tech/conversations';
  const paneCovering = dashActive || schedActive || msgsActive;

  // COMPOSER-01. The tab bar must disappear while a message thread is open, or
  // the docked composer floats above it with its own safe-area padding as dead
  // space. That was expressed ONLY as
  //   .tech-layout:has(.tv2-msgs-pane:not([hidden]) .tv2-msgs-thread-open)
  // which asks WebKit to re-evaluate a :has() on the layout root when a class
  // changes several levels down. Measured on the simulator 2026-07-28: the same
  // deep link, run four times against one build, laid out correctly three times
  // and left the tab bar visible once — a style-invalidation race, not a code
  // path. Deriving it here from the URL makes it deterministic: React sets the
  // class on the element the rule matches, so there is nothing to invalidate.
  // The :has() rule is kept as a belt-and-braces fallback.
  const msgsThreadOpen = msgsActive
    && /[?&](c=[^&]|new=1)/.test(location.search);

  /* ── Global toast listener ── */
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
  }, [db, employee?.id]);

  const isActive = (tab) => {
    if (tab.exact) return location.pathname === tab.path;
    return location.pathname.startsWith(tab.path);
  };

  return (
    <div className={`tech-layout${msgsThreadOpen ? ' tech-layout--msgs-thread' : ''}`}>
      {/* v2 persistent panes (outside the keyed wrapper so they never remount). */}
      <TechPane active={dashActive}>
        <ErrorBoundary section="Technician dashboard">
          <Suspense fallback={<SkeletonList />}>
            <TechDashV2 active={dashActive} />
          </Suspense>
        </ErrorBoundary>
      </TechPane>
      <TechPane active={schedActive}>
        <ErrorBoundary section="Technician schedule">
          <Suspense fallback={<SkeletonList />}>
            <TechScheduleV2 active={schedActive} />
          </Suspense>
        </ErrorBoundary>
      </TechPane>
      {/* Messages pane (Phase F-M). TechMessagesV2 owns its two-layer TechMsgsPane
          host, so the hidden wrapper lives inside it — the Suspense fallback here
          mirrors that hidden .tv2-msgs-pane shell so a first-load chunk fetch on
          another tab never flashes a skeleton over the visible screen. */}
      {msgsV2 && (
        <ErrorBoundary section="Technician messages" hidden={!msgsActive}>
          <Suspense fallback={<div className="tv2-msgs-pane" hidden={!msgsActive} aria-hidden={!msgsActive}><SkeletonList rows={7} /></div>}>
            <TechMessagesV2 active={msgsActive} />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Legacy + detail routes: keyed by pathname so each navigation remounts +
          replays the 0.2s fade. Not rendered while a v2 pane covers the screen. */}
      {!paneCovering && (
        <div
          key={location.pathname}
          className={`tech-content tech-content--${navType === 'POP' ? 'back' : 'fwd'}`}
        >
          <Outlet />
        </div>
      )}

      {/* Legacy offline-state/reconciliation indicator — renders nothing when idle */}
      <div style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        right: 10,
        zIndex: 500,
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto' }}>
          <OfflineStatusPill />
        </div>
      </div>

      {/* MSG-01: the installed native app was telling technicians to install
          the app. InstallBanner's own gate is role + isStandaloneDisplay() +
          sessionStorage, and isStandaloneDisplay only checks
          matchMedia('(display-mode: standalone)') and navigator.standalone —
          neither is true in a Capacitor WKWebView — while the userAgent still
          matches /iPhone|iPad/. So it rendered, and the sessionStorage dismissal
          is per-webview-session, which is why it came back after every process
          restart. Guarded rather than deleted: the install strings, aria-label,
          48/44px targets and appinstalled diagnostics all still ship for the
          real PWA, and pwa-source-contract.test.js asserts they remain. */}
      {!nativeBuild && <InstallBanner />}
      <nav className="tech-nav">
        {TABS.map(tab => {
          const active = isActive(tab);
          const showDot = tab.key === 'more' && taskCount > 0;
          return (
            <Link
              key={tab.key}
              to={tab.path}
              viewTransition
              className={`tech-nav-tab${active ? ' active' : ''}`}
            >
              <tab.Icon filled={active} />
              {tab.key === 'messages' && msgsV2 && <MessagesUnreadBadge />}
              {showDot && (
                <span style={{
                  position: 'absolute', top: 4, right: '50%', marginRight: -16,
                  width: 8, height: 8, borderRadius: '50%',
                  background: '#ef4444',
                }} />
              )}
              <span>{t(tab.key, tab.label)}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Toast Notifications ── */}
      {toasts.length > 0 && (
        <div style={{position:'fixed',bottom:'calc(var(--tech-nav-height, 64px) + max(12px, env(safe-area-inset-bottom, 12px)) + 12px)',left:'50%',transform:'translateX(-50%)',zIndex:10000,display:'flex',flexDirection:'column-reverse',gap:10,alignItems:'center',pointerEvents:'none',width:'calc(100% - 32px)',maxWidth:420}}>
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
                  {toast.type==='error' ? '\u274C' : toast.type==='warning' ? '\u26A0\uFE0F' : '\u2705'}
                </span>
                <div style={{flex:1,minWidth:0}}>
                  {toast.title && <div style={{fontWeight:700,fontSize:14,color:'#0f172a',marginBottom:2}}>{toast.title}</div>}
                  <div style={{fontSize:13,color:'#334155',lineHeight:1.5,wordBreak:'break-word',overflow:'hidden',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical'}}>{toast.message}</div>
                </div>
                <button onClick={()=>setToasts(prev=>prev.filter(t=>t.id!==toast.id))}
                  style={{background:'none',border:'none',cursor:'pointer',fontSize:16,color:'#94a3b8',padding:0,flexShrink:0,lineHeight:1}}>{'\u2715'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}
