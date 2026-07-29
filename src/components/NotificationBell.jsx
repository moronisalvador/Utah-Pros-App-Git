/**
 * ════════════════════════════════════════════════
 * FILE: NotificationBell.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows a little bell icon in the sidebar. When something worth knowing about
 *   happens — right now, when a customer signs a document we sent them — a red
 *   number appears on the bell and a small pop-up message slides in. Clicking the
 *   bell opens a list of those alerts; clicking one takes you to the related job
 *   and marks it as read.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (mounted in the sidebar, shows on every office/admin page)
 *   Rendered by:  src/components/Sidebar.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (subscribeToNotifications),
 *              @/hooks/useResumeRefetch (hidden-guarded poll + resume edge),
 *              @/components/ui (IconButton press/a11y/haptic contract),
 *              @/components/TabLoading, @/lib/nativeHaptics, @/lib/toast
 *   Data:      reads  → notifications (via get_notifications / get_unread_notification_count RPCs)
 *              writes → notifications (via mark_notification_read / mark_all_notifications_read RPCs)
 *
 * NOTES / GOTCHAS:
 *   - The feed is PER-RECIPIENT since F2: the bell passes the current employee id
 *     to the RPCs, so each person sees broadcast rows (recipient_id IS NULL) plus
 *     the rows aimed at them, with their own read state. A NULL employee id (not
 *     yet loaded) sees broadcast-only.
 *   - Live updates come from a Supabase realtime subscription on the notifications
 *     table; a 60s poll is the fallback if the socket drops. A row targeted at a
 *     DIFFERENT employee is ignored (no count bump, no toast) — realtime delivers
 *     every insert, so the client filters. Broadcast/own rows fire a `upr:toast`.
 *   - The poll runs through useResumeRefetch, which skips it while the tab is
 *     hidden (page-lifecycle.md §4) and fires once on the hidden→visible edge.
 *     It also BACKS OFF on repeated failures: this poll was the app's loudest
 *     failure mode — with a dead session it logged a 401 a minute all night into
 *     a silent catch. Recovery now lives in stableDb.js/AuthContext; the backoff
 *     here just stops the noise when the session is truly unrecoverable.
 *   - `triggerClassName` styles the trigger button with a host's own class (the
 *     tech dashboard passes `tv2-dash-header__icon-btn` so the bell matches the
 *     Help/menu buttons sitting beside it). Omit it and the office inline style
 *     (36px, transparent) is used.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToNotifications } from '@/lib/realtime';
import { linkForCurrentShell } from '@/lib/techShellRoutes';
import { impact } from '@/lib/nativeHaptics';
import { err, toast } from '@/lib/toast';
import useResumeRefetch from '@/hooks/useResumeRefetch';
import { IconButton } from '@/components/ui';
import TabLoading from '@/components/TabLoading';

// Poll backoff: after a failure the count is worth far less than the noise of
// retrying it every minute forever. Doubles per consecutive failure from the
// base 60s tick, capped at 30 min; any success resets it to zero.
const POLL_MS = 60000;
const BACKOFF_CAP_MS = 30 * 60 * 1000;

function IconBell(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationBell({
  active = true,
  align = 'left',
  triggerClassName,
}) {
  const { db, employee } = useAuth();
  const native = Capacitor.isNativePlatform();
  const location = useLocation();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const dbRef = useRef(db);
  dbRef.current = db; // always call through the latest db client (survives token refresh)
  const empRef = useRef(employee?.id);
  empRef.current = employee?.id; // latest recipient id for callbacks (survives reloads)

  // ─── SECTION: State & hooks ───
  const [open, setOpen] = useState(false);
  const [panelPresent, setPanelPresent] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [markAllPending, setMarkAllPending] = useState(false);
  const openRef = useRef(false);
  const hasLoadedListRef = useRef(false);
  const listRequestRef = useRef(0);
  const restoreFocusRef = useRef(false);
  const priorPathRef = useRef(location.pathname);

  // Consecutive-failure state for the poll backoff (refs — these change between
  // renders but nothing on screen depends on them, so they must not re-render).
  const failStreakRef = useRef(0);
  const nextAttemptRef = useRef(0);

  const loadCount = useCallback(async () => {
    try {
      const n = await dbRef.current.rpc('get_unread_notification_count', { p_employee_id: empRef.current });
      setUnread(typeof n === 'number' ? n : (Array.isArray(n) ? n[0] : 0) || 0);
      failStreakRef.current = 0;
      nextAttemptRef.current = 0;
    } catch {
      // Non-fatal — the bell just won't show a count. A 401 has already been
      // through AuthContext's recovery by this point (stableDb.js), so reaching
      // here means it could not be fixed: back off instead of retrying blindly.
      failStreakRef.current += 1;
      nextAttemptRef.current = Date.now()
        + Math.min(POLL_MS * 2 ** failStreakRef.current, BACKOFF_CAP_MS);
    }
  }, []);

  // The polled entry point — same load, gated by the backoff window.
  const pollCount = useCallback(() => {
    if (Date.now() < nextAttemptRef.current) return;
    loadCount();
  }, [loadCount]);

  const loadList = useCallback(async ({ silent = false } = {}) => {
    const request = listRequestRef.current + 1;
    listRequestRef.current = request;
    const preserveList = silent && hasLoadedListRef.current;
    if (!preserveList) {
      setLoading(true);
      setListError(false);
    }
    try {
      const rows = await dbRef.current.rpc('get_notifications', { p_limit: 30, p_employee_id: empRef.current });
      if (request !== listRequestRef.current) return;
      setItems(rows || []);
      hasLoadedListRef.current = true;
      setListError(false);
    } catch {
      if (request !== listRequestRef.current) return;
      // A failed load must NOT fall through to the success empty-state
      // (loading-error-states.md §1). "No notifications yet" on a dead session
      // is the exact lie this whole change exists to stop telling.
      if (!preserveList) {
        setItems([]);
        setListError(true);
      }
    } finally {
      if (request === listRequestRef.current) setLoading(false);
    }
  }, []);

  // Initial count (re-runs once the employee id arrives). Deliberately NOT gated
  // by the backoff — a mount or a new employee id is a fresh reason to try.
  useEffect(() => {
    failStreakRef.current = 0;
    nextAttemptRef.current = 0;
    loadCount();
  }, [loadCount, employee?.id]);

  // 60s poll fallback for a dropped realtime socket, plus one refresh when the
  // tab comes back. useResumeRefetch owns the document.hidden guard and the
  // hidden→visible edge (page-lifecycle.md §2/§4) — never hand-roll a
  // visibilitychange listener here. Realtime bumps and opening the bell call
  // loadCount directly, so they bypass the backoff window on purpose.
  const refreshOnResume = useCallback(() => {
    pollCount();
  }, [pollCount]);
  useResumeRefetch({ pollMs: POLL_MS, onResume: refreshOnResume });

  // Realtime: bump count, refresh the open list, and fire a live toast — but
  // ignore rows targeted at a different employee (realtime delivers every insert).
  useEffect(() => {
    const unsub = subscribeToNotifications((payload) => {
      const row = payload?.new;
      if (row && row.recipient_id && row.recipient_id !== empRef.current) return;
      loadCount();
      if (openRef.current) loadList({ silent: true });
      if (row) {
        toast(row.body ? `${row.title}: ${row.body}` : row.title, 'info');
      }
    });
    return unsub;
  }, [loadCount, loadList]);

  const finishClose = useCallback(() => {
    setPanelPresent(false);
    if (restoreFocusRef.current) triggerRef.current?.focus();
    restoreFocusRef.current = false;
  }, []);

  const closePanel = useCallback(({ restoreFocus = true } = {}) => {
    openRef.current = false;
    setOpen(false);
    restoreFocusRef.current = restoreFocus;
    if (!native) finishClose();
  }, [finishClose, native]);

  // Native exit motion keeps the panel mounted briefly. Reduced-motion users
  // skip the wait, and the timeout is a safety net if animationend is lost.
  useEffect(() => {
    if (!native || !panelPresent || open) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(finishClose, reduced ? 0 : 160);
    return () => window.clearTimeout(timer);
  }, [finishClose, native, open, panelPresent]);

  // The dashboard pane remains mounted behind other tech tabs. Close its bell
  // as soon as the pane deactivates so it cannot reappear on return.
  useEffect(() => {
    if (!active && panelPresent) closePanel({ restoreFocus: false });
  }, [active, closePanel, panelPresent]);

  // Close on navigation without stealing focus from the newly routed screen.
  useEffect(() => {
    if (priorPathRef.current !== location.pathname && panelPresent) {
      closePanel({ restoreFocus: false });
    }
    priorPathRef.current = location.pathname;
  }, [closePanel, location.pathname, panelPresent]);

  // Native click-away listens in capture without swallowing the underlying
  // tab/button tap. The office/PWA keeps its existing backdrop behavior.
  useEffect(() => {
    if (!native || !panelPresent) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        closePanel({ restoreFocus: false });
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [closePanel, native, panelPresent]);

  useEffect(() => {
    if (!native || !panelPresent) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closePanel, native, panelPresent]);

  useEffect(() => {
    if (!native || !open || !panelPresent) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const firstAction = panelRef.current?.querySelector('button');
      (firstAction || panelRef.current)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [native, open, panelPresent]);

  // ─── SECTION: Event handlers ───
  const toggle = () => {
    const next = !openRef.current;
    openRef.current = next;
    setOpen(next);
    if (next) {
      setPanelPresent(true);
      // A deliberate open is a fresh attempt: clear any backoff window so the
      // count retries immediately alongside the list.
      failStreakRef.current = 0;
      nextAttemptRef.current = 0;
      loadList({ silent: hasLoadedListRef.current });
      loadCount();
    } else {
      closePanel();
    }
  };

  const openItem = async (item) => {
    impact('light');
    closePanel({ restoreFocus: false });
    if (!item.read_at) {
      const priorUnread = unread;
      const priorItems = items;
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      try {
        await dbRef.current.rpc('mark_notification_read', { p_id: item.id });
      } catch {
        setUnread(priorUnread);
        setItems(priorItems);
        err('Could not mark that notification as read.');
      }
    }
    // Keep the tap in the shell the user is standing in. This bell is mounted in
    // the field dash header as well as the office nav, and notification links are
    // stored as office paths — so without this, someone working out of the field
    // PWA (admins and supervisors do) gets thrown into the office inbox. Role-based
    // routing in App.jsx cannot cover them, because they are not field_tech.
    if (item.link) navigate(linkForCurrentShell(item.link, window.location.pathname));
  };

  const markAll = async () => {
    if (markAllPending) return;
    impact('light');
    const priorUnread = unread;
    const priorItems = items;
    setMarkAllPending(true);
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    try {
      await dbRef.current.rpc('mark_all_notifications_read', { p_employee_id: empRef.current });
    } catch {
      setUnread(priorUnread);
      setItems(priorItems);
      err('Could not mark all notifications as read.');
    } finally {
      setMarkAllPending(false);
    }
  };

  const retryList = () => {
    impact('light');
    loadList();
  };

  // ─── SECTION: Render ───
  return (
    <div ref={rootRef} className="notification-bell" style={{ position: 'relative' }}>
      <IconButton
        ref={triggerRef}
        onClick={toggle}
        label="Notifications"
        aria-expanded={open}
        aria-controls="notification-bell-panel"
        size={triggerClassName ? 'lg' : undefined}
        className={triggerClassName || undefined}
        data-active={triggerClassName ? (open ? 'true' : undefined) : undefined}
        style={triggerClassName
          ? {
              position: 'relative',
              borderRadius: 'var(--tech-radius-button)',
              border: `1px solid ${open ? 'var(--accent)' : 'var(--border-light)'}`,
              background: open ? 'var(--accent-light)' : 'var(--bg-tertiary)',
              color: open ? 'var(--accent)' : 'var(--text-secondary)',
            }
          : {
              position: 'relative',
              background: open ? 'var(--bg-tertiary)' : 'transparent',
            }}
      >
        <IconBell style={{ width: triggerClassName ? 20 : 19, height: triggerClassName ? 20 : 19 }} />
        {unread > 0 && (
          <span className="notification-bell__badge" style={{
            position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 'var(--radius-full)', background: 'var(--danger)', color: 'var(--text-inverse)',
            fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
            boxShadow: '0 0 0 2px var(--bg-primary)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </IconButton>

      {panelPresent && (
        <>
          {/* click-away backdrop */}
          {!native && (
            <div
              className="notification-bell__backdrop"
              onClick={() => closePanel()}
              style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            />
          )}
          <div
            id="notification-bell-panel"
            ref={panelRef}
            className="notification-bell__panel"
            data-state={open ? 'open' : 'closing'}
            role="dialog"
            aria-modal="false"
            aria-labelledby="notification-bell-title"
            tabIndex={-1}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget && !open) finishClose();
            }}
            style={{
            position: 'fixed', top: 56, [align === 'right' ? 'right' : 'left']: 12, width: 340, maxWidth: 'calc(100vw - 24px)',
            maxHeight: '70vh', display: 'flex', flexDirection: 'column', zIndex: 9999,
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', overflow: 'hidden',
            }}
          >
            <div className="notification-bell__header">
              <span className="notification-bell__heading">
                <span id="notification-bell-title" className="notification-bell__title">Notifications</span>
                <span className="notification-bell__subtitle">Recent updates</span>
              </span>
              {unread > 0 && (
                <button className="notification-bell__mark-all" disabled={markAllPending} onClick={markAll}>
                  {markAllPending ? 'Marking…' : 'Mark all read'}
                </button>
              )}
            </div>

            <div className="notification-bell__list">
              {loading && !hasLoadedListRef.current ? (
                <TabLoading label="Loading notifications…" />
              ) : listError ? (
                <div className="notification-bell__state">
                  <div className="notification-bell__error-title">Couldn't load notifications</div>
                  <button
                    className="notification-bell__retry"
                    onClick={retryList}
                  >
                    Try again
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="notification-bell__state notification-bell__state--empty">
                  No notifications yet
                </div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    className="notification-bell__item"
                    data-unread={item.read_at ? undefined : 'true'}
                    onClick={() => openItem(item)}
                  >
                    <span className="notification-bell__indicator" aria-hidden="true" />
                    <span className="notification-bell__copy">
                      <span className="notification-bell__item-title">{item.title}</span>
                      {item.body && (
                        <span className="notification-bell__body">{item.body}</span>
                      )}
                      <span className="notification-bell__time">{timeAgo(item.created_at)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
