/**
 * ════════════════════════════════════════════════
 * FILE: StatusBoard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The live "who's working right now" board on the Time Tracking page. It lists
 *   every field tech with a colored status (on the way / on site / paused /
 *   scheduled / idle), how long they've been in that state, their current job and
 *   address, and their next appointment. It refreshes itself every 30 seconds.
 *   Office admins can also clock a tech out or fix their clock-in time right from
 *   a row, without leaving the board.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /time-tracking (the "Status Board" tab)
 *   Rendered by:  src/pages/TimeTracking.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext
 *   Data:      reads  → get_tech_status_board RPC, job_time_entries (open clocks)
 *              writes → job_time_entries via admin_clock_out_entry +
 *                        admin_upsert_time_entry RPCs (admin-only, SECURITY DEFINER)
 *
 * NOTES / GOTCHAS:
 *   - The board RPC doesn't carry the open time-entry id, so we fetch the open LIVE
 *     entries (clock_out null AND travel_start not null) separately and map them by
 *     employee_id — there's at most one per employee (single-open invariant).
 *   - Clock-out / edit actions only render for admin-tier viewers AND only on rows
 *     that actually have an open clock. "Edit in" appears once a tech is on site
 *     (clock_in set); an OMW-only entry can be clocked out but has no clock-in yet.
 *   - All writes go through SECURITY DEFINER RPCs (admin_clock_out_entry /
 *     admin_upsert_time_entry); errors are P0001 codes — see friendlyErr().
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { liveClockMinutes, fmtMins } from '@/lib/clockTime';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

const ADMIN_ROLES = ['admin', 'office', 'project_manager', 'supervisor'];
const tnum = { fontVariantNumeric: 'tabular-nums' };

// Status → colors. Uses existing --status-* tokens where defined; falls back to inline hex.
const STATUS_META = {
  paused:    { label: 'Paused',    bg: '#fef2f2', color: '#dc2626', border: '#fecaca', order: 1 },
  on_site:   { label: 'On site',   bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', order: 2 },
  omw:       { label: 'OMW',       bg: '#fffbeb', color: '#d97706', border: '#fde68a', order: 3 },
  scheduled: { label: 'Scheduled', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', order: 4 },
  idle:      { label: 'Idle',      bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'var(--border-color)', order: 5 },
};

const FILTER_ORDER = ['omw', 'on_site', 'paused', 'scheduled', 'idle'];

// ─── SECTION: Helpers ──────────────
function fmtAppt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// timestamptz <-> <input type="datetime-local"> (browser-local; office runs in Denver)
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function localInputToIso(v) {
  return v ? new Date(v).toISOString() : null;
}
function friendlyErr(msg = '') {
  if (/BAD_ORDER/.test(msg))            return 'Times are out of order (travel ≤ clock in ≤ clock out).';
  if (/ALREADY_CLOSED/.test(msg))       return 'This entry is already clocked out — refreshing.';
  if (/ENTRY_APPROVED_LOCKED/.test(msg))return 'This entry is approved — unapprove it on the Timesheet first.';
  if (/NOT_AUTHORIZED/.test(msg))       return "You don't have permission to do that.";
  if (/ENTRY_NOT_FOUND/.test(msg))      return 'That entry no longer exists — refreshing.';
  return msg.replace(/^RPC [^:]+:\s*/, '');
}

export default function StatusBoard() {
  const { db, employee } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(employee?.role);
  const [rows, setRows] = useState([]);
  const [openClocks, setOpenClocks] = useState({}); // employee_id → { id, clock_in, travel_start }
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tick, setTick] = useState(0); // re-render every 60s to refresh durations
  const pollRef = useRef(null);

  // action state
  const [confirmOut, setConfirmOut] = useState(null); // employee_id awaiting 2nd click
  const [editing, setEditing] = useState(null);       // employee_id whose clock-in is being edited
  const [editVal, setEditVal] = useState('');
  const [busy, setBusy] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const loadOpenClocks = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const rows = await db.select(
        'job_time_entries',
        'clock_out=is.null&travel_start=not.is.null&select=id,employee_id,clock_in,travel_start&order=created_at.desc'
      );
      const map = {};
      for (const r of (rows || [])) { if (!map[r.employee_id]) map[r.employee_id] = r; }
      setOpenClocks(map);
    } catch { /* additive — never block the board */ }
  }, [db, isAdmin]);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await db.rpc('get_tech_status_board');
      setRows(data || []);
      setLastUpdate(new Date());
      loadOpenClocks();
    } catch {
      errToast('Failed to load status board');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [db, loadOpenClocks]);

  // Initial load + 30s poll
  useEffect(() => {
    load(true);
    pollRef.current = setInterval(() => load(false), 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Tick every 60s so "2h 15m" duration labels update without a full refetch
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // ─── SECTION: Event handlers ──────────────
  const handleClockOut = async (r) => {
    if (confirmOut !== r.employee_id) { setConfirmOut(r.employee_id); return; }
    setConfirmOut(null);
    const open = openClocks[r.employee_id];
    if (!open) { errToast('No open clock found — refreshing'); load(false); return; }
    setBusy(true);
    try {
      await db.rpc('admin_clock_out_entry', { p_id: open.id, p_actor_id: employee?.id });
      okToast(`${r.full_name} clocked out`);
      await load(false);
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  const startEdit = (r) => {
    const open = openClocks[r.employee_id];
    if (!open) return;
    setEditing(r.employee_id);
    setEditVal(isoToLocalInput(open.clock_in));
  };
  const saveEdit = async (r) => {
    const open = openClocks[r.employee_id];
    if (!open) { setEditing(null); return; }
    const iso = localInputToIso(editVal);
    if (!iso) { errToast('Pick a clock-in time'); return; }
    setBusy(true);
    try {
      await db.rpc('admin_upsert_time_entry', { p_actor_id: employee?.id, p_id: open.id, p_clock_in: iso });
      okToast(`${r.full_name}'s clock-in updated`);
      setEditing(null);
      await load(false);
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const c = { omw: 0, on_site: 0, paused: 0, scheduled: 0, idle: 0 };
    for (const r of rows) if (c[r.status] != null) c[r.status] += 1;
    return c;
  }, [rows]);

  const divisions = useMemo(() => {
    const set = new Set();
    for (const r of rows) if (r.division) set.add(r.division);
    return Array.from(set).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (divisionFilter !== 'all' && r.division !== divisionFilter) return false;
      return true;
    });
  }, [rows, filter, divisionFilter]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        Loading status board…
      </div>
    );
  }

  const now = Date.now();
  const cols = isAdmin
    ? '1.3fr 92px 1.4fr 1.4fr 64px 64px 70px 104px 188px'
    : '1.4fr 100px 1.6fr 1.6fr 66px 66px 74px 118px';

  // ─── SECTION: Render ──────────────
  return (
    <div style={{ paddingBottom: 40 }} data-tick={tick}>
      {/* Header: counts as clickable filter pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 0 16px' }}>
        <FilterPill label="All" count={rows.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        {FILTER_ORDER.map(key => (
          <FilterPill
            key={key}
            label={STATUS_META[key].label}
            count={counts[key]}
            active={filter === key}
            color={STATUS_META[key].color}
            bg={STATUS_META[key].bg}
            border={STATUS_META[key].border}
            onClick={() => setFilter(filter === key ? 'all' : key)}
          />
        ))}

        <div style={{ flex: 1 }} />

        {divisions.length > 0 && (
          <select value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)} className="input" style={{ height: 32, fontSize: 13, minWidth: 140 }}>
            <option value="all">All divisions</option>
            {divisions.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
          </select>
        )}

        {lastUpdate && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Updated {lastUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden', background: 'var(--bg-primary)' }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: cols, padding: '8px 16px',
          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
          fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          <div>Technician</div>
          <div>Status</div>
          <div>Job / Client</div>
          <div>Address</div>
          <div style={{ textAlign: 'right' }}>Travel</div>
          <div style={{ textAlign: 'right' }}>On site</div>
          <div style={{ textAlign: 'right' }}>Total</div>
          <div>Next appt</div>
          {isAdmin && <div style={{ textAlign: 'right' }}>Actions</div>}
        </div>

        {visibleRows.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            {filter === 'all' ? 'No technicians match the current filters.' : `No technicians are currently ${STATUS_META[filter]?.label.toLowerCase() || filter}.`}
          </div>
        )}

        {visibleRows.map((r, i) => {
          const meta = STATUS_META[r.status] || STATUS_META.idle;
          const isLast = i === visibleRows.length - 1;
          const open = openClocks[r.employee_id];
          const t = r.travel_start ? liveClockMinutes(r, now) : null;
          return (
            <div key={r.employee_id} style={{
              display: 'grid', gridTemplateColumns: cols, alignItems: 'center', padding: '12px 16px',
              borderBottom: isLast ? 'none' : '1px solid var(--border-light)', background: 'var(--bg-primary)', fontSize: 13,
            }}>
              {/* Tech name + division */}
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.full_name}</div>
                {r.default_division && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize', marginTop: 2 }}>{r.default_division}</div>
                )}
              </div>

              {/* Status pill */}
              <div>
                <span style={{
                  display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '3px 10px',
                  borderRadius: 'var(--radius-full)', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
                }}>{meta.label}</span>
              </div>

              {/* Job / Client */}
              <div style={{ minWidth: 0 }}>
                {r.job_id ? (
                  <a href={`/jobs/${r.job_id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none', display: 'block' }}>
                    <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.job_number || '—'}</div>
                    {r.client_name && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.client_name}</div>
                    )}
                  </a>
                ) : (<span style={{ color: 'var(--text-tertiary)' }}>—</span>)}
              </div>

              {/* Address */}
              <div style={{ minWidth: 0 }}>
                {r.address ? (
                  <a href={mapsUrl(r.address)} target="_blank" rel="noopener noreferrer" title={r.address}
                    style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.address}
                  </a>
                ) : (<span style={{ color: 'var(--text-tertiary)' }}>—</span>)}
              </div>

              {/* Travel / On site / Total (Total = travel + on-site = real labor cost) */}
              <div style={{ textAlign: 'right', color: 'var(--text-secondary)', ...tnum }}>{t ? fmtMins(t.travel) : '—'}</div>
              <div style={{ textAlign: 'right', color: 'var(--text-secondary)', ...tnum }}>{t && r.clock_in ? fmtMins(t.onSite) : '—'}</div>
              <div style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', ...tnum }}>{t ? fmtMins(t.total) : '—'}</div>

              {/* Next appt */}
              <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {r.next_appt_time ? (
                  <>
                    <div>{fmtAppt(r.next_appt_time)}</div>
                    {r.next_appt_title && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.next_appt_title}</div>
                    )}
                  </>
                ) : (<span style={{ color: 'var(--text-tertiary)' }}>—</span>)}
              </div>

              {/* Actions (admin only, rows with an open clock) */}
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {!open ? (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>—</span>
                  ) : editing === r.employee_id ? (
                    <>
                      <input type="datetime-local" className="input" value={editVal} autoFocus
                        onChange={e => setEditVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(r); if (e.key === 'Escape') setEditing(null); }}
                        style={{ height: 30, fontSize: 12, padding: '2px 6px', width: 158 }} />
                      <button onClick={() => saveEdit(r)} disabled={busy} title="Save clock-in"
                        style={btnStyle('#2563eb', '#fff', '#2563eb')}>Save</button>
                      <button onClick={() => setEditing(null)} disabled={busy} title="Cancel"
                        style={btnStyle('var(--bg-primary)', 'var(--text-secondary)', 'var(--border-color)')}>✕</button>
                    </>
                  ) : (
                    <>
                      {open.clock_in && (
                        <button onClick={() => startEdit(r)} disabled={busy} title="Edit clock-in time"
                          style={btnStyle('var(--bg-primary)', 'var(--text-secondary)', 'var(--border-color)')}>
                          Edit in
                        </button>
                      )}
                      <button onClick={() => handleClockOut(r)} onBlur={() => setConfirmOut(null)} disabled={busy}
                        title={confirmOut === r.employee_id ? 'Click again to confirm' : 'Clock out'}
                        style={confirmOut === r.employee_id
                          ? btnStyle('#fef2f2', '#dc2626', '#fecaca')
                          : btnStyle('var(--bg-primary)', 'var(--text-primary)', 'var(--border-color)')}>
                        {confirmOut === r.employee_id ? 'Confirm' : 'Clock out'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function btnStyle(bg, color, border) {
  return {
    fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', padding: '5px 10px',
    borderRadius: 'var(--radius-md)', background: bg, color, border: `1px solid ${border}`,
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 120ms',
  };
}

function FilterPill({ label, count, active, color, bg, border, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderRadius: 'var(--radius-full)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        background: active ? (bg || 'var(--accent-light)') : 'var(--bg-primary)',
        color: active ? (color || 'var(--accent)') : 'var(--text-secondary)',
        border: `1px solid ${active ? (border || 'var(--accent)') : 'var(--border-color)'}`,
        transition: 'all 120ms',
      }}
    >
      <span>{label}</span>
      <span style={{
        fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-full)',
        background: active ? 'rgba(255,255,255,0.5)' : 'var(--bg-tertiary)',
        color: active ? (color || 'var(--accent)') : 'var(--text-tertiary)',
      }}>
        {count}
      </span>
    </button>
  );
}
