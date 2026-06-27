/**
 * ════════════════════════════════════════════════
 * FILE: TimeTracking.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The office "Time Tracking" page. It shows everyone's clock-in/clock-out time
 *   entries so the office can review, fix, approve, and pay them. Admins can edit
 *   any entry right in the table, add or delete entries, clock people out, and
 *   approve hours in bulk. A "Requests" area reviews edit requests techs submit
 *   from the field, plus payroll and by-job summaries. A field tech sees only
 *   their own entries and can ask for a change instead of editing directly.
 *
 *   Visually this page follows the shared "My Money / Collections" design language
 *   (white cards on a cool-grey page, dark-pill tabs, KPI tiles, grid tables) via
 *   the reusable kit in src/components/collections/.
 *
 * WHERE IT LIVES:
 *   Route:        /time-tracking (feature flag: page:time_tracking)
 *   Rendered by:  src/App.jsx route
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/components/StatusBoard, @/lib/realtime,
 *              @/components/collections/collKit + collTokens (shared design system)
 *   Data:      reads  → job_time_entries, time_entry_change_requests, employees,
 *                        jobs (RPCs get_timesheet_entries_admin /
 *                        get_job_labor_summary / get_payroll_summary)
 *              writes → job_time_entries + time_entry_change_requests
 *                        (only through admin_* / *_time_entry RPCs — never direct PostgREST)
 *
 * NOTES / GOTCHAS:
 *   - total_cost is a GENERATED column — never written here; the RPCs set
 *     hours/travel_minutes/rate and Postgres recomputes cost.
 *   - All writes go through SECURITY DEFINER RPCs. RPC errors are P0001 with a code
 *     string in the message — see friendlyErr() for the substring map.
 *   - admin_upsert_time_entry COALESCEs every field, so a partial update (actor +
 *     id + one changed param) safely keeps the rest. Inline edits use this.
 *   - Inline edits are blocked on approved rows; use "Unapprove & edit".
 *   - Realtime is wired straight to realtimeClient (realtime.js untouched).
 *   - Presentation uses the page-scoped `.coll-*` classes + collKit; modals,
 *     inline-edit inputs and the request diff keep their `tt-*` classes.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import StatusBoard from '@/components/StatusBoard';
import { realtimeClient } from '@/lib/realtime';
import { C, STATUS, fmt$2, divColor, divLabel } from '@/components/collections/collTokens';
import {
  CollCard, KpiGrid, Kpi, SegControl, SearchBox, PrimaryButton, GhostButton,
  Pill, DivisionSquare, EmptyState,
  PopoverButton, FunnelIcon, FilterGroup, ToggleChip,
} from '@/components/collections/collKit';

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
  let idx = (now.getDate() <= 15 ? 0 : 1) + offset;
  while (idx < 0)  { month--; if (month < 0)  { month = 11; year--; } idx += 2; }
  while (idx > 1)  { month++; if (month > 11) { month = 0;  year++; } idx -= 2; }
  if (idx === 0) return { start: toISO(new Date(year, month, 1)),  end: toISO(new Date(year, month, 15)) };
  return            { start: toISO(new Date(year, month, 16)), end: toISO(new Date(year, month + 1, 0)) };
}
function fmtDateLong(iso) {
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
const money    = (v) => fmt$2(v);
const costCell = (v) => (v == null || Number(v) === 0) ? '—' : fmt$2(v);
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

const DIVISIONS = ['water','mold','reconstruction','fire','contents','general'];
const WORK_TYPES = ['regular','field','travel','overtime','admin','training','other'];
const STATUS_SEG = [
  { value:'',           label:'All' },
  { value:'open',       label:'Open' },
  { value:'unapproved', label:'Unapproved' },
  { value:'overlong',   label:'Overlong' },
  { value:'approved',   label:'Approved' },
];
const PERIODS = [
  { key:'this_period', label:'This Period', ...getSemiMonthlyBounds(0)  },
  { key:'last_period', label:'Last Period', ...getSemiMonthlyBounds(-1) },
  { key:'this_week',   label:'This Week',   ...getWeekBounds(0)  },
  { key:'this_month',  label:'This Month',  ...getMonthBounds(0) },
  { key:'custom',      label:'Custom',      start:'', end:'' },
];

const tnum = { fontVariantNumeric: 'tabular-nums' };

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
        timer = setTimeout(() => ref.current(), 400);
      })
    );
    channel.subscribe();
    return () => { clearTimeout(timer); realtimeClient.removeChannel(channel); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Compact badge cluster for a timesheet row's status column.
function RowBadges({ entry, isAdmin }) {
  return (
    <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
      {entry.approved
        ? <Pill color={STATUS.success.text} bg={STATUS.success.tint} border={STATUS.success.border}>APPROVED</Pill>
        : (isAdmin ? <Pill color={STATUS.warning.text} bg={STATUS.warning.tint} border={STATUS.warning.border}>PENDING</Pill> : null)}
      {entry.is_overlong    && <Pill color={STATUS.danger.text}  bg={STATUS.danger.tint}  border={STATUS.danger.border}>12h+</Pill>}
      {entry.auto_continued && <Pill color={STATUS.neutral.text} bg={STATUS.neutral.tint} border={STATUS.neutral.border}>AUTO</Pill>}
      {entry.has_pending_change && <Pill color="#7c3aed" bg="#faf5ff" border="#ddd6fe">EDIT ✎</Pill>}
    </div>
  );
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

  // ─── SECTION: Render ──────────────
  const tabs = [];
  if (canSeeBoard) tabs.push({ value:'board', label:'Status Board' });
  tabs.push({ value:'timesheet', label:'Timesheet' });
  if (isAdmin) tabs.push({ value:'requests', label:(
    <span>Requests{pendingReqCount > 0 && <span className="coll-count-badge" style={{ marginLeft:6 }}>{pendingReqCount}</span>}</span>
  ) });
  if (isAdmin) tabs.push({ value:'job', label:'By Job' });
  if (isAdmin) tabs.push({ value:'payroll', label:'Payroll' });

  const showPeriod = view !== 'board' && view !== 'requests';

  return (
    <div className="coll-page">
      <header className="coll-header">
        <div>
          <h1 className="coll-title">Time Tracking</h1>
          <div className="coll-subtitle">
            Utah Pros Restoration{showPeriod && startDate ? ` · ${fmtDateLong(startDate)} — ${fmtDateLong(endDate)}` : ''}
          </div>
        </div>
      </header>

      <div className="coll-tabrow">
        <SegControl options={tabs} value={view} onChange={setView} size="lg" ariaLabel="Time tracking section" />
        {showPeriod && (
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            {period === 'custom' && (
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <input type="date" className="coll-datein" value={customStart} onChange={e => setCustomStart(e.target.value)} />
                <span style={{ color:C.faint, fontSize:12 }}>to</span>
                <input type="date" className="coll-datein" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            )}
            <SegControl options={PERIODS.map(p => ({ value:p.key, label:p.label }))}
              value={period} onChange={setPeriod} size="sm" ariaLabel="Time period" />
          </div>
        )}
      </div>

      {view === 'board' && canSeeBoard && <StatusBoard />}
      {view === 'timesheet' && (
        <TimesheetView db={db} startDate={startDate} endDate={endDate}
          currentUser={currentUser} employees={employees} isAdmin={isAdmin} />
      )}
      {view === 'requests' && isAdmin && (
        <RequestsView db={db} currentUser={currentUser} onReviewed={loadReqCount} />
      )}
      {view === 'job' && isAdmin && (
        <JobView db={db} startDate={startDate} endDate={endDate} employees={employees} />
      )}
      {view === 'payroll' && isAdmin && (
        <PayrollView db={db} startDate={startDate} endDate={endDate} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TIMESHEET VIEW — KPIs + grid table; inline edit, row + bulk actions
// ══════════════════════════════════════════════════════════════
function TimesheetView({ db, startDate, endDate, currentUser, employees, isAdmin }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy]       = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry]       = useState(null);
  const [reqEntry, setReqEntry]         = useState(null);
  const [jobs, setJobs] = useState([]);

  // filters (local to this tab)
  const [q, setQ] = useState('');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterDivision, setFilterDivision] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');

  // inline + delete state
  const [editCell, setEditCell] = useState(null);
  const [editVal, setEditVal]   = useState('');
  const [delTarget, setDelTarget] = useState(null);
  const [delReason, setDelReason] = useState('');
  const [bulkDel, setBulkDel]     = useState(false);
  const [bulkReason, setBulkReason] = useState('');

  const effectiveEmployee = !isAdmin ? (currentUser?.id || null) : (filterEmployee || null);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(null);
    try {
      const data = await db.rpc('get_timesheet_entries_admin', {
        p_start_date:  startDate,
        p_end_date:    endDate,
        p_employee_id: effectiveEmployee,
        p_job_id:      null,
        p_status:      filterStatus || null,
        p_division:    filterDivision || null,
      });
      setEntries(data || []);
    } catch (err) { setError(friendlyErr(err.message)); }
    finally { setLoading(false); }
  }, [db, startDate, endDate, effectiveEmployee, filterDivision, filterStatus]);

  useEffect(() => { load(); }, [load]);
  useRealtimeReload(['job_time_entries','time_entry_change_requests'], load);

  useEffect(() => {
    if (!isAdmin) return;
    db.select('jobs','select=id,job_number,insured_name,division&order=created_at.desc&limit=300')
      .then(setJobs).catch(() => {});
  }, [db, isAdmin]);

  // client-side text search over the fetched rows
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(e =>
      (e.employee_name || '').toLowerCase().includes(needle) ||
      (e.job_number || '').toLowerCase().includes(needle) ||
      (e.insured_name || '').toLowerCase().includes(needle)
    );
  }, [entries, q]);

  const grouped = useMemo(() => {
    const g = {};
    for (const e of filtered) {
      if (!g[e.employee_id]) g[e.employee_id] = { name: e.employee_name, entries: [] };
      g[e.employee_id].entries.push(e);
    }
    return g;
  }, [filtered]);

  const totalHours   = filtered.reduce((s,e) => s + Number(e.hours||0), 0);
  const totalCost    = filtered.reduce((s,e) => s + Number(e.total_cost||0), 0);
  const pendingCount = filtered.filter(e => !e.approved).length;
  const openCount    = filtered.filter(e => e.is_open).length;

  const selectableIds = useMemo(() => filtered.filter(e => !e.approved).map(e => e.id), [filtered]);
  const selectedEntries = useMemo(() => filtered.filter(e => selected.has(e.id)), [filtered, selected]);
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
      await db.rpc('approve_time_entries', { p_entry_ids: [...selected], p_approved_by: currentUser?.id, p_approved: approve });
      okToast(`${selected.size} entr${selected.size>1?'ies':'y'} ${approve?'approved':'unapproved'}`);
      clearSel(); load();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  const handleUnapproveEdit = async (entry) => {
    setBusy(true);
    try {
      await db.rpc('approve_time_entries', { p_entry_ids: [entry.id], p_approved_by: currentUser?.id, p_approved: false });
      setEditEntry({ ...entry, approved: false }); setShowAddModal(true);
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

  const startEdit = (entry, field) => {
    if (entry.approved || !isAdmin) return;
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

  const activeFilterCount = (filterEmployee ? 1 : 0) + (filterDivision ? 1 : 0);
  const cols = isAdmin
    ? '30px 1.3fr 1fr 1.7fr 0.85fr 0.95fr 0.75fr 0.95fr 1.05fr 128px'
    : '1.3fr 1fr 1.7fr 0.85fr 0.95fr 0.75fr 0.95fr 1.05fr 110px';
  const headStyle = { display:'grid', gridTemplateColumns:cols, gap:12, alignItems:'center' };

  // ─── SECTION: Render ──────────────
  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="Total hours" value={fmtHours(totalHours)} />
        <Kpi label="Total labor" value={money(totalCost)} valueColor={STATUS.success.text} />
        <Kpi label="Open clocks" value={openCount} valueColor={openCount ? STATUS.warning.text : C.ink}
          active={filterStatus === 'open'} onClick={() => setFilterStatus(filterStatus === 'open' ? '' : 'open')}>
          {openCount > 0 ? 'tap to filter' : 'all clocked out'}
        </Kpi>
        {isAdmin && (
          <Kpi label="Pending approval" value={pendingCount} valueColor={pendingCount ? STATUS.warning.text : STATUS.success.text}
            active={filterStatus === 'unapproved'} onClick={() => setFilterStatus(filterStatus === 'unapproved' ? '' : 'unapproved')}>
            {pendingCount > 0 ? 'tap to filter' : 'all approved'}
          </Kpi>
        )}
      </KpiGrid>

      <CollCard pad={0}>
        <div className="coll-toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search employee, job, client…" style={{ flex:'1 1 220px' }} />
          <SegControl options={STATUS_SEG} value={filterStatus} onChange={setFilterStatus} size="sm" ariaLabel="Status filter" />
          {isAdmin && (
            <PopoverButton label="Filters" icon={<FunnelIcon />} count={activeFilterCount} width={260}>
              {() => (
                <>
                  <FilterGroup label="Employee">
                    <select className="coll-select" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
                      <option value="">All employees</option>
                      {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                    </select>
                  </FilterGroup>
                  <FilterGroup label="Division">
                    <div className="coll-filter-chips">
                      {DIVISIONS.map(d => (
                        <ToggleChip key={d} active={filterDivision === d} swatch={divColor(d)}
                          onClick={() => setFilterDivision(filterDivision === d ? '' : d)}>
                          {divLabel(d)}
                        </ToggleChip>
                      ))}
                    </div>
                  </FilterGroup>
                </>
              )}
            </PopoverButton>
          )}

          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {isAdmin && selected.size > 0 && !bulkDel && <>
              <span style={{ fontSize:12, color:C.muted }}>{selected.size} selected · {fmtHours(selHours)}</span>
              <GhostButton onClick={() => handleApprove(false)}>Unapprove</GhostButton>
              <PrimaryButton onClick={() => handleApprove(true)}>{busy ? '…' : `Approve ${selected.size}`}</PrimaryButton>
              {selOpen > 0 && <GhostButton onClick={handleBulkClockOut}>Clock out {selOpen}</GhostButton>}
              <GhostButton onClick={() => setBulkDel(true)} style={{ color:STATUS.danger.text }}>Delete</GhostButton>
            </>}
            {isAdmin && bulkDel && <>
              <input className="coll-datein" placeholder="Reason for deleting…" value={bulkReason} autoFocus
                onChange={e => setBulkReason(e.target.value)} style={{ minWidth:170 }} />
              <GhostButton onClick={() => { setBulkDel(false); setBulkReason(''); }}>Cancel</GhostButton>
              <button type="button" className="coll-primary" onClick={confirmBulkDelete}
                style={{ background:STATUS.danger.solid }}>
                {busy ? '…' : `Delete ${selectedEntries.filter(e=>!e.approved).length}`}
              </button>
            </>}
            {isAdmin && selected.size === 0 && (
              <PrimaryButton onClick={() => { setEditEntry(null); setShowAddModal(true); }}>+ Backfill entry</PrimaryButton>
            )}
          </div>
        </div>

        {loading ? (
          <div className="coll-loading">Loading time entries…</div>
        ) : error ? (
          <div className="coll-empty">
            <div className="coll-empty-title" style={{ color:STATUS.danger.text }}>{error}</div>
            <button className="coll-link" onClick={load}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="⏱" title="No time entries for this period"
            sub="Entries appear here once techs clock in via the mobile app" />
        ) : (
          <div className="coll-tablewrap">
            <div className="coll-thead" style={headStyle}>
              {isAdmin && (
                <span><input type="checkbox" className="coll-check"
                  checked={selectableIds.length > 0 && selected.size === selectableIds.length}
                  onChange={selectAll} /></span>
              )}
              <span>Employee</span>
              <span>Date</span>
              <span>Job</span>
              <span>Clock in</span>
              <span>Clock out</span>
              <span style={{ textAlign:'right' }}>Hours</span>
              <span style={{ textAlign:'right' }}>Cost</span>
              <span>Status</span>
              <span />
            </div>

            {Object.values(grouped).map(group => {
              const gHours = group.entries.reduce((s,e) => s+Number(e.hours||0), 0);
              const gCost  = group.entries.reduce((s,e) => s+Number(e.total_cost||0), 0);
              return (
                <div key={group.name}>
                  <div className="tt-group-bar">
                    <span style={{ fontWeight:700, fontSize:13, color:C.title }}>{group.name}</span>
                    <span style={{ display:'flex', gap:16, ...tnum }}>
                      <span style={{ fontSize:12, color:C.muted }}>{fmtHours(gHours)}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:STATUS.success.text }}>{money(gCost)}</span>
                    </span>
                  </div>

                  {group.entries.map(entry => {
                    const editing = (f) => editCell?.id === entry.id && editCell.field === f;
                    const editable = isAdmin && !entry.approved;
                    return (
                      <div key={entry.id} className="coll-row coll-static"
                        style={{ ...headStyle, ...(entry.approved ? { background:'#fcfdfe' } : null) }}>
                        {isAdmin && (
                          <span>{!entry.approved && (
                            <input type="checkbox" className="coll-check"
                              checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} />
                          )}</span>
                        )}
                        <span style={{ fontSize:13, color:C.body }}>{entry.employee_name}</span>
                        <span style={{ fontSize:12.5, cursor:editable?'pointer':'default' }}
                          onClick={() => editable && startEdit(entry, 'work_date')}>
                          {editing('work_date')
                            ? <input autoFocus type="date" className="tt-inline-input" value={editVal}
                                onChange={e => setEditVal(e.target.value)} onBlur={() => commitInline(entry,'work_date')}
                                onKeyDown={e => { if (e.key==='Enter') e.target.blur(); if (e.key==='Escape') setEditCell(null); }} />
                            : fmtDateLong(entry.work_date)}
                        </span>
                        <span style={{ minWidth:0, display:'flex', alignItems:'center', gap:7 }}>
                          <DivisionSquare division={entry.division} size={8} />
                          <span style={{ minWidth:0 }}>
                            <span style={{ display:'block', fontSize:12.5, fontWeight:600, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{entry.job_number || '—'}</span>
                            <span style={{ display:'block', fontSize:11.5, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{entry.insured_name}</span>
                          </span>
                        </span>
                        <span style={{ fontSize:12.5, color:C.body }}>{fmtTime(entry.clock_in)}</span>
                        <span style={{ fontSize:12.5 }}>
                          {entry.is_open
                            ? <Pill color={STATUS.warning.text} bg={STATUS.warning.tint} border={STATUS.warning.border}>OPEN</Pill>
                            : <span style={{ color:C.body }}>{fmtTime(entry.clock_out)}</span>}
                        </span>
                        <span style={{ textAlign:'right', fontWeight:600, ...tnum, cursor:editable?'pointer':'default',
                          color: entry.is_overlong ? STATUS.danger.text : C.ink }}
                          onClick={() => editable && startEdit(entry, 'hours')}>
                          {editing('hours')
                            ? <input autoFocus type="number" step="0.25" min="0" max="24" className="tt-inline-input" value={editVal}
                                onChange={e => setEditVal(e.target.value)} onBlur={() => commitInline(entry,'hours')}
                                onKeyDown={e => { if (e.key==='Enter') e.target.blur(); if (e.key==='Escape') setEditCell(null); }}
                                style={{ textAlign:'right' }} />
                            : fmtHours(entry.hours)}
                        </span>
                        <span style={{ textAlign:'right', fontWeight:600, ...tnum }}>{costCell(entry.total_cost)}</span>
                        <span><RowBadges entry={entry} isAdmin={isAdmin} /></span>

                        {!isAdmin ? (
                          <span style={{ display:'flex', justifyContent:'flex-end' }}>
                            <button type="button" className="tt-icon-btn" title="Request a change"
                              onClick={() => setReqEntry(entry)}
                              style={{ width:'auto', padding:'0 10px', gap:5, fontSize:11.5, fontWeight:600 }}>
                              Request
                            </button>
                          </span>
                        ) : (
                          <span>
                            {delTarget === entry.id ? (
                              <div style={{ display:'flex', gap:4, alignItems:'center', justifyContent:'flex-end' }}>
                                <input className="tt-inline-input" placeholder="Reason…" value={delReason} autoFocus
                                  onChange={e => setDelReason(e.target.value)}
                                  onKeyDown={e => { if (e.key==='Enter') confirmDelete(entry); if (e.key==='Escape') setDelTarget(null); }}
                                  style={{ width:96 }} />
                                <button className="tt-icon-btn tt-icon-btn-danger" title="Confirm delete"
                                  onClick={() => confirmDelete(entry)}
                                  style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca' }}>
                                  <span style={{ fontSize:11, fontWeight:700 }}>✓</span>
                                </button>
                              </div>
                            ) : (
                              <div style={{ display:'flex', gap:3, justifyContent:'flex-end' }}>
                                {entry.is_open && (
                                  <button className="tt-icon-btn" title="Clock out" onClick={() => handleClockOut(entry)} disabled={busy}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                                  </button>
                                )}
                                <button className="tt-icon-btn" title={entry.approved ? 'Unapprove & edit' : 'Edit'}
                                  onClick={() => entry.approved ? handleUnapproveEdit(entry) : (setEditEntry(entry), setShowAddModal(true))} disabled={busy}>
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
                              </div>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="coll-foot">
            <div>{filtered.length} entr{filtered.length>1?'ies':'y'} · {fmtHours(totalHours)} · {money(totalCost)}</div>
          </div>
        )}
      </CollCard>

      {showAddModal && (
        <EntryModal entry={editEntry} employees={employees} jobs={jobs} db={db} actorId={currentUser?.id}
          onClose={() => { setShowAddModal(false); setEditEntry(null); }}
          onSaved={() => { setShowAddModal(false); setEditEntry(null); load(); }} />
      )}
      {reqEntry && (
        <RequestModal entry={reqEntry} db={db} actorId={currentUser?.id}
          onClose={() => setReqEntry(null)} onSaved={() => { setReqEntry(null); load(); }} />
      )}
    </>
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
  if (key === 'work_date') return fmtDateLong(val);
  if (key === 'hours')     return fmtHours(val);
  if (key === 'clock_in' || key === 'clock_out') return fmtTime(val);
  return String(val);
}

function RequestsView({ db, currentUser, onReviewed }) {
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [rejecting, setRejecting] = useState(null);

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
      onReviewed?.(); load();
    } catch (err) { errToast('Failed: ' + friendlyErr(err.message)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="Pending requests" value={rows.length}
          valueColor={rows.length ? STATUS.warning.text : STATUS.success.text}>
          {rows.length ? 'awaiting review' : 'all caught up'}
        </Kpi>
      </KpiGrid>

      {loading ? (
        <CollCard><div className="coll-loading">Loading requests…</div></CollCard>
      ) : error ? (
        <CollCard><div className="coll-empty"><div className="coll-empty-title" style={{ color:STATUS.danger.text }}>{error}</div><button className="coll-link" onClick={load}>Retry</button></div></CollCard>
      ) : rows.length === 0 ? (
        <CollCard><EmptyState icon="✅" title="No pending change requests" sub="Edit requests from the field app land here" /></CollCard>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {rows.map(req => {
            const keys = Object.keys(PROPOSED_LABELS).filter(k => req.proposed && req.proposed[k] != null && req.proposed[k] !== '');
            return (
              <CollCard key={req.id}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:10 }}>
                  <div>
                    <span style={{ fontWeight:700, color:C.ink }}>{req.requester}</span>
                    <span style={{ color:C.muted, fontSize:12, marginLeft:8 }}>
                      {req.entry ? fmtDateLong(req.entry.work_date) : 'entry missing'} · requested {fmtDateLong((req.created_at||'').slice(0,10))}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    {rejecting === req.id ? (
                      <>
                        <input className="coll-datein" placeholder="Reason (optional)…" autoFocus id={`rej-${req.id}`}
                          onKeyDown={e => { if (e.key==='Enter') review(req, false, e.target.value); if (e.key==='Escape') setRejecting(null); }}
                          style={{ width:160 }} />
                        <GhostButton onClick={() => setRejecting(null)}>Cancel</GhostButton>
                        <button type="button" className="coll-primary" style={{ background:STATUS.danger.solid }} disabled={busy}
                          onClick={() => review(req, false, document.getElementById(`rej-${req.id}`)?.value)}>Confirm reject</button>
                      </>
                    ) : (
                      <>
                        <GhostButton onClick={() => setRejecting(req.id)}>Reject</GhostButton>
                        <PrimaryButton onClick={() => review(req, true)}>Approve</PrimaryButton>
                      </>
                    )}
                  </div>
                </div>
                {req.tech_note && (
                  <div style={{ fontSize:13, color:C.body, fontStyle:'italic', background:C.headFill, padding:'8px 10px', borderRadius:8, marginBottom:10 }}>
                    “{req.tech_note}”
                  </div>
                )}
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {keys.length === 0 && <span style={{ color:C.muted, fontSize:12 }}>No field changes proposed</span>}
                  {keys.map(k => {
                    const current = req.entry ? req.entry[k] : null;
                    const changed = String(current ?? '') !== String(req.proposed[k] ?? '');
                    return (
                      <div key={k} style={{ display:'grid', gridTemplateColumns:'120px 1fr 18px 1fr', alignItems:'center', gap:8, fontSize:12.5 }}>
                        <span style={{ fontWeight:700, color:C.faint, textTransform:'uppercase', fontSize:10.5, letterSpacing:'.04em' }}>{PROPOSED_LABELS[k]}</span>
                        <span style={{ color:C.faint, textDecoration:'line-through' }}>{fmtProposed(k, current)}</span>
                        <span style={{ color:C.faint, textAlign:'center' }}>→</span>
                        <span style={{ fontWeight: changed ? 700 : 400, color: changed ? STATUS.info.text : C.body }}>{fmtProposed(k, req.proposed[k])}</span>
                      </div>
                    );
                  })}
                </div>
              </CollCard>
            );
          })}
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// BY JOB VIEW — labor cost per job, expandable employee breakdown
// ══════════════════════════════════════════════════════════════
function JobView({ db, startDate, endDate, employees }) {
  const [data, setData]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedJob, setExpandedJob] = useState(null);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(null);
    try {
      const rows = await db.rpc('get_job_labor_summary', { p_job_id: null, p_start_date: startDate, p_end_date: endDate });
      const filtered = filterEmployee ? (rows||[]).filter(r => r.employee_id === filterEmployee) : (rows||[]);
      setData(filtered);
    } catch (err) { setError(friendlyErr(err.message)); }
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
      g[r.job_id].total_hours   += Number(r.total_hours||0);
      g[r.job_id].total_cost    += Number(r.total_cost||0);
      g[r.job_id].approved_cost += Number(r.approved_cost||0);
      g[r.job_id].rows.push(r);
    }
    let list = Object.values(g).sort((a,b) => b.total_cost - a.total_cost);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter(j => (j.job_number||'').toLowerCase().includes(needle) || (j.insured_name||'').toLowerCase().includes(needle));
    return list;
  }, [data, q]);

  const grandHours = jobGroups.reduce((s,j) => s+j.total_hours, 0);
  const grandCost  = jobGroups.reduce((s,j) => s+j.total_cost, 0);

  const cols = '1.4fr 1.6fr 1fr 0.8fr 1fr 1fr 28px';
  const headStyle = { display:'grid', gridTemplateColumns:cols, gap:12, alignItems:'center' };

  return (
    <>
      <KpiGrid cols={3}>
        <Kpi label="Jobs with labor" value={jobGroups.length} />
        <Kpi label="Total hours" value={fmtHours(grandHours)} />
        <Kpi label="Total labor cost" value={money(grandCost)} valueColor={STATUS.success.text} />
      </KpiGrid>

      <CollCard pad={0}>
        <div className="coll-toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search job # or client…" style={{ flex:'1 1 220px' }} />
          <select className="coll-select" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} style={{ maxWidth:200 }}>
            <option value="">All employees</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="coll-loading">Loading labor by job…</div>
        ) : error ? (
          <div className="coll-empty"><div className="coll-empty-title" style={{ color:STATUS.danger.text }}>{error}</div><button className="coll-link" onClick={load}>Retry</button></div>
        ) : jobGroups.length === 0 ? (
          <EmptyState icon="🏗️" title="No labor recorded for this period" />
        ) : (
          <div className="coll-tablewrap">
            <div className="coll-thead" style={headStyle}>
              <span>Job #</span><span>Client</span><span>Division</span>
              <span style={{ textAlign:'right' }}>Hours</span>
              <span style={{ textAlign:'right' }}>Labor cost</span>
              <span style={{ textAlign:'right' }}>Approved</span>
              <span />
            </div>
            {jobGroups.map(job => {
              const isOpen = expandedJob === job.job_id;
              return (
                <div key={job.job_id}>
                  <div className="coll-row" style={headStyle} onClick={() => setExpandedJob(isOpen ? null : job.job_id)}>
                    <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <DivisionSquare division={job.division} size={9} />
                      <span style={{ fontWeight:700, color:C.ink }}>{job.job_number || '—'}</span>
                    </span>
                    <span style={{ fontSize:13, color:C.body, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{job.insured_name}</span>
                    <span style={{ fontSize:12, fontWeight:600, color:divColor(job.division) }}>{divLabel(job.division)}</span>
                    <span style={{ textAlign:'right', fontWeight:600, ...tnum }}>{fmtHours(job.total_hours)}</span>
                    <span style={{ textAlign:'right', fontWeight:700, color:STATUS.success.text, ...tnum }}>{money(job.total_cost)}</span>
                    <span style={{ textAlign:'right', fontSize:12.5, color:C.muted, ...tnum }}>{money(job.approved_cost)}</span>
                    <span style={{ textAlign:'right', fontSize:11, color:C.faint }}>{isOpen?'▾':'▸'}</span>
                  </div>
                  {isOpen && (
                    <div style={{ background:C.headFill, padding:'4px 18px 10px 34px' }}>
                      {job.rows.map(r => (
                        <div key={r.employee_id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1fr 0.8fr', gap:12, padding:'7px 0', borderBottom:`1px solid ${C.hairline}`, fontSize:12.5 }}>
                          <span style={{ color:C.body }}>{r.employee_name}</span>
                          <span style={{ textAlign:'right', fontWeight:600, ...tnum }}>{fmtHours(r.total_hours)}</span>
                          <span style={{ textAlign:'right', ...tnum }}>{costCell(r.total_cost)}</span>
                          <span style={{ textAlign:'right', color:C.muted, ...tnum }}>{r.entry_count} entr{r.entry_count>1?'ies':'y'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!loading && !error && jobGroups.length > 0 && (
          <div className="coll-foot"><div>{jobGroups.length} jobs · {fmtHours(grandHours)} · {money(grandCost)}</div></div>
        )}
      </CollCard>
    </>
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
    } catch (err) { setError(friendlyErr(err.message)); }
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

  const cols = '1.4fr 0.9fr 0.9fr 0.8fr 0.9fr 1fr 0.9fr 1fr 0.9fr';
  const headStyle = { display:'grid', gridTemplateColumns:cols, gap:12, alignItems:'center' };

  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="Employees" value={data.length} />
        <Kpi label="Total hours" value={fmtHours(totalHours)} />
        <Kpi label="OT hours" value={fmtHours(totalOT)} valueColor={totalOT ? STATUS.warning.text : C.ink} />
        <Kpi label="Total payroll" value={money(totalPay)} valueColor={STATUS.success.text}>
          {totalPending > 0 ? `${fmtHours(totalPending)} pending approval` : 'all approved'}
        </Kpi>
      </KpiGrid>

      <CollCard pad={0}>
        <div className="coll-toolbar">
          <span style={{ fontSize:13, fontWeight:700, color:C.title }}>Payroll summary</span>
          <div style={{ marginLeft:'auto' }}>
            <GhostButton onClick={handleExportCSV}>↓ Export CSV</GhostButton>
          </div>
        </div>

        {loading ? (
          <div className="coll-loading">Loading payroll…</div>
        ) : error ? (
          <div className="coll-empty"><div className="coll-empty-title" style={{ color:STATUS.danger.text }}>{error}</div><button className="coll-link" onClick={load}>Retry</button></div>
        ) : data.length === 0 ? (
          <EmptyState icon="💰" title="No payroll data for this period" />
        ) : (
          <div className="coll-tablewrap">
            <div className="coll-thead" style={headStyle}>
              <span>Employee</span>
              <span style={{ textAlign:'right' }}>Rate</span>
              <span style={{ textAlign:'right' }}>Reg hrs</span>
              <span style={{ textAlign:'right' }}>OT hrs</span>
              <span style={{ textAlign:'right' }}>Total hrs</span>
              <span style={{ textAlign:'right' }}>Reg pay</span>
              <span style={{ textAlign:'right' }}>OT pay</span>
              <span style={{ textAlign:'right' }}>Total pay</span>
              <span style={{ textAlign:'right' }}>Pending</span>
            </div>
            {data.map(emp => (
              <div key={emp.employee_id} className="coll-row coll-static" style={headStyle}>
                <span style={{ fontWeight:600, color:C.ink }}>{emp.employee_name}</span>
                <span style={{ textAlign:'right', fontSize:12.5, color:C.body, ...tnum }}>{emp.hourly_rate ? `$${Number(emp.hourly_rate).toFixed(2)}` : '—'}</span>
                <span style={{ textAlign:'right', ...tnum }}>{fmtHours(emp.regular_hours)}</span>
                <span style={{ textAlign:'right', ...tnum, color: Number(emp.overtime_hours||0) > 0 ? STATUS.warning.text : C.faint, fontWeight: Number(emp.overtime_hours||0)>0?600:400 }}>
                  {Number(emp.overtime_hours||0) > 0 ? fmtHours(emp.overtime_hours) : '—'}
                </span>
                <span style={{ textAlign:'right', fontWeight:600, ...tnum }}>{fmtHours(emp.total_hours)}</span>
                <span style={{ textAlign:'right', ...tnum }}>{money(emp.regular_cost)}</span>
                <span style={{ textAlign:'right', ...tnum, color: Number(emp.overtime_cost||0) > 0 ? STATUS.warning.text : C.faint }}>
                  {Number(emp.overtime_cost||0) > 0 ? money(emp.overtime_cost) : '—'}
                </span>
                <span style={{ textAlign:'right', fontWeight:700, color:STATUS.success.text, ...tnum }}>{money(emp.total_cost)}</span>
                <span style={{ textAlign:'right', ...tnum }}>
                  {Number(emp.pending_hours||0) > 0
                    ? <span style={{ color:STATUS.warning.text, fontWeight:600 }}>{fmtHours(emp.pending_hours)}</span>
                    : <span style={{ color:STATUS.success.text, fontSize:11 }}>✓ clear</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {!loading && !error && data.length > 0 && (
          <div className="coll-foot">
            <div>{data.length} employees · {fmtHours(totalHours)} · {money(totalPay)}</div>
            <button className="coll-link" onClick={handleExportCSV}>Export CSV →</button>
          </div>
        )}
      </CollCard>
    </>
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
    return jobs.filter(j => j.job_number?.toLowerCase().includes(q) || j.insured_name?.toLowerCase().includes(q)).slice(0, 40);
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
              value={jobSearch} onChange={e => setJobSearch(e.target.value)} style={{ marginBottom:6 }} />
            <select className="input" value={form.job_id} onChange={e => set('job_id', e.target.value)} size={5} style={{ height:'auto', minHeight:90 }}>
              {filteredJobs.map(j => (
                <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} — ` : ''}{j.insured_name}</option>
              ))}
            </select>
            {form.job_id && <div style={{ fontSize:11, color:'var(--accent)', marginTop:4 }}>✓ {jobs.find(j=>j.id===form.job_id)?.insured_name || 'Job selected'}</div>}
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Date *</label>
              <input type="date" className="input" value={form.work_date} onChange={e => set('work_date', e.target.value)} />
            </div>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">On-site Hours {showTimes ? '' : '*'}</label>
              <input type="number" className="input" value={form.hours} onChange={e => set('hours', e.target.value)} min="0" max="24" step="0.25" placeholder="e.g. 7.5" />
            </div>
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Work Type</label>
            <select className="input" value={form.work_type} onChange={e => set('work_type', e.target.value)}>
              {WORK_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
          </div>

          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf:'flex-start' }} onClick={() => setShowTimes(s => !s)}>
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
                <input type="number" className="input" value={form.travel_minutes} onChange={e => set('travel_minutes', e.target.value)} min="0" step="1" placeholder="e.g. 20" />
              </div>
              <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>
                Order must be Travel ≤ Clock In ≤ On-site End ≤ Clock Out. On-site hours above is what bills.
              </div>
            </div>
          )}

          <div className="tt-form-group">
            <label className="tt-label">Description</label>
            <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What work was done…" />
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Notes</label>
            <textarea className="input textarea" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Internal notes…" style={{ resize:'vertical' }}/>
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
            {fmtDateLong(entry?.work_date)} · {entry?.job_number || 'Job'} — {entry?.insured_name}
          </div>
          <div style={{ display:'flex', gap:12 }}>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Date</label>
              <input type="date" className="input" value={form.work_date} onChange={e => set('work_date', e.target.value)} />
            </div>
            <div className="tt-form-group" style={{ flex:1 }}>
              <label className="tt-label">Hours</label>
              <input type="number" className="input" value={form.hours} min="0" max="24" step="0.25" onChange={e => set('hours', e.target.value)} />
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
