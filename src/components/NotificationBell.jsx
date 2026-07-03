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
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (subscribeToNotifications)
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
 *   - `triggerClassName` styles the trigger button with a host's own class (the
 *     tech dashboard passes `tv2-dash-header__icon-btn` so the bell matches the
 *     Help/menu buttons sitting beside it). Omit it and the office inline style
 *     (36px, transparent) is used.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToNotifications } from '@/lib/realtime';

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

export default function NotificationBell({ align = 'left', triggerClassName }) {
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const dbRef = useRef(db);
  dbRef.current = db; // always call through the latest db client (survives token refresh)
  const empRef = useRef(employee?.id);
  empRef.current = employee?.id; // latest recipient id for callbacks (survives reloads)

  // ─── SECTION: State & hooks ───
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const loadCount = useCallback(async () => {
    try {
      const n = await dbRef.current.rpc('get_unread_notification_count', { p_employee_id: empRef.current });
      setUnread(typeof n === 'number' ? n : (Array.isArray(n) ? n[0] : 0) || 0);
    } catch { /* non-fatal — bell just won't show a count */ }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await dbRef.current.rpc('get_notifications', { p_limit: 30, p_employee_id: empRef.current });
      setItems(rows || []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  // Initial count + 60s poll fallback (re-runs once the employee id arrives)
  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 60000);
    return () => clearInterval(t);
  }, [loadCount, employee?.id]);

  // Realtime: bump count, refresh the open list, and fire a live toast — but
  // ignore rows targeted at a different employee (realtime delivers every insert).
  useEffect(() => {
    const unsub = subscribeToNotifications((payload) => {
      const row = payload?.new;
      if (row && row.recipient_id && row.recipient_id !== empRef.current) return;
      loadCount();
      setOpen((isOpen) => { if (isOpen) loadList(); return isOpen; });
      if (row) {
        window.dispatchEvent(new CustomEvent('upr:toast', {
          detail: { title: row.title, message: row.body || '', type: 'info' },
        }));
      }
    });
    return unsub;
  }, [loadCount, loadList]);

  // ─── SECTION: Event handlers ───
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const openItem = async (item) => {
    setOpen(false);
    if (!item.read_at) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      try { await dbRef.current.rpc('mark_notification_read', { p_id: item.id }); } catch { /* non-fatal */ }
    }
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    try { await dbRef.current.rpc('mark_all_notifications_read', { p_employee_id: empRef.current }); } catch { /* non-fatal */ }
  };

  // ─── SECTION: Render ───
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={toggle}
        title="Notifications"
        aria-label="Notifications"
        className={triggerClassName || undefined}
        data-active={triggerClassName ? (open ? 'true' : undefined) : undefined}
        style={triggerClassName
          ? { position: 'relative' }
          : {
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 'var(--radius-md)', border: 'none',
              background: open ? 'var(--bg-tertiary)' : 'transparent', color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
      >
        <IconBell style={{ width: triggerClassName ? 20 : 19, height: triggerClassName ? 20 : 19 }} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 'var(--radius-full)', background: '#ef4444', color: '#fff',
            fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
            boxShadow: '0 0 0 2px var(--bg-primary)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: 56, [align === 'right' ? 'right' : 'left']: 12, width: 340, maxWidth: 'calc(100vw - 24px)',
            maxHeight: '70vh', display: 'flex', flexDirection: 'column', zIndex: 9999,
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: '1px solid var(--border-light)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Notifications</span>
              {unread > 0 && (
                <button onClick={markAll} style={{
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, color: 'var(--accent)',
                }}>
                  Mark all read
                </button>
              )}
            </div>

            <div style={{ overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>Loading…</div>
              ) : items.length === 0 ? (
                <div style={{ padding: '32px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>
                  No notifications yet
                </div>
              ) : (
                items.map((item, i) => (
                  <button
                    key={item.id}
                    onClick={() => openItem(item)}
                    style={{
                      display: 'flex', gap: 10, width: '100%', textAlign: 'left',
                      padding: '11px 14px', border: 'none', cursor: 'pointer',
                      borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--border-light)',
                      background: item.read_at ? 'var(--bg-primary)' : 'var(--accent-light)',
                    }}
                  >
                    <span style={{
                      flexShrink: 0, marginTop: 5, width: 7, height: 7, borderRadius: '50%',
                      background: item.read_at ? 'transparent' : 'var(--accent)',
                    }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</span>
                      {item.body && (
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 1, lineHeight: 1.4 }}>{item.body}</span>
                      )}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>{timeAgo(item.created_at)}</span>
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
