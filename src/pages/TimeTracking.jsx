import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

// ── Date helpers ──────────────────────────────────────────────
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
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m)-1, Number(d))
    .toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
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

const DIVISION_COLORS = {
  water:'#2563eb', mold:'#9d174d', reconstruction:'#d97706',
  fire:'#dc2626', contents:'#059669',
};
const WORK_TYPES = ['regular','overtime','travel','admin','training','other'];
const PERIODS = [
  { key:'this_week',  label:'This Week',  ...getWeekBounds(0) },
  { key:'last_week',  label:'Last Week',  ...getWeekBounds(-1) },
  { key:'this_month', label:'This Month', ...getMonthBounds(0) },
  { key:'last_month', label:'Last Month', ...getMonthBounds(-1) },
  { key:'custom',     label:'Custom',     start:'', end:'' },
];

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function TimeTracking() {
  const { db, employee: currentUser } = useAuth();
  const [view, setView] = useState('timesheet');
  const [period, setPeriod] = useState('this_week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    db.select('employees','is_active=eq.true&order=full_name.asc&select=id,full_name,hourly_rate')
      .then(setEmployees).catch(() => {});
  }, [db]);

  const activePeriod = PERIODS.find(p => p.key === period) || PERIODS[0];
  const startDate = period === 'custom' ? customStart : activePeriod.start;
  const endDate   = period === 'custom' ? customEnd   : activePeriod.end;

  return (
    <div className="tt-page">
      <div className="tt-topbar">
        <div>
          <h1 className="page-title">Time Tracking</h1>
          <p className="page-subtitle">{fmtDate(startDate)} — {fmtDate(endDate)}</p>
        </div>
        <div className="tt-view-tabs">
          <button className={`tt-view-tab${view==='timesheet'?' active':''}`} onClick={() => setView('timesheet')}>Timesheet</button>
          <button className={`tt-view-tab${view==='job'?' active':''}`} onClick={() => setView('job')}>By Job</button>
          <button className={`tt-view-tab${view==='payroll'?' active':''}`} onClick={() => setView('payroll')}>Payroll</button>
        </div>
      </div>

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
        {view !== 'payroll' && (
          <select className="input" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} style={{ height:32, fontSize:13, minWidth:160 }}>
            <option value="all">All Employees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        )}
      </div>

      {view === 'timesheet' && (
        <TimesheetView db={db} startDate={startDate} endDate={endDate}
          filterEmployee={filterEmployee === 'all' ? null : filterEmployee}
          currentUser={currentUser} employees={employees} />
      )}
      {view === 'job' && (
        <JobView db={db} startDate={startDate} endDate={endDate}
          filterEmployee={filterEmployee === 'all' ? null : filterEmployee} />
      )}
      {view === 'payroll' && (
        <PayrollView db={db} startDate={startDate} endDate={endDate} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TIMESHEET VIEW — grouped by employee, approve/edit/delete
// ══════════════════════════════════════════════════════════════
function TimesheetView({ db, startDate, endDate, filterEmployee, currentUser, employees }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [approving, setApproving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [jobs, setJobs] = useState([]);

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(null);
    try {
      const data = await db.rpc('get_timesheet_entries', {
        p_start_date:  startDate,
        p_end_date:    endDate,
        p_employee_id: filterEmployee || null,
      });
      setEntries(data || []);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [db, startDate, endDate, filterEmployee]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    db.select('jobs','select=id,job_number,insured_name,division&order=created_at.desc&limit=200')
      .then(setJobs).catch(() => {});
  }, [db]);

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

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectAll = () => {
    const pending = entries.filter(e => !e.approved).map(e => e.id);
    setSelected(prev => prev.size === pending.length ? new Set() : new Set(pending));
  };

  const handleApprove = async (approve = true) => {
    if (selected.size === 0) return;
    setApproving(true);
    try {
      await db.rpc('approve_time_entries', {
        p_entry_ids: [...selected], p_approved_by: currentUser?.id, p_approved: approve,
      });
      okToast(`${selected.size} entr${selected.size>1?'ies':'y'} ${approve?'approved':'unapproved'}`);
      setSelected(new Set()); load();
    } catch (err) { errToast('Failed: ' + err.message); }
    finally { setApproving(false); }
  };

  const [confirmDel, setConfirmDel] = useState(null);
  const handleDelete = async (id) => {
    if (confirmDel !== id) { setConfirmDel(id); return; }
    setConfirmDel(null);
    try {
      await db.delete('job_time_entries', `id=eq.${id}`);
      setEntries(prev => prev.filter(e => e.id !== id));
      okToast('Entry deleted');
    } catch (err) { errToast('Failed: ' + err.message); }
  };

  if (loading) return <div className="tt-loading"><div className="spinner"/></div>;
  if (error)   return <div className="tt-error">{error} <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>;

  return (
    <div className="tt-content">
      <div className="tt-summary-bar">
        <SummaryCard label="Total Hours" value={fmtHours(totalHours)} />
        <SummaryCard label="Total Labor" value={fmtMoney(totalCost)} accent />
        <SummaryCard label="Entries" value={entries.length} />
        <SummaryCard label="Pending Approval" value={pendingCount} warn={pendingCount > 0} />
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {selected.size > 0 && <>
            <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{selected.size} selected</span>
            <button className="btn btn-secondary btn-sm" onClick={() => handleApprove(false)} disabled={approving}>Unapprove</button>
            <button className="btn btn-primary btn-sm" onClick={() => handleApprove(true)} disabled={approving}>
              {approving ? 'Approving…' : `Approve ${selected.size}`}
            </button>
          </>}
          <button className="btn btn-secondary btn-sm" onClick={() => { setEditEntry(null); setShowAddModal(true); }}>
            + Add Entry
          </button>
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
                <th style={{ width:36 }}>
                  <input type="checkbox"
                    checked={selected.size > 0 && selected.size === entries.filter(e=>!e.approved).length}
                    onChange={selectAll} />
                </th>
                <th>Employee</th>
                <th>Date</th>
                <th>Job</th>
                <th>Type</th>
                <th className="tt-th-num">Hours</th>
                <th className="tt-th-num">Rate</th>
                <th className="tt-th-num">Cost</th>
                <th>Status</th>
                <th style={{ width:72 }}></th>
              </tr>
            </thead>
            <tbody>
              {Object.values(grouped).map(group => {
                const gHours = group.entries.reduce((s,e) => s+Number(e.hours||0), 0);
                const gCost  = group.entries.reduce((s,e) => s+Number(e.total_cost||0), 0);
                return [
                  <tr key={`hdr-${group.name}`} className="tt-group-row">
                    <td/>
                    <td colSpan={4} style={{ fontWeight:700, fontSize:13 }}>{group.name}</td>
                    <td className="tt-td-num" style={{ fontWeight:700 }}>{fmtHours(gHours)}</td>
                    <td/>
                    <td className="tt-td-num" style={{ fontWeight:700, color:'var(--accent)' }}>{fmtMoney(gCost)}</td>
                    <td colSpan={2}/>
                  </tr>,
                  ...group.entries.map(entry => (
                    <tr key={entry.id} className={entry.approved ? 'tt-row-approved' : ''}>
                      <td>
                        {!entry.approved && (
                          <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} />
                        )}
                      </td>
                      <td style={{ color:'var(--text-secondary)', paddingLeft:20 }}>{entry.employee_name}</td>
                      <td style={{ whiteSpace:'nowrap', fontSize:12 }}>{fmtDate(entry.work_date)}</td>
                      <td>
                        <div style={{ fontWeight:600, fontSize:12 }}>{entry.job_number || '—'}</div>
                        <div style={{ fontSize:11, color:'var(--text-tertiary)' }}>{entry.insured_name}</div>
                      </td>
                      <td><span className="tt-work-type">{entry.work_type || 'regular'}</span></td>
                      <td className="tt-td-num" style={{ fontWeight:600 }}>{fmtHours(entry.hours)}</td>
                      <td className="tt-td-num" style={{ fontSize:12 }}>{entry.hourly_rate ? `$${Number(entry.hourly_rate).toFixed(2)}` : '—'}</td>
                      <td className="tt-td-num" style={{ fontWeight:600 }}>{fmtCost(entry.total_cost)}</td>
                      <td>
                        {entry.approved
                          ? <span className="tt-status approved">Approved</span>
                          : <span className="tt-status pending">Pending</span>}
                      </td>
                      <td>
                        <div style={{ display:'flex', gap:3, justifyContent:'flex-end' }}>
                          <button className="tt-icon-btn" title="Edit"
                            onClick={() => { setEditEntry(entry); setShowAddModal(true); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button className="tt-icon-btn tt-icon-btn-danger" title={confirmDel === entry.id ? 'Confirm Delete' : 'Delete'}
                            onClick={() => handleDelete(entry.id)}
                            onBlur={() => setConfirmDel(null)}
                            style={confirmDel === entry.id ? { background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca' } : {}}>
                            {confirmDel === entry.id
                              ? <span style={{ fontSize:11, fontWeight:600 }}>Confirm</span>
                              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <EntryModal entry={editEntry} employees={employees} jobs={jobs} db={db}
          onClose={() => { setShowAddModal(false); setEditEntry(null); }}
          onSaved={() => { setShowAddModal(false); setEditEntry(null); load(); }} />
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
// ADD / EDIT ENTRY MODAL
// ══════════════════════════════════════════════════════════════
function EntryModal({ entry, employees, jobs, db, onClose, onSaved }) {
  const [form, setForm] = useState({
    employee_id:  entry?.employee_id  || '',
    job_id:       entry?.job_id       || '',
    work_date:    entry?.work_date    || toISO(new Date()),
    hours:        entry?.hours != null ? String(entry.hours) : '',
    work_type:    entry?.work_type    || 'regular',
    description:  entry?.description  || '',
    notes:        entry?.notes        || '',
  });
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
    if (!form.hours || Number(form.hours) <= 0) { errToast('Enter valid hours (e.g. 7.5)'); return; }
    setSaving(true);
    try {
      await db.rpc('upsert_time_entry', {
        p_id:          entry?.id || null,
        p_employee_id: form.employee_id,
        p_job_id:      form.job_id,
        p_work_date:   form.work_date,
        p_hours:       Number(form.hours),
        p_work_type:   form.work_type,
        p_description: form.description || null,
        p_notes:       form.notes || null,
      });
      okToast(entry ? 'Entry updated' : 'Entry added');
      onSaved();
    } catch (err) { errToast('Failed: ' + err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="tt-modal-backdrop" onClick={onClose}>
      <div className="tt-modal" onClick={e => e.stopPropagation()}>
        <div className="tt-modal-header">
          <span style={{ fontSize:15, fontWeight:700 }}>{entry ? 'Edit Time Entry' : 'Add Time Entry'}</span>
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
              <label className="tt-label">Hours *</label>
              <input type="number" className="input" value={form.hours}
                onChange={e => set('hours', e.target.value)}
                min="0.25" max="24" step="0.25" placeholder="e.g. 7.5" />
            </div>
          </div>
          <div className="tt-form-group">
            <label className="tt-label">Work Type</label>
            <select className="input" value={form.work_type} onChange={e => set('work_type', e.target.value)}>
              {WORK_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
          </div>
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
            {saving ? 'Saving…' : entry ? 'Save Changes' : 'Add Entry'}
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
