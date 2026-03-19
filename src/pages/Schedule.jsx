import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DIV_COLORS = {
  water:          { bg: '#dbeafe', text: '#1e40af', label: 'Water' },
  mold:           { bg: '#fce7f3', text: '#9d174d', label: 'Mold' },
  reconstruction: { bg: '#fef3c7', text: '#92400e', label: 'Recon' },
  fire:           { bg: '#fee2e2', text: '#991b1b', label: 'Fire' },
  contents:       { bg: '#d1fae5', text: '#065f46', label: 'Contents' },
};

const TYPE_COLORS = {
  monitoring: '#3b82f6', mitigation: '#0ea5e9', inspection: '#8b5cf6',
  reconstruction: '#f59e0b', estimate: '#10b981', delivery: '#6b7280',
  mold_remediation: '#059669', content_cleaning: '#8b5cf6', other: '#6b7280',
};

const STATUS_LABELS = {
  scheduled:   { label: 'Scheduled', color: '#3b82f6' },
  en_route:    { label: 'En Route',  color: '#f59e0b' },
  in_progress: { label: 'Active',    color: '#10b981' },
  paused:      { label: 'Paused',    color: '#ef4444' },
  completed:   { label: 'Done',      color: '#6b7280' },
  cancelled:   { label: 'Cancelled', color: '#9ca3af' },
};

// Map phases to panel groups
const ACTIVE_PHASES = [
  'emergency_response', 'mitigation_in_progress', 'drying', 'monitoring',
  'mold_remediation', 'content_packout', 'content_cleaning', 'content_storage',
  'demo_in_progress', 'reconstruction_in_progress', 'reconstruction_punch_list',
  'supplement_in_progress',
];
const READY_PHASES = ['job_received', 'estimate_submitted', 'estimate_approved', 'work_authorized'];
const WAITING_PHASES = [
  'pending_inspection', 'waiting_on_insurance', 'waiting_on_payment',
  'waiting_on_client', 'waiting_on_adjuster', 'on_hold',
  'supplement_submitted', 'supplement_review',
];

function classifyPhase(phase) {
  if (ACTIVE_PHASES.includes(phase)) return 'active';
  if (READY_PHASES.includes(phase)) return 'ready';
  if (WAITING_PHASES.includes(phase)) return 'waiting';
  return 'other';
}

const WEEKDAYS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return date;
}

function fmtDate(d) { return d.toISOString().split('T')[0]; }
function fmtShort(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m}${hr >= 12 ? 'p' : 'a'}`;
}

// ═══════════════════════════════════════════════════════════════
// JOB SELECTOR PANEL
// ═══════════════════════════════════════════════════════════════

const MITIGATION_DIVS = ['water', 'mold', 'fire', 'contents'];
const RECON_DIVS = ['reconstruction'];

function JobPanel({ jobs, panelOpen, onTogglePanel, onToggleJob, loading }) {
  const [search, setSearch] = useState('');
  const [expandedGroup, setExpandedGroup] = useState('active');
  const [divFilter, setDivFilter] = useState('all'); // 'all' | 'mitigation' | 'reconstruction'

  // Counts for filter buttons (based on full list, not filtered)
  const mitigationCount = jobs.filter(j => MITIGATION_DIVS.includes(j.division)).length;
  const reconCount = jobs.filter(j => RECON_DIVS.includes(j.division)).length;

  const filtered = useMemo(() => {
    let list = jobs;
    // Division filter
    if (divFilter === 'mitigation') list = list.filter(j => MITIGATION_DIVS.includes(j.division));
    else if (divFilter === 'reconstruction') list = list.filter(j => RECON_DIVS.includes(j.division));
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        (j.insured_name || '').toLowerCase().includes(q) ||
        (j.job_number || '').toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [jobs, search, divFilter]);

  const onBoard = filtered.filter(j => j.on_board);
  const offBoard = filtered.filter(j => !j.on_board);

  const grouped = useMemo(() => {
    const g = { active: [], ready: [], waiting: [], other: [] };
    for (const j of offBoard) g[classifyPhase(j.phase)].push(j);
    return g;
  }, [offBoard]);

  const groups = [
    { key: 'active', label: 'Active', color: '#10b981', items: grouped.active },
    { key: 'ready', label: 'Ready to start', color: '#3b82f6', items: grouped.ready },
    { key: 'waiting', label: 'Waiting', color: '#f59e0b', items: grouped.waiting },
    { key: 'other', label: 'Other', color: '#6b7280', items: grouped.other },
  ].filter(g => g.items.length > 0);

  // Collapsed state
  if (!panelOpen) {
    return (
      <div style={P.collapsed} onClick={onTogglePanel}>
        <div style={{ fontSize: 16, color: 'var(--text-secondary)' }}>☰</div>
        <div style={P.collapsedLabel}>Jobs</div>
        <div style={P.collapsedBadge}>{jobs.filter(j => j.on_board).length}</div>
      </div>
    );
  }

  return (
    <div style={P.panel}>
      <div style={P.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Jobs</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
            background: 'var(--accent-light)', color: 'var(--accent)',
          }}>
            {onBoard.length} on board
          </span>
        </div>
        <button style={P.closeBtn} onClick={onTogglePanel}>✕</button>
      </div>

      <div style={P.searchWrap}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {[
            { key: 'all', label: `All (${jobs.length})` },
            { key: 'mitigation', label: `Mitigation (${mitigationCount})` },
            { key: 'reconstruction', label: `Recon (${reconCount})` },
          ].map(f => (
            <button key={f.key} onClick={() => setDivFilter(f.key)} style={{
              flex: 1, fontSize: 11, fontWeight: 600, padding: '5px 0', borderRadius: 'var(--radius-md)',
              border: divFilter === f.key ? '1px solid var(--accent)' : '1px solid var(--border-color)',
              background: divFilter === f.key ? 'var(--accent-light)' : 'var(--bg-primary)',
              color: divFilter === f.key ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 120ms ease',
            }}>{f.label}</button>
          ))}
        </div>
        <input style={P.searchInput} placeholder="Search jobs..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      <div style={P.body}>
        {loading && <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading jobs...</div>}

        {/* On Board */}
        {onBoard.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={P.groupHead}>
              <span style={{ ...P.dot, background: 'var(--accent)' }} />
              On board ({onBoard.length})
            </div>
            {onBoard.map(j => <JobRow key={j.id} job={j} onToggle={onToggleJob} isOn />)}
          </div>
        )}

        {onBoard.length > 0 && groups.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border-color)', margin: '4px 0 8px' }} />
        )}

        {/* Off-board groups */}
        {groups.map(g => (
          <div key={g.key} style={{ marginBottom: 2 }}>
            <div style={{ ...P.groupHead, cursor: 'pointer' }}
              onClick={() => setExpandedGroup(expandedGroup === g.key ? null : g.key)}>
              <span style={{ ...P.dot, background: g.color }} />
              {g.label} ({g.items.length})
              <span style={{
                marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)',
                transform: expandedGroup === g.key ? 'rotate(180deg)' : 'none', transition: '150ms ease',
              }}>▾</span>
            </div>
            {expandedGroup === g.key && g.items.map(j => (
              <JobRow key={j.id} job={j} onToggle={onToggleJob} isOn={false} />
            ))}
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
            No jobs match
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, onToggle, isOn }) {
  const dc = DIV_COLORS[job.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
  return (
    <div style={{ ...P.jobRow, background: isOn ? 'var(--accent-light)' : 'transparent' }}
      onClick={() => onToggle(job.id, !isOn)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={P.jobName}>{job.insured_name}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3, background: dc.bg, color: dc.text }}>
            {dc.label}
          </span>
          {job.job_number && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>#{job.job_number}</span>
          )}
          {job.appointment_count > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{job.appointment_count} appt{job.appointment_count !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <div style={{
        width: 20, height: 20, borderRadius: 4, flexShrink: 0,
        border: isOn ? 'none' : '1.5px solid var(--border-color)',
        background: isOn ? 'var(--accent)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isOn && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
      </div>
    </div>
  );
}

const P = {
  collapsed: {
    width: 40, background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12, gap: 8,
    cursor: 'pointer', flexShrink: 0,
  },
  collapsedLabel: {
    writingMode: 'vertical-rl', fontSize: 12, fontWeight: 600,
    color: 'var(--text-secondary)', letterSpacing: '0.05em',
  },
  collapsedBadge: {
    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
    background: 'var(--accent-light)', padding: '2px 6px', borderRadius: 99,
  },
  panel: {
    width: 280, background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)',
    display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  closeBtn: { fontSize: 14, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 },
  searchWrap: { padding: '8px 12px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 },
  searchInput: {
    width: '100%', padding: '6px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-sans)',
    outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-primary)',
  },
  body: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  groupHead: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: 'var(--text-tertiary)', userSelect: 'none',
  },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  jobRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
    cursor: 'pointer', borderBottom: '1px solid var(--border-light)',
  },
  jobName: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
};

// ═══════════════════════════════════════════════════════════════
// APPOINTMENT CARD
// ═══════════════════════════════════════════════════════════════

function ApptCard({ appt, onClick }) {
  const color = appt.color || TYPE_COLORS[appt.type] || '#6b7280';
  const status = STATUS_LABELS[appt.status] || STATUS_LABELS.scheduled;
  const isActive = ['en_route', 'in_progress'].includes(appt.status);
  const isDone = appt.status === 'completed';
  const crew = appt.crew || [];
  const hasTasks = appt.tasks_total > 0;

  return (
    <div
      onClick={e => { e.stopPropagation(); onClick?.(appt); }}
      style={{
        borderLeft: `3px solid ${color}`, borderRadius: 0,
        background: isDone ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
        padding: '5px 7px', marginBottom: 3, cursor: 'pointer', opacity: isDone ? 0.6 : 1,
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 }}>
        {appt.title}
      </div>
      {appt.time_start && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 3 }}>
          {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
        </div>
      )}
      {appt.notes && (
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.3, marginBottom: 3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{appt.notes}</div>
      )}
      {crew.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: hasTasks ? 3 : 0 }}>
          {crew.map(c => (
            <span key={c.id} style={{
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 99,
              background: c.role === 'lead' ? '#fffbeb' : 'var(--bg-tertiary)',
              color: c.role === 'lead' ? '#92400e' : 'var(--text-secondary)',
              border: c.role === 'lead' ? '1px solid #f59e0b40' : 'none',
            }}>{c.display_name || c.full_name?.split(' ')[0]}</span>
          ))}
        </div>
      )}
      {hasTasks && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ flex: 1, height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.round((appt.tasks_done / appt.tasks_total) * 100)}%`,
              height: '100%', background: appt.tasks_done === appt.tasks_total ? '#10b981' : color, borderRadius: 2,
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{appt.tasks_done}/{appt.tasks_total}</span>
        </div>
      )}
      {isActive && (
        <div style={{ fontSize: 10, fontWeight: 600, color: status.color, marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />
          {status.label}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN: SCHEDULE PAGE
// ═══════════════════════════════════════════════════════════════

export default function Schedule() {
  const { db, employee } = useAuth();

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [boardData, setBoardData] = useState([]);
  const [panelJobs, setPanelJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState(true);
  const [showWeekend, setShowWeekend] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // ── Week days ──
  const days = useMemo(() => {
    const count = showWeekend ? 7 : 5;
    const start = showWeekend ? new Date(weekStart.getTime() - 86400000) : weekStart;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = fmtDate(d);
      return { date: d, key, label: WEEKDAYS_FULL[d.getDay()], shortDate: fmtShort(d), isToday: key === fmtDate(new Date()) };
    });
  }, [weekStart, showWeekend]);

  // ── Load ──
  const loadPanelJobs = useCallback(async () => {
    setPanelLoading(true);
    try {
      const r = await db.rpc('get_dispatch_panel_jobs');
      setPanelJobs(Array.isArray(r) ? r : []);
    } catch (e) { console.error('Panel:', e); }
    finally { setPanelLoading(false); }
  }, [db]);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const r = await db.rpc('get_dispatch_board', { p_start_date: days[0].key, p_end_date: days[days.length - 1].key });
      setBoardData(Array.isArray(r) ? r : []);
    } catch (e) { console.error('Board:', e); }
    finally { setLoading(false); }
  }, [db, days]);

  useEffect(() => { loadPanelJobs(); }, [loadPanelJobs]);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // ── Toggle job on/off board ──
  const toggleJob = async (jobId, addToBoard) => {
    try {
      if (addToBoard) {
        await db.insert('dispatch_board_jobs', { job_id: jobId, added_by: employee?.id });
      } else {
        await db.delete('dispatch_board_jobs', `job_id=eq.${jobId}`);
      }
      setPanelJobs(prev => prev.map(j => j.id === jobId ? { ...j, on_board: addToBoard } : j));
      loadBoard();
    } catch (e) { console.error('Toggle:', e); }
  };

  // ── Cell lookup ──
  const cellMap = useMemo(() => {
    const m = {};
    for (const job of boardData) {
      for (const appt of (job.appointments || [])) {
        const k = `${job.job_id}_${appt.date}`;
        if (!m[k]) m[k] = [];
        m[k].push(appt);
      }
    }
    return m;
  }, [boardData]);

  const goThisWeek = () => setWeekStart(getMonday(new Date()));
  const goPrev = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const goNext = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };

  const totalAppts = boardData.reduce((s, j) => s + (j.appointments?.length || 0), 0);
  const todayKey = fmtDate(new Date());
  const todayAppts = boardData.reduce((s, j) => s + (j.appointments?.filter(a => a.date === todayKey).length || 0), 0);

  const handleApptClick = (appt) => { console.log('Appointment:', appt); };
  const handleCellClick = (jobId, dateKey) => { console.log('Create:', jobId, dateKey); };

  return (
    <div style={S.page}>
      {/* Left panel */}
      <JobPanel
        jobs={panelJobs} panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
        onToggleJob={toggleJob} loading={panelLoading}
      />

      {/* Main board */}
      <div style={S.main}>
        {/* Header */}
        <div style={S.header}>
          <div>
            <h1 style={S.title}>Schedule</h1>
            <div style={S.subtitle}>
              {fmtShort(days[0].date)} – {fmtShort(days[days.length - 1].date)}
              <span style={S.pill}>{boardData.length} jobs</span>
              <span style={S.pill}>{totalAppts} appts</span>
              {todayAppts > 0 && <span style={{ ...S.pill, background: '#eff6ff', color: '#2563eb' }}>{todayAppts} today</span>}
            </div>
          </div>
          <div style={S.controls}>
            {!panelOpen && <button style={S.btn} onClick={() => setPanelOpen(true)}>Jobs</button>}
            <button style={S.btn} onClick={goThisWeek}>This week</button>
            <button style={S.btnIcon} onClick={goPrev}>‹</button>
            <button style={S.btnIcon} onClick={goNext}>›</button>
            <label style={S.checkLabel}>
              <input type="checkbox" checked={showWeekend} onChange={e => setShowWeekend(e.target.checked)} />
              <span>Wknd</span>
            </label>
          </div>
        </div>

        {/* Board */}
        {loading ? (
          <div style={S.center}>Loading...</div>
        ) : boardData.length === 0 ? (
          <div style={S.center}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
              No jobs on the board
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4, maxWidth: 280, textAlign: 'center' }}>
              {panelOpen
                ? 'Click jobs in the panel to add them to the dispatch board'
                : 'Open the Jobs panel to select which jobs to show'}
            </div>
          </div>
        ) : (
          <div style={S.gridWrap}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `200px repeat(${days.length}, minmax(140px, 1fr))`,
              minWidth: 200 + days.length * 140,
            }}>
              {/* Day headers */}
              <div style={S.corner} />
              {days.map(day => (
                <div key={day.key} style={{ ...S.dayHead, ...(day.isToday ? { background: '#f0f7ff' } : {}) }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: day.isToday ? '#2563eb' : 'var(--text-secondary)' }}>{day.label}</div>
                  <div style={{ fontSize: 11, color: day.isToday ? '#2563eb' : 'var(--text-tertiary)', marginTop: 1, fontWeight: day.isToday ? 600 : 400 }}>{day.shortDate}</div>
                </div>
              ))}

              {/* Job rows */}
              {boardData.map(job => {
                const dc = DIV_COLORS[job.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
                return [
                  <div key={`lbl-${job.job_id}`} style={S.jobCell}>
                    <div style={S.jobCellName} title={job.insured_name}>{job.insured_name}</div>
                    {job.job_number && <div style={S.jobCellNum}>#{job.job_number}</div>}
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3, background: dc.bg, color: dc.text, marginTop: 3, display: 'inline-block' }}>
                      {dc.label}
                    </span>
                    {job.address && <div style={S.jobCellAddr} title={job.address}>{job.address.split(',')[0]}</div>}
                  </div>,
                  ...days.map(day => {
                    const appts = cellMap[`${job.job_id}_${day.key}`] || [];
                    return (
                      <div
                        key={`${job.job_id}_${day.key}`}
                        style={{ ...S.cell, ...(day.isToday ? { background: '#fafcff' } : {}) }}
                        onClick={() => handleCellClick(job.job_id, day.key)}
                        onMouseEnter={e => { const el = e.currentTarget.querySelector('[data-plus]'); if (el) el.style.opacity = '1'; }}
                        onMouseLeave={e => { const el = e.currentTarget.querySelector('[data-plus]'); if (el) el.style.opacity = '0'; }}
                      >
                        {appts.map(a => <ApptCard key={a.id} appt={a} onClick={handleApptClick} />)}
                        {appts.length === 0 && (
                          <div data-plus style={S.plusWrap}>
                            <span style={S.plus}>+</span>
                          </div>
                        )}
                      </div>
                    );
                  }),
                ];
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const S = {
  page: { height: '100%', display: 'flex', overflow: 'hidden', background: 'var(--bg-secondary)' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '14px 20px 10px', background: 'var(--bg-primary)',
    borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 },
  pill: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' },
  controls: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  btn: {
    fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  },
  btnIcon: {
    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' },
  gridWrap: { flex: 1, overflow: 'auto' },
  corner: {
    position: 'sticky', left: 0, top: 0, zIndex: 3,
    background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)',
  },
  dayHead: {
    padding: '8px 6px', textAlign: 'center', position: 'sticky', top: 0, zIndex: 2,
    borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-light)', background: 'var(--bg-secondary)',
  },
  jobCell: {
    padding: '8px 10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)',
    background: 'var(--bg-primary)', position: 'sticky', left: 0, zIndex: 1, minHeight: 70,
  },
  jobCellName: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 },
  jobCellNum: { fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' },
  jobCellAddr: { fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 },
  cell: {
    borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-light)',
    padding: 3, minHeight: 70, cursor: 'pointer',
  },
  plusWrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', minHeight: 64, opacity: 0, transition: 'opacity 120ms ease',
  },
  plus: {
    width: 24, height: 24, borderRadius: 'var(--radius-md)',
    border: '1px dashed var(--border-color)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-tertiary)',
  },
  center: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 40, color: 'var(--text-tertiary)',
  },
};
