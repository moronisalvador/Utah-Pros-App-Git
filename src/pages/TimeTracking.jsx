/**
 * ════════════════════════════════════════════════
 * FILE: TimeTracking.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The office "Time Tracking" page. It shows everyone's clock-in/clock-out
 *   time entries so the office can review, fix, approve, and pay them. Admins
 *   can edit any entry right in the table, add or delete entries, clock people
 *   out, and approve hours in bulk. There's a "Requests" area where the office
 *   reviews edit requests that field techs submit from their phones, and a
 *   payroll/by-job summary. A field tech who opens this page only sees their
 *   own entries and can ask for a change instead of editing directly.
 *
 * WHERE IT LIVES:
 *   Route:        /time-tracking (feature flag: page:time_tracking)
 *   Rendered by:  src/App.jsx route
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/components/StatusBoard, @/lib/realtime
 *   Data:      reads  → job_time_entries, time_entry_change_requests, employees,
 *                        jobs (via RPCs get_timesheet_entries_admin /
 *                        get_job_labor_summary / get_payroll_summary)
 *              writes → job_time_entries + time_entry_change_requests
 *                        (only through admin_* / *_time_entry RPCs — never direct PostgREST)
 *
 * NOTES / GOTCHAS:
 *   - total_cost is a GENERATED column — never written here; the RPCs set
 *     hours/travel_minutes/rate and Postgres recomputes cost.
 *   - All writes go through SECURITY DEFINER RPCs (admin_upsert_time_entry,
 *     admin_clock_out_entry, delete_time_entry, approve_time_entries,
 *     submit/review_time_entry_change_request). RPC errors are P0001 with a
 *     code string in the message — see friendlyErr() for the substring map.
 *   - admin_upsert_time_entry COALESCEs every field with the existing row, so a
 *     partial update (actor + id + one changed param) safely keeps the rest.
 *   - Inline edits are blocked on approved rows; use "Unapprove & edit".
 *   - Realtime is wired straight to realtimeClient (realtime.js is left untouched).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import StatusBoard from '@/components/StatusBoard';
import { realtimeClient } from '@/lib/realtime';

const BOARD_ROLES = ['admin', 'project_manager', 'supervisor'];
// Admin-tier mirrors is_time_admin() server-side (estimator + field_tech excluded).
const ADMIN_ROLES = ['admin', 'office', 'project_manager', 'supervisor'];

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

// ─── SECTION: Helpers ──────────────
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function getWeekBounds(offsetWeeks = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toISO(monday), end: toISO(sunday) };
}
function getMonthBounds(offsetMonths = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const last  = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  return { start: toISO(first), end: toISO(last) };
}
// Semi-monthly payroll period: 1st–15th or 16th–EOM. offset counts half-months back.
function getSemiMonthlyBounds(offset = 0) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let idx = (now.getDate() <= 15 ? 0 : 1) + offset; // 0 = first half, 1 = second half
  while (idx < 0)  { month--; if (month < 0)  { month = 11; year--; } idx += 2; }
  while (idx > 1)  { month++; if (month > 11) { month = 0;  year++; } idx -= 2; }
  if (idx === 0) return { start: toISO(new Date(year, month, 1)),  end: toISO(new Date(year, month, 15)) };
  return            { start: toISO(new Date(year, month, 16)), end: toISO(new Date(year, month + 1, 0)) };
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m)-1, Number(d))
    .toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
}
function fmtHours(h) {
  if (h == null || h === '') return '—';
  const n = Number(h);
  if (isNaN(n)) return '—';
  const hrs = Math.floor(n);
  const mins = Math.round((n - hrs) * 60);
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}
function fmtCost(v) {
  if (v == null || Number(v) === 0) return '—';
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
}
function fmtMoney(v) {
  if (v == null) return '$0.00';
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
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
// Map RPC P0001 codes (carried in Error.message) to plain-English toasts.
function friendlyErr(msg = '') {
  if (/OPEN_ENTRY_EXISTS|23505/.test(msg))        return 'That employee already has an open clock entry — close it first.';
  if (/ENTRY_APPROVED_LOCKED/.test(msg))          return 'This entry is approved — unapprove it before editing.';
  if (/ENTRY_APPROVED_CANNOT_DELETE/.test(msg))   return "Approved entries can't be deleted — unapprove first.";
  if (/BAD_ORDER/.test(msg))                      return 'Times are out of order (travel ≤ clock in ≤ on-site end ≤ clock out).';
  if (/MISSING_REQUIRED_FIELDS/.test(msg))        return 'Employee and job are required.';
  if (/ALREADY_CLOSED/.test(msg))                 return 'This entry is already clocked out.';
  if (/NOT_AUTHORIZED/.test(msg))                 return "You don't have permission to do that.";
  if (/NOT_OWNER/.test(msg))                      return 'You can only request changes to your own entries.';
  if (/REQUEST_ALREADY_REVIEWED/.test(msg))       return 'That request was already reviewed.';
  if (/ENTRY_NOT_FOUND|REQUEST_NOT_FOUND/.test(msg)) return 'That record no longer exists — refreshing.';
  return msg.replace(/^RPC [^:]+:\s*/, '');
}

const DIVISION_COLORS = {
  water:'#2563eb', mold:'#9d174d', reconstruction:'#d97706',
  fire:'#dc2626', contents:'#059669', general:'#6b7280',
};
const DIVISIONS = ['water','mold','reconstruction','fire','contents','general'];
const WORK_TYPES = ['regular','field','travel','overtime','admin','training','other'];
const STATUS_FILTERS = [
  { key:'',           label:'All' },
  { key:'open',       label:'Open' },
  { key:'unapproved', label:'Unapproved' },
  { key:'overlong',   label:'Overlong' },
  { key:'approved',   label:'Approved' },
];
const PERIODS = [
  { key:'this_period', label:'This Period', ...getSemiMonthlyBounds(0)  },
  { key:'last_period', label:'Last Period', ...getSemiMonthlyBounds(-1) },
  { key:'this_week',   label:'This Week',   ...getWeekBounds(0)  },
  { key:'last_week',   label:'Last Week',   ...getWeekBounds(-1) },
  { key:'this_month',  label:'This Month',  ...getMonthBounds(0) },
  { key:'custom',      label:'Custom',      start:'', end:'' },
];

// Subscribe to live changes on the given tables and fire cb (latest closure) on any.
function useRealtimeReload(tables, cb) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);
  const key = tables.join(',');
  useEffect(() => {
    let timer = null;
    const channel = realtimeClient.channel(`tt-${key}`);
    tables.forEach(t =>
      channel.on('postgres_changes', { event:'*', schema:'public', table:t }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => ref.current(), 400); // debounce bursts
      })
    );
    channel.subscribe();
    return () => { clearTimeout(timer); realtimeClient.removeChannel(channel); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function TimeTracking() {
  const { db, employee: currentUser } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(currentUser?.role);
  const canSeeBoard = BOARD_ROLES.includes(currentUser?.role);

  const [view, setView] = useState(canSeeBoard ? 'board' : 'timesheet');
  const [period, setPeriod] = useState('this_period');
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterDivision, setFilterDivision] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [employees, setEmployees] = useState([]);
  const [pendingReqCount, setPendingReqCount] = useState(0);

  useEffect(() => {
    db.select('employees','is_active=eq.true&order=full_name.asc&select=id,full_name,hourly_rate')
      .then(setEmployees).catch(() => {});
  }, [db]);

  const loadReqCount = useCallback(() => {
    if (!isAdmin) return;
    db.select('time_entry_change_requests','status=eq.pending&select=id')
      .then(rows => setPendingReqCount((rows || []).length)).catch(() => {});
  }, [db, isAdmin]);
  useEffect(() => { loadReqCount(); }, [loadReqCount]);
  useRealtimeReload(['time_entry_change_requests'], loadReqCount);

  const activePeriod = PERIODS.find(p => p.key === period) || PERIODS[0];
  const startDate = period === 'custom' ? customStart : activePeriod.start;
  const endDate   = period === 'custom' ? customEnd   : activePeriod.end;

  // Field techs are locked to their own rows.
  const effectiveEmployee = !isAdmin
    ? (currentUser?.id || null)
    : (filterEmployee === 'all' ? null : filterEmployee);

  return (
    <div className="tt-page">
      <div className="tt-topbar">
        <div>
          <h1 className="page-title">Time Tracking</h1>
          <p className="page-subtitle">{fmtDate(startDate)} — {fmtDate(endDate)}</p>
        </div>
        <div className="tt-view-tabs">
          {canSeeBoard && (
            <button className={`tt-view-tab${view==='board'?' active':''}`} onClick={() => setView('board')}>Status Board</button>
          )}
          <button className={`tt-view-tab${view==='timesheet'?' active':''}`} onClick={() => setView('timesheet')}>Timesheet</button>
          {isAdmin && (
            <button className={`tt-view-tab${view==='requests'?' active':''}`} onClick={() => setView('requests')}>
              Requests{pendingReqCount > 0 && <span className="tt-tab-badge">{pendingReqCount}</span>}
            </button>
          )}
          {isAdmin && <button className={`tt-view-tab${view==='job'?' active':''}`} onClick={() => setView('job')}>By Job</button>}
          {isAdmin && <button className={`tt-view-tab${view==='payroll'?' active':''}`} onClick={() => setView('payroll')}>Payroll</button>}
        </div>
      </div>

      {view !== 'board' && view !== 'requests' && (
        <div className="tt-filters">
          <div className="tt-period-tabs">
            {PERIODS.map(p => (
              <button key={p.key}
                className={`tt-period-tab${period===p.key?' active':''}`}
                onClick={() => setPeriod(p.key)}
              >{p.label}</button>
            ))}
          </div>
          {period === 'custom' && (
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input type="date" className="input" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ height:32, fontSize:13 }}/>
              <span style={{ color:'var(--text-tertiary)', fontSize:13 }}>to</span>
              <input type="date" className="input" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ height:32, fontSize:13 }}/>
            </div>
          )}
          {isAdmin && view !== 'payroll' && (
            <select className="input" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} style={{ height:32, fontSize:13, minWidth:160 }}>
              <option value="all">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          )}
          {view === 'timesheet' && (
            <>
              <select className="input" value={filterDivision} onChange={e => setFilterDivision(e.target.value)} style={{ height:32, fontSize:13 }}>
                <option value="">All Divisions</option>
                {DIVISIONS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
              </select>
              <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ height:32, fontSize:13 }}>
                {STATUS_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      {view === 'board' && canSeeBoard && <StatusBoard />}
      {view === 'timesheet' && (
        <TimesheetView db={db} startDate={startDate} endDate={endDate}
          filterEmployee={effectiveEmployee}
          filterDivision={filterDivision || null}
          filterStatus={filterStatus || null}
          currentUser={currentUser} employees={employees} isAdmin={isAdmin} />
      )}
      {view === 'requests' && isAdmin && (
        <RequestsView db={db} currentUser={currentUser} onReviewed={loadReqCount} />
      )}
      {view === 'job' && isAdmin && (
        <JobView db={db} startDate={startDate} endDate={endDate}
          filterEmployee={effectiveEmployee} />
      )}
      {view === 'payroll' && isAdmin && (
        <PayrollView db={db} startDate={startDate} endDate={endDate} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TIMESHEET VIEW — grouped by employee; inline edit, row + bulk actions
// ══════════════════════════════════════════════════════════════
function TimesheetView({ db, startDate, endDate, filterEmployee, filterDivision, filterStatus, currentUser, employees, isAdmin }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy]       = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry]       = useState(null);
  const [reqEntry, setReqEntry]         = useState(null);   // tech change-request target
  const [jobs, setJobs] = useState([]);

  // inline edit state
  const [editCell, setEditCell] = useState(null);  // { id, field }
  const [editVal, setEditVal]   = useState('');
  // delete-with-reason state
  const [delTarget, setDelTarget] = useState(null);
  const [delReason, setDelReason] = useState('');
  const [bulkDel, setBulkDel]     = useState(false);
  const [bulkReason, setBulkReason] = useState('');

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(null);
    try {
      const data = await db.rpc('get_timesheet_entries_admin', {
        p_start_date:  startDate,
        p_end_date:    endDate,
        p_employee_id: filterEmployee || null,
        p_job_id:      null,
        p_status:      filterStatus || null,
        p_division:    filterDivision || null,
      });
      setEntries(data || []);
    } catch (err) { setError(friendlyErr(err.message)); }
    finally { setLoading(false); }
  }, [db, startDate, endDate, filterEmployee, filterDivision, filterStatus]);

  useEffect(() => { load(); }, [load]);
  useRealtimeReload(['job_time_entries','time_entry_change_requests'], load);

  useEffect(() => {
    if (!isAdmin) return;
    db.select('jobs','select=id,job_number,insured_name,division&order=created_at.desc&limit=300')
      .then(setJobs).catch(() => {});
  }, [db, isAdmin]);

  const grouped = useMemo(() => {
    const g = {};
    for (const e of entries) {
      if (!g[e.employee_id]) g[e.employee_id] = { name: e.employee_name, entries: [] };
      g[e.employee_id].entries.push(e);
    }
    return g;
  }, [entries]);

  const totalHours   = entries.reduce((s,e) => s + Number(e.hours||0), 0);
  const totalCost    = entries.reduce((s,e) => s + Number(e.total_cost||0), 0);
  const pendingCount = entries.filter(e => !e.approved).length;
  const openCount    = entries.filter(e => e.is_open).length;

  const selectableIds = useMemo(() => entries.filter(e => !e.approved).map(e => e.id), [entries]);
  const selectedEntries = useMemo(() => entries.filter(e => selected.has(e.id)), [entries, selected]);
  const selHours = selectedEntries.reduce((s,e) => s + Number(e.hours||0), 0);
  const selOpen  = selectedEntries.filter(e => e.is_open).length;

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAll = () =>
    setSelected(prev => prev.size === selectableIds.length ? new Set() : new Set(selectableIds));
  const clearSel = () => setSelected(new Set());

  // ─── SECTION: Event handlers ──────────────
  const handleApprove = async (approve = true) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await db.rpc('approve_time_entries', {
        p_entry_ids: [...selected], p_approved_by: currentUser?.id, p_approved: approve,
      });
      okToast(`${selected.size} entr${selected.size>1?'ies':'y'} ${approve?'approved':'unapproved'}`);
      clearSel(); load();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  const handleUnapproveEdit = async (entry) => {
    setBusy(true);
    try {
      await db.rpc('approve_time_entries', { p_entry_ids: [entry.id], p_approved_by: currentUser?.id, p_approved: false });
      setEditEntry({ ...entry, approved: false });
      setShowAddModal(true);
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  const handleClockOut = async (entry) => {
    setBusy(true);
    try {
      await db.rpc('admin_clock_out_entry', { p_id: entry.id, p_actor_id: currentUser?.id });
      okToast('Clocked out'); load();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  const handleBulkClockOut = async () => {
    const open = selectedEntries.filter(e => e.is_open);
    if (open.length === 0) { errToast('No open entries selected'); return; }
    setBusy(true);
    let ok = 0;
    for (const e of open) {
      try { await db.rpc('admin_clock_out_entry', { p_id: e.id, p_actor_id: currentUser?.id }); ok++; }
      catch (err) { errToast(`${e.employee_name}: ${friendlyErr(err.message)}`); }
    }
    if (ok) okToast(`Clocked out ${ok} entr${ok>1?'ies':'y'}`);
    clearSel(); setBusy(false); load();
  };

  const startDelete = (entry) => { setDelTarget(entry.id); setDelReason(''); };
  const confirmDelete = async (entry) => {
    setBusy(true);
    try {
      await db.rpc('delete_time_entry', { p_id: entry.id, p_reason: delReason || 'Removed by office', p_actor_id: currentUser?.id });
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      setSelected(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
      okToast('Entry deleted');
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); setDelTarget(null); setDelReason(''); }
  };

  const confirmBulkDelete = async () => {
    const targets = selectedEntries.filter(e => !e.approved);
    if (targets.length === 0) { errToast('Nothing deletable selected'); return; }
    setBusy(true);
    let ok = 0;
    for (const e of targets) {
      try { await db.rpc('delete_time_entry', { p_id: e.id, p_reason: bulkReason || 'Bulk removed by office', p_actor_id: currentUser?.id }); ok++; }
      catch (err) { errToast(`${e.employee_name}: ${friendlyErr(err.message)}`); }
    }
    if (ok) okToast(`Deleted ${ok} entr${ok>1?'ies':'y'}`);
    setBulkDel(false); setBulkReason(''); clearSel(); setBusy(false); load();
  };

  const handleDuplicate = (entry) => {
    setEditEntry({ ...entry, id: null, approved: false, clock_in: null, clock_out: null,
      travel_start: null, on_site_end: null, is_open: false, _duplicate: true });
    setShowAddModal(true);
  };

  // Inline cell edit → optimistic update → admin_upsert_time_entry → revert on error.
  const startEdit = (entry, field) => {
    if (entry.approved) return;
    setEditCell({ id: entry.id, field });
    setEditVal(field === 'hours' ? String(entry.hours ?? '') : String(entry[field] ?? ''));
  };
  const commitInline = async (entry, field) => {
    const cell = editCell; setEditCell(null);
    if (!cell) return;
    let val = editVal;
    if (field === 'hours') {
      val = Number(editVal);
      if (isNaN(val) || val < 0 || val > 24) { errToast('Enter hours between 0 and 24'); return; }
    }
    const prev = entry[field];
    if (String(prev ?? '') === String(val ?? '')) return;
    setEntries(es => es.map(e => e.id === entry.id ? { ...e, [field]: val } : e));
    try {
      const params = { p_actor_id: currentUser?.id, p_id: entry.id };
      if (field === 'hours')     params.p_hours     = val;
      if (field === 'work_date') params.p_work_date = val;
      await db.rpc('admin_upsert_time_entry', params);
      okToast('Saved');
    } catch (err) {
      setEntries(es => es.map(e => e.id === entry.id ? { ...e, [field]: prev } : e));
      errToast(friendlyErr(err.message));
    }
  };

  if (loading) return <div className="tt-loading"><div className="spinner"/></div>;
  if (error)   return <div className="tt-error">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;

  // ─── SECTION: Render ──────────────
  return (
    <div className="tt-content">
      <div className="tt-summary-bar">
        <SummaryCard label="Total Hours" value={fmtHours(totalHours)} />
        <SummaryCard label="Total Labor" value={fmtMoney(totalCost)} accent />
        <SummaryCard label="Entries" value={entries.length} />
        {openCount > 0 && <SummaryCard label="Open" value={openCount} warn />}
        {isAdmin && <SummaryCard label="Pending Approval" value={pendingCount} warn={pendingCount > 0} />}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {isAdmin && selected.size > 0 && !bulkDel && <>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{selected.size} selected · {fmtHours(selHours)}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => handleApprove(false)} disabled={busy}>Unapprove</button>
            <button className="btn btn-primary btn-sm" onClick={() => handleApprove(true)} disabled={busy}>
              {busy ? '…' : `Approve ${selected.size}`}
            </button>
            {selOpen > 0 && <button className="btn btn-secondary btn-sm" onClick={handleBulkClockOut} disabled={busy}>Clock out {selOpen}</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkDel(true)} disabled={busy} style={{ color:'#dc2626' }}>Delete</button>
          </>}
          {isAdmin && bulkDel && <>
            <input className="input" placeholder="Reason for deleting…" value={bulkReason} autoFocus
              onChange={e => setBulkReason(e.target.value)} style={{ height:30, fontSize:12, minWidth:180 }} />
            <button className="btn btn-secondary btn-sm" onClick={() => { setBulkDel(false); setBulkReason(''); }} disabled={busy}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={confirmBulkDelete} disabled={busy}
              style={{ background:'#dc2626', borderColor:'#dc2626' }}>
              {busy ? '…' : `Delete ${selectedEntries.filter(e=>!e.approved).length}`}
            </button>
          </>}
          {isAdmin && selected.size === 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditEntry(null); setShowAddModal(true); }}>
              + Backfill Entry
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="tt-empty">
          <div style={{ fontSize:36, opacity:0.15, marginBottom:12 }}>⏱</div>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>No time entries for this period</div>
          <div style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:4 }}>Entries appear here once techs clock in via the mobile app</div>
        </div>
      ) : (
        <div className="tt-table-wrap">
          <table className="tt-table">
            <thead>
              <tr>
                {isAdmin && <th style={{ width:36 }}>
                  <input type="checkbox"
                    checked={selectableIds.length > 0 && selected.size === selectableIds.length}
                    onChange={selectAll} />
                </th>}
                <th>Employee</th>
                <th>Date</th>
                <th>Job</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th className="tt-th-num">Hours</th>
                <th className="tt-th-num">Cost</th>
                <th>Status</th>
                <th style={{ width: isAdmin ? 120 : 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {Object.values(grouped).map(group => {
                const gHours = group.entries.reduce((s,e) => s+Number(e.hours||0), 0);
                const gCost  = group.entries.reduce((s,e) => s+Number(e.total_cost||0), 0);
                return [
                  <tr key={`hdr-${group.name}`} className="tt-group-row">
                    {isAdmin && <td/>}
                    <td colSpan={5} style={{ fontWeight:700, fontSize:13 }}>{group.name}</td>
                    <td className="tt-td-num" style={{ fontWeight:700 }}>{fmtHours(gHours)}</td>
                    <td className="tt-td-num" style={{ fontWeight:700, color:'var(--accent)' }}>{fmtMoney(gCost)}</td>
                    <td colSpan={2}/>
                  </tr>,
                  ...group.entries.map(entry => {
                    const editing = (f) => editCell?.id === entry.id && editCell.field === f;
                    return (
                    <tr key={entry.id} className={entry.approved ? 'tt-row-approved' : ''}>
                      {isAdmin && <td>
                        {!entry.approved && (
                          <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} />
                        )}
                      </td>}
                      <td style={{ color:'var(--text-secondary)', paddingLeft:20 }}>{entry.employee_name}</td>
                      <td style={{ whiteSpace:'nowrap', fontSize:12, cursor:isAdmin&&!entry.approved?'pointer':'default' }}
                        onClick={() => isAdmin && startEdit(entry, 'work_date')}>
                        {editing('work_date')
                          ? <input autoFocus type="date" className="tt-inline-input" value={editVal}
                              onChange={e => setEditVal(e.target.value)} onBlur={() => commitInline(entry,'work_date')}
                              onKeyDown={e => { if (e.key==='Enter') e.target.blur(); if (e.key==='Escape') setEditCell(null); }} />
                          : fmtDate(entry.work_date)}
                      </td>
                      <td>
                        <div style={{ fontWeight:600, fontSize:12 }}>{entry.job_number || '—'}</div>
                        <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{entry.insured_name}</div>
                      </td>
                      <td style={{ fontSize:12, whiteSpace:'nowrap' }}>{fmtTime(entry.clock_in)}</td>
                      <td style={{ fontSize:12, whiteSpace:'nowrap' }}>
                        {entry.is_open
                          ? <span className="tt-badge open">OPEN</span>
                          : fmtTime(entry.clock_out)}
                      </td>
                      <td className="tt-td-num" style={{ fontWeight:600, cursor:isAdmin&&!entry.approved?'pointer':'default' }}
                        onClick={() => isAdmin && startEdit(entry, 'hours')}>
                        {editing('hours')
                          ? <input autoFocus type="number" step="0.25" min="0" max="24" className="tt-inline-input" value={editVal}
                              onChange={e => setEditVal(e.target.value)} onBlur={() => commitInline(entry,'hours')}
                              onKeyDown={e => { if (e.key==='Enter') e.target.blur(); if (e.key==='Escape') setEditCell(null); }}
                              style={{ textAlign:'right' }} />
                          : <span className={entry.is_overlong ? 'tt-overlong' : ''}>{fmtHours(entry.hours)}</span>}
                      </td>
                      <td className="tt-td-num" style={{ fontWeight:600 }}>{fmtCost(entry.total_cost)}</td>
                      <td>
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
                          {entry.approved
                            ? <span className="tt-status approved">Approved</span>
                            : <span className="tt-status pending">Pending</span>}
                          {entry.is_overlong   && <span className="tt-badge danger">12h+</span>}
                          {entry.auto_continued && <span className="tt-badge muted">auto</span>}
                          {entry.has_pending_change && <span className="tt-badge edit">edit ✎</span>}
                        </div>
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:3, justifyContent:'flex-end' }}>
                          {!isAdmin && (
                            <button className="tt-icon-btn" title="Request a change"
                              onClick={() => setReqEntry(entry)}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                          )}
                          {isAdmin && delTarget === entry.id && (
                            <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                              <input className="input" placeholder="Reason…" value={delReason} autoFocus
                                onChange={e => setDelReason(e.target.value)}
                                onKeyDown={e => { if (e.key==='Enter') confirmDelete(entry); if (e.key==='Escape') setDelTarget(null); }}
                                style={{ height:26, fontSize:11, width:110 }} />
                              <button className="tt-icon-btn tt-icon-btn-danger" title="Confirm delete"
                                onClick={() => confirmDelete(entry)}
                                style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca' }}>
                                <span style={{ fontSize:11, fontWeight:700 }}>✓</span>
                              </button>
                            </div>
                          )}
                          {isAdmin && delTarget !== entry.id && <>
                            {entry.is_open && (
                              <button className="tt-icon-btn" title="Clock out" onClick={() => handleClockOut(entry)} disabled={busy}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                              </button>
                            )}
                            <button className="tt-icon-btn" title={entry.approved ? 'Unapprove & edit' : 'Edit'}
                              onClick={() => entry.approved ? handleUnapproveEdit(entry) : (setEditEntry(entry), setShowAddModal(true))}
                              disabled={busy}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                            <button className="tt-icon-btn" title="Duplicate" onClick={() => handleDuplicate(entry)} disabled={busy}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            </button>
                            {!entry.approved && (
                              <button className="tt-icon-btn tt-icon-btn-danger" title="Delete" onClick={() => startDelete(entry)} disabled={busy}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                              </button>
                            )}
                          </>}
                        </div>
                      </td>
                    </tr>
                  ); }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <EntryModal entry={editEntry} employees={employees} jobs={jobs} db={db} actorId={currentUser?.id}
          onClose={() => { setShowAddModal(false); setEditEntry(null); }}
          onSaved={() => { setShowAddModal(false); setEditEntry(null); load(); }} />
      )}
      {reqEntry && (
        <RequestModal entry={reqEntry} db={db} actorId={currentUser?.id}
          onClose={() => setReqEntry(null)}
          onSaved={() => { setReqEntry(null); load(); }} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// REQUESTS VIEW — pending tech change-requests with diff + approve/reject
// ══════════════════════════════════════════════════════════════
const PROPOSED_LABELS = {
  work_date:'Date', hours:'Hours', clock_in:'Clock In', clock_out:'Clock Out',
  travel_minutes:'Travel (min)', description:'Description', notes:'Notes',
};
function fmtProposed(key, val) {
  if (val == null || val === '') return '—';
  if (key === 'work_date') return fmtDate(val);
  if (key === 'hours')     return fmtHours(val);
  if (key === 'clock_in' || key === 'clock_out') return fmtTime(val);
  return String(val);
}

function RequestsView({ db, currentUser, onReviewed }) {
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [rejecting, setRejecting] = useState(null); // request id awaiting note

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const reqs = await db.select('time_entry_change_requests','status=eq.pending&select=*&order=created_at.desc');
      const list = reqs || [];
      const entryIds = [...new Set(list.map(r => r.entry_id))];
      const empIds   = [...new Set(list.map(r => r.requested_by))].filter(Boolean);
      const [entriesRows, empRows] = await Promise.all([
        entryIds.length ? db.select('job_time_entries', `id=in.(${entryIds.join(',')})&select=id,employee_id,work_date,hours,clock_in,clock_out,travel_minutes,description,notes,job_id`) : [],
        empIds.length   ? db.select('employees', `id=in.(${empIds.join(',')})&select=id,full_name`) : [],
      ]);
      const entryMap = Object.fromEntries((entriesRows || []).map(e => [e.id, e]));
      const empMap   = Object.fromEntries((empRows || []).map(e => [e.id, e.full_name]));
      setRows(list.map(r => ({ ...r, entry: entryMap[r.entry_id] || null, requester: empMap[r.requested_by] || 'Unknown' })));
    } catch (err) { setError(friendlyErr(err.message)); }
    finally { setLoading(false); }
  }, [db]);

  useEffect(() => { load(); }, [load]);
  useRealtimeReload(['time_entry_change_requests'], load);

  const review = async (req, approve, note) => {
    setBusy(true);
    try {
      await db.rpc('review_time_entry_change_request', {
        p_request_id: req.id, p_approve: approve, p_actor_id: currentUser?.id, p_review_note: note || null,
      });
      okToast(approve ? 'Change approved' : 'Request rejected');
      setRejecting(null);
      setRows(prev => prev.filter(r => r.id !== req.id));
      onReviewed?.();
      load();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="tt-loading"><div className="spinner"/></div>;
  if (error)   return <div className="tt-error">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;

  return (
    <div className="tt-content">
      <div className="tt-summary-bar">
        <SummaryCard label="Pending Requests" value={rows.length} warn={rows.length > 0} />
      </div>
      {rows.length === 0 ? (
        <div className="tt-empty">
          <div style={{ fontSize:36, opacity:0.15, marginBottom:12 }}>✅</div>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>No pending change requests</div>
          <div style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:4 }}>Edit requests from the field app land here</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12, overflow:'auto' }}>
          {rows.map(req => {
            const keys = Object.keys(PROPOSED_LABELS).filter(k => req.proposed && req.proposed[k] != null && req.proposed[k] !== '');
            return (
              <div key={req.id} className="tt-req-card">
                <div className="tt-req-head">
                  <div>
                    <span style={{ fontWeight:700 }}>{req.requester}</span>
                    <span style={{ color:'var(--text-tertiary)', fontSize:12, marginLeft:8 }}>
                      {req.entry ? fmtDate(req.entry.work_date) : 'entry missing'} · requested {fmtDate((req.created_at||'').slice(0,10))}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    {rejecting === req.id ? (
                      <>
                        <input className="input" placeholder="Reason (optional)…" autoFocus
                          onKeyDown={e => { if (e.key==='Enter') review(req, false, e.target.value); if (e.key==='Escape') setRejecting(null); }}
                          id={`rej-${req.id}`} style={{ height:30, fontSize:12, width:160 }} />
                        <button className="btn btn-secondary btn-sm" onClick={() => setRejecting(null)} disabled={busy}>Cancel</button>
                        <button className="btn btn-primary btn-sm" disabled={busy}
                          style={{ background:'#dc2626', borderColor:'#dc2626' }}
                          onClick={() => review(req, false, document.getElementById(`rej-${req.id}`)?.value)}>Confirm Reject</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => setRejecting(req.id)} disabled={busy}>Reject</button>
                        <button className="btn btn-primary btn-sm" onClick={() => review(req, true)} disabled={busy || !req.entry}>Approve</button>
                      </>
                    )}
                  </div>
                </div>
                {req.tech_note && <div className="tt-req-note">“{req.tech_note}”</div>}
                <div className="tt-req-diff">
                  {keys.length === 0 && <span style={{ color:'var(--text-tertiary)', fontSize:12 }}>No field changes proposed</span>}
                  {keys.map(k => {
                    const current = req.entry ? req.entry[k] : null;
                    const changed = String(current ?? '') !== String(req.proposed[k] ?? '');
                    return (
                      <div key={k} className="tt-diff-row">
                        <span className="tt-diff-label">{PROPOSED_LABELS[k]}</span>
                        <span className="tt-diff-old">{fmtProposed(k, current)}</span>
                        <span className="tt-diff-arrow">→</span>
                        <span className="tt-diff-new" style={{ fontWeight: changed ? 700 : 400, color: changed ? 'var(--accent)' : 'var(--text-secondary)' }}>
                          {fmtProposed(k, req.proposed[k])}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BY JOB VIEW — labor cost per job, expandable employee breakdown
// ══════════════════════════════════════════════════════════════
function JobView({ db, startDate, endDate, filterEmployee }) {
  const [data, setData]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedJob, setExpandedJob] = useState(null);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(null);
    try {
      const rows = await db.rpc('get_job_labor_summary', {
        p_job_id: null, p_start_date: startDate, p_end_date: endDate,
      });
      const filtered = filterEmployee
        ? (rows||[]).filter(r => r.employee_id === filterEmployee)
        : (rows||[]);
      setData(filtered);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [db, startDate, endDate, filterEmployee]);

  useEffect(() => { load(); }, [load]);

  const jobGroups = useMemo(() => {
    const g = {};
    for (const r of data) {
      if (!g[r.job_id]) g[r.job_id] = {
        job_id:r.job_id, job_number:r.job_number, insured_name:r.insured_name,
        division:r.division, total_hours:0, total_cost:0, approved_cost:0, rows:[],
      };
      g[r.job_id].total_hours  += Number(r.total_hours||0);
      g[r.job_id].total_cost   += Number(r.total_cost||0);
      g[r.job_id].approved_cost += Number(r.approved_cost||0);
      g[r.job_id].rows.push(r);
    }
    return Object.values(g).sort((a,b) => b.total_cost - a.total_cost);
  }, [data]);

  const grandHours = jobGroups.reduce((s,j) => s+j.total_hours, 0);
  const grandCost  = jobGroups.reduce((s,j) => s+j.total_cost, 0);

  if (loading) return <div className="tt-loading"><div className="spinner"/></div>;
  if (error)   return <div className="tt-error">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;

  return (
    <div className="tt-content">
      <div className="tt-summary-bar">
        <SummaryCard label="Jobs with Labor" value={jobGroups.length} />
        <SummaryCard label="Total Hours" value={fmtHours(grandHours)} />
        <SummaryCard label="Total Labor Cost" value={fmtMoney(grandCost)} accent />
      </div>

      {jobGroups.length === 0 ? (
        <div className="tt-empty">
          <div style={{ fontSize:36, opacity:0.15, marginBottom:12 }}>🏗️</div>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>No labor recorded for this period</div>
        </div>
      ) : (
        <div className="tt-table-wrap">
          <table className="tt-table">
            <thead>
              <tr>
                <th>Job #</th>
                <th>Client</th>
                <th>Division</th>
                <th className="tt-th-num">Hours</th>
                <th className="tt-th-num">Labor Cost</th>
                <th className="tt-th-num">Approved</th>
                <th style={{ width:32 }}></th>
              </tr>
            </thead>
            <tbody>
              {jobGroups.map(job => {
                const dc = DIVISION_COLORS[job.division] || '#6b7280';
                const isOpen = expandedJob === job.job_id;
                return [
                  <tr key={job.job_id} className="tt-job-row"
                    onClick={() => setExpandedJob(isOpen ? null : job.job_id)}>
                    <td>
                      <span style={{ display:'inline-block', width:3, height:14, borderRadius:2,
                        background:dc, marginRight:8, verticalAlign:'middle' }}/>
                      <span style={{ fontWeight:700 }}>{job.job_number || '—'}</span>
                    </td>
                    <td style={{ fontSize:13 }}>{job.insured_name}</td>
                    <td><span style={{ fontSize:11, fontWeight:600, color:dc }}>{job.division}</span></td>
                    <td className="tt-td-num" style={{ fontWeight:600 }}>{fmtHours(job.total_hours)}</td>
                    <td className="tt-td-num" style={{ fontWeight:700, color:'var(--accent)' }}>{fmtMoney(job.total_cost)}</td>
                    <td className="tt-td-num" style={{ fontSize:12, color:'var(--text-secondary)' }}>{fmtMoney(job.approved_cost)}</td>
                    <td style={{ textAlign:'right', fontSize:11, color:'var(--text-tertiary)' }}>{isOpen?'▾':'▸'}</td>
                  </tr>,
                  isOpen && (
                    <tr key={`exp-${job.job_id}`} className="tt-expanded-row">
                      <td colSpan={7} style={{ padding:0 }}>
                        <table style={{ width:'100%', fontSize:12, background:'var(--bg-secondary)' }}>
                          <thead>
                            <tr style={{ background:'var(--bg-tertiary)' }}>
                              <th style={{ padding:'6px 12px 6px 32px', textAlign:'left', color:'var(--text-tertiary)', fontWeight:600 }}>Employee</th>
                              <th style={{ padding:'6px 12px', textAlign:'right', color:'var(--text-tertiary)', fontWeight:600 }}>Hours</th>
                              <th style={{ padding:'6px 12px', textAlign:'right', color:'var(--text-tertiary)', fontWeight:600 }}>Cost</th>
                              <th style={{ padding:'6px 12px', textAlign:'right', color:'var(--text-tertiary)', fontWeight:600 }}>Entries</th>
                            </tr>
                          </thead>
                          <tbody>
                            {job.rows.map(r => (
                              <tr key={r.employee_id}>
                                <td style={{ padding:'7px 12px 7px 32px', color:'var(--text-secondary)' }}>{r.employee_name}</td>
                                <td style={{ padding:'7px 12px', textAlign:'right', fontWeight:600 }}>{fmtHours(r.total_hours)}</td>
                                <td style={{ padding:'7px 12px', textAlign:'right' }}>{fmtCost(r.total_cost)}</td>
                                <td style={{ padding:'7px 12px', textAlign:'right', color:'var(--text-tertiary)' }}>{r.entry_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
              <tr className="tt-grand-total">
                <td colSpan={3} style={{ fontWeight:700 }}>Total</td>
                <td className="tt-td-num" style={{ fontWeight:700 }}>{fmtHours(grandHours)}</td>
                <td className="tt-td-num" style={{ fontWeight:700, color:'var(--accent)' }}>{fmtMoney(grandCost)}</td>
                <td colSpan={2}/>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PAYROLL VIEW — per employee summary, OT calc, CSV export
// ══════════════════════════════════════════════════════════════
function PayrollView({ db, startDate, endDate }) {
  const [data, setData]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(null);
    try {
      const rows = await db.rpc('get_payroll_summary', { p_start_date:startDate, p_end_date:endDate });
      setData(rows || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [db, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExportCSV = () => {
    const headers = ['Employee','Hourly Rate','OT Rate','Regular Hours','OT Hours',
                     'Total Hours','Regular Pay','OT Pay','Total Pay','Approved Hrs','Pending Hrs'];
    const rows = data.map(e => [
      e.employee_name, e.hourly_rate??'', e.overtime_rate??'',
      e.regular_hours??0, e.overtime_hours??0, e.total_hours??0,
      e.regular_cost??0, e.overtime_cost??0, e.total_cost??0,
      e.approved_hours??0, e.pending_hours??0,
    ]);
    const csvEsc = (v) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map(r => r.map(csvEsc).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payroll_${startDate}_to_${endDate}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const totalPay     = data.reduce((s,e) => s+Number(e.total_cost||0), 0);
  const totalHours   = data.reduce((s,e) => s+Number(e.total_hours||0), 0);
  const totalOT      = data.reduce((s,e) => s+Number(e.overtime_hours||0), 0);
  const totalPending = data.reduce((s,e) => s+Number(e.pending_hours||0), 0);

  if (loading) return <div className="tt-loading"><div className="spinner"/></div>;
  if (error)   return <div className="tt-error">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;

  return (
    <div className="tt-content">
      <div className="tt-summary-bar">
        <SummaryCard label="Employees" value={data.length} />
        <SummaryCard label="Total Hours" value={fmtHours(totalHours)} />
        <SummaryCard label="OT Hours" value={fmtHours(totalOT)} warn={totalOT > 0} />
        <SummaryCard label="Total Payroll" value={fmtMoney(totalPay)} accent />
        {totalPending > 0 && <SummaryCard label="Pending Approval" value={fmtHours(totalPending)} warn />}
        <div style={{ marginLeft:'auto' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} disabled={data.length===0}>
            ↓ Export CSV
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="tt-empty">
          <div style={{ fontSize:36, opacity:0.15, marginBottom:12 }}>💰</div>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>No payroll data for this period</div>
        </div>
      ) : (
        <div className="tt-table-wrap">
          <table className="tt-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="tt-th-num">Rate</th>
                <th className="tt-th-num">Reg Hours</th>
                <th className="tt-th-num">OT Hours</th>
                <th className="tt-th-num">Total Hours</th>
                <th className="tt-th-num">Reg Pay</th>
                <th className="tt-th-num">OT Pay</th>
                <th className="tt-th-num">Total Pay</th>
                <th className="tt-th-num">Pending</th>
              </tr>
            </thead>
            <tbody>
              {data.map(emp => (
                <tr key={emp.employee_id}>
                  <td style={{ fontWeight:600 }}>{emp.employee_name}</td>
                  <td className="tt-td-num" style={{ fontSize:12 }}>
                    {emp.hourly_rate ? `$${Number(emp.hourly_rate).toFixed(2)}/h` : '—'}
                  </td>
                  <td className="tt-td-num">{fmtHours(emp.regular_hours)}</td>
                  <td className="tt-td-num">
                    {Number(emp.overtime_hours||0) > 0
                      ? <span style={{ color:'#d97706', fontWeight:600 }}>{fmtHours(emp.overtime_hours)}</span>
                      : '—'}
                  </td>
                  <td className="tt-td-num" style={{ fontWeight:600 }}>{fmtHours(emp.total_hours)}</td>
                  <td className="tt-td-num">{fmtMoney(emp.regular_cost)}</td>
                  <td className="tt-td-num">
                    {Number(emp.overtime_cost||0) > 0
                      ? <span style={{ color:'#d97706' }}>{fmtMoney(emp.overtime_cost)}</span>
                      : '—'}
                  </td>
                  <td className="tt-td-num" style={{ fontWeight:700, color:'var(--accent)' }}>
                    {fmtMoney(emp.total_cost)}
                  </td>
                  <td className="tt-td-num">
                    {Number(emp.pending_hours||0) > 0
                      ? <span style={{ color:'#d97706', fontWeight:600 }}>{fmtHours(emp.pending_hours)}</span>
                      : <span style={{ color:'var(--status-resolved)', fontSize:11 }}>✓ All clear</span>}
                  </td>
                </tr>
              ))}
              <tr className="tt-grand-total">
                <td style={{ fontWeight:700 }}>Total</td>
                <td/>
                <td className="tt-td-num" style={{ fontWeight:700 }}>
                  {fmtHours(data.reduce((s,e)=>s+Number(e.regular_hours||0),0))}
                </td>
                <td className="tt-td-num" style={{ fontWeight:700, color:'#d97706' }}>{fmtHours(totalOT)}</td>
                <td className="tt-td-num" style={{ fontWeight:700 }}>{fmtHours(totalHours)}</td>
                <td className="tt-td-num" style={{ fontWeight:700 }}>
                  {fmtMoney(data.reduce((s,e)=>s+Number(e.regular_cost||0),0))}
                </td>
                <td className="tt-td-num" style={{ fontWeight:700, color:'#d97706' }}>
                  {fmtMoney(data.reduce((s,e)=>s+Number(e.overtime_cost||0),0))}
                </td>
                <td className="tt-td-num" style={{ fontWeight:700, color:'var(--accent)' }}>
                  {fmtMoney(totalPay)}
                </td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ADMIN ADD / EDIT / BACKFILL / DUPLICATE ENTRY MODAL
// ══════════════════════════════════════════════════════════════
function EntryModal({ entry, employees, jobs, db, actorId, onClose, onSaved }) {
  const isEdit = !!entry?.id;
  const [form, setForm] = useState({
    employee_id:  entry?.employee_id  || '',
    job_id:       entry?.job_id       || '',
    work_date:    entry?.work_date    || toISO(new Date()),
    hours:        entry?.hours != null ? String(entry.hours) : '',
    work_type:    entry?.work_type    || 'regular',
    travel_start: isoToLocalInput(entry?.travel_start),
    clock_in:     isoToLocalInput(entry?.clock_in),
    on_site_end:  isoToLocalInput(entry?.on_site_end),
    clock_out:    isoToLocalInput(entry?.clock_out),
    travel_minutes: entry?.travel_minutes != null ? String(entry.travel_minutes) : '',
    description:  entry?.description  || '',
    notes:        entry?.notes        || '',
  });
  const [showTimes, setShowTimes] = useState(!!(entry?.clock_in || entry?.travel_start));
  const [saving, setSaving] = useState(false);
  const [jobSearch, setJobSearch] = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const filteredJobs = useMemo(() => {
    if (!jobSearch.trim()) return jobs.slice(0, 60);
    const q = jobSearch.toLowerCase();
    return jobs.filter(j =>
      j.job_number?.toLowerCase().includes(q) ||
      j.insured_name?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [jobs, jobSearch]);

  const handleSave = async () => {
    if (!form.employee_id) { errToast('Select an employee'); return; }
    if (!form.job_id)      { errToast('Select a job'); return; }
    if (!form.work_date)   { errToast('Enter a work date'); return; }
    const hoursNum = form.hours === '' ? null : Number(form.hours);
    if (!showTimes && (hoursNum == null || hoursNum <= 0)) { errToast('Enter valid hours (e.g. 7.5)'); return; }
    setSaving(true);
    try {
      await db.rpc('admin_upsert_time_entry', {
        p_actor_id:     actorId,
        p_id:           entry?.id || null,
        p_employee_id:  form.employee_id,
        p_job_id:       form.job_id,
        p_work_date:    form.work_date,
        p_hours:        hoursNum,
        p_clock_in:     showTimes ? localInputToIso(form.clock_in)    : null,
        p_clock_out:    showTimes ? localInputToIso(form.clock_out)   : null,
        p_travel_start: showTimes ? localInputToIso(form.travel_start): null,
        p_on_site_end:  showTimes ? localInputToIso(form.on_site_end) : null,
        p_travel_minutes: form.travel_minutes === '' ? null : Number(form.travel_minutes),
        p_work_type:    form.work_type,
        p_description:  form.description || null,
        p_notes:        form.notes || null,
        p_override_approved: !!entry?.approved,
      });
      okToast(isEdit ? 'Entry updated' : 'Entry added');
      onSaved();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setSaving(false); }
  };

  const title = isEdit ? 'Edit Time Entry' : entry?._duplicate ? 'Duplicate Entry' : 'Backfill Time Entry';

  return (
    <div className="tt-modal-backdrop" onClick={onClose}>
      <div className="tt-modal" onClick={e => e.stopPropagation()}>
        <div className="tt-modal-header">
          <span style={{ fontSize:15, fontWeight:700 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--text-tertiary)', lineHeight:1 }}>✕</button>
        </div>
        <div className="tt-modal-body">
          <div className="tt-form-group">
            <label className="tt-label">Employee *</label>
            <select className="input" value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
              <option value="">Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Job *</label>
            <input className="input" placeholder="Search by job # or client name…"
              value={jobSearch} onChange={e => setJobSearch(e.target.value)}
              style={{ marginBottom:6 }} />
            <select className="input" value={form.job_id}
              onChange={e => set('job_id', e.target.value)}
              size={5} style={{ height:'auto', minHeight:90 }}>
              {filteredJobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.job_number ? `${j.job_number} — ` : ''}{j.insured_name}
                </option>
              ))}
            </select>
            {form.job_id && <div style={{ fontSize:11, color:'var(--accent)', marginTop:4 }}>
              ✓ {jobs.find(j=>j.id===form.job_id)?.insured_name || 'Job selected'}
            </div>}
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Date *</label>
              <input type="date" className="input" value={form.work_date} onChange={e => set('work_date', e.target.value)} />
            </div>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">On-site Hours {showTimes ? '' : '*'}</label>
              <input type="number" className="input" value={form.hours}
                onChange={e => set('hours', e.target.value)}
                min="0" max="24" step="0.25" placeholder="e.g. 7.5" />
            </div>
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Work Type</label>
            <select className="input" value={form.work_type} onChange={e => set('work_type', e.target.value)}>
              {WORK_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
          </div>

          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf:'flex-start' }}
            onClick={() => setShowTimes(s => !s)}>
            {showTimes ? '▾ Hide clock times' : '▸ Set clock times (optional)'}
          </button>
          {showTimes && (
            <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'4px 0 0', borderTop:'1px solid var(--border-light)' }}>
              <div style={{ display:'flex', gap:12 }}>
                <div className="tt-form-group" style={{ flex:1 }}>
                  <label className="tt-label">Travel Start (OMW)</label>
                  <input type="datetime-local" className="input" value={form.travel_start} onChange={e => set('travel_start', e.target.value)} />
                </div>
                <div className="tt-form-group" style={{ flex:1 }}>
                  <label className="tt-label">Clock In</label>
                  <input type="datetime-local" className="input" value={form.clock_in} onChange={e => set('clock_in', e.target.value)} />
                </div>
              </div>
              <div style={{ display:'flex', gap:12 }}>
                <div className="tt-form-group" style={{ flex:1 }}>
                  <label className="tt-label">On-site End</label>
                  <input type="datetime-local" className="input" value={form.on_site_end} onChange={e => set('on_site_end', e.target.value)} />
                </div>
                <div className="tt-form-group" style={{ flex:1 }}>
                  <label className="tt-label">Clock Out</label>
                  <input type="datetime-local" className="input" value={form.clock_out} onChange={e => set('clock_out', e.target.value)} />
                </div>
              </div>
              <div className="tt-form-group">
                <label className="tt-label">Travel Minutes</label>
                <input type="number" className="input" value={form.travel_minutes}
                  onChange={e => set('travel_minutes', e.target.value)} min="0" step="1" placeholder="e.g. 20" />
              </div>
              <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>
                Order must be Travel ≤ Clock In ≤ On-site End ≤ Clock Out. On-site hours above is what bills.
              </div>
            </div>
          )}

          <div className="tt-form-group">
            <label className="tt-label">Description</label>
            <input className="input" value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="What work was done…" />
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Notes</label>
            <textarea className="input textarea" value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Internal notes…" style={{ resize:'vertical' }}/>
          </div>
        </div>
        <div className="tt-modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TECH CHANGE-REQUEST MODAL — field tech proposes an edit (no direct write)
// ══════════════════════════════════════════════════════════════
function RequestModal({ entry, db, actorId, onClose, onSaved }) {
  const [form, setForm] = useState({
    work_date:   entry?.work_date || '',
    hours:       entry?.hours != null ? String(entry.hours) : '',
    clock_in:    isoToLocalInput(entry?.clock_in),
    clock_out:   isoToLocalInput(entry?.clock_out),
    description: entry?.description || '',
    notes:       entry?.notes || '',
    tech_note:   '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.tech_note.trim()) { errToast('Tell the office what to change and why'); return; }
    // Only send fields the tech actually changed.
    const proposed = {};
    if (form.work_date && form.work_date !== entry?.work_date) proposed.work_date = form.work_date;
    if (form.hours !== '' && Number(form.hours) !== Number(entry?.hours)) proposed.hours = Number(form.hours);
    const ciIso = localInputToIso(form.clock_in);
    const coIso = localInputToIso(form.clock_out);
    if (ciIso && ciIso !== entry?.clock_in) proposed.clock_in = ciIso;
    if (coIso && coIso !== entry?.clock_out) proposed.clock_out = coIso;
    if (form.description !== (entry?.description || '')) proposed.description = form.description;
    if (form.notes !== (entry?.notes || '')) proposed.notes = form.notes;
    if (Object.keys(proposed).length === 0) { errToast('Change at least one field'); return; }
    setSaving(true);
    try {
      await db.rpc('submit_time_entry_change_request', {
        p_entry_id: entry.id, p_proposed: proposed, p_tech_note: form.tech_note, p_actor_id: actorId,
      });
      okToast('Change request sent to the office');
      onSaved();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setSaving(false); }
  };

  return (
    <div className="tt-modal-backdrop" onClick={onClose}>
      <div className="tt-modal" onClick={e => e.stopPropagation()}>
        <div className="tt-modal-header">
          <span style={{ fontSize:15, fontWeight:700 }}>Request a Change</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'var(--text-tertiary)', lineHeight:1 }}>✕</button>
        </div>
        <div className="tt-modal-body">
          <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
            {fmtDate(entry?.work_date)} · {entry?.job_number || 'Job'} — {entry?.insured_name}
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Date</label>
              <input type="date" className="input" value={form.work_date} onChange={e => set('work_date', e.target.value)} />
            </div>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Hours</label>
              <input type="number" className="input" value={form.hours} min="0" max="24" step="0.25"
                onChange={e => set('hours', e.target.value)} />
            </div>
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Clock In</label>
              <input type="datetime-local" className="input" value={form.clock_in} onChange={e => set('clock_in', e.target.value)} />
            </div>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Clock Out</label>
              <input type="datetime-local" className="input" value={form.clock_out} onChange={e => set('clock_out', e.target.value)} />
            </div>
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Description</label>
            <input className="input" value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Why this change? *</label>
            <textarea className="input textarea" value={form.tech_note} rows={2}
              onChange={e => set('tech_note', e.target.value)}
              placeholder="e.g. Forgot to clock out — I left at 4:30" style={{ resize:'vertical' }} />
          </div>
        </div>
        <div className="tt-modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Sending…' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────
function SummaryCard({ label, value, accent, warn }) {
  return (
    <div className="tt-summary-card">
      <div className="tt-summary-label">{label}</div>
      <div className={`tt-summary-value${accent?' accent':warn?' warn':''}`}>{value}</div>
    </div>
  );
}
