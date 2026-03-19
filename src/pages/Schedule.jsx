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
  monitoring:       '#3b82f6',
  mitigation:       '#0ea5e9',
  inspection:       '#8b5cf6',
  reconstruction:   '#f59e0b',
  estimate:         '#10b981',
  delivery:         '#6b7280',
  mold_remediation: '#059669',
  content_cleaning: '#8b5cf6',
  other:            '#6b7280',
};

const STATUS_LABELS = {
  scheduled:   { label: 'Scheduled', color: '#3b82f6' },
  en_route:    { label: 'En Route',  color: '#f59e0b' },
  in_progress: { label: 'Active',    color: '#10b981' },
  paused:      { label: 'Paused',    color: '#ef4444' },
  completed:   { label: 'Done',      color: '#6b7280' },
  cancelled:   { label: 'Cancelled', color: '#9ca3af' },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKDAYS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date;
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function formatShortDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? 'p' : 'a';
  return `${hr % 12 || 12}:${m}${ampm}`;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
// APPOINTMENT CARD (inside a cell)
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
      onClick={(e) => { e.stopPropagation(); onClick?.(appt); }}
      style={{
        borderLeft: `3px solid ${color}`,
        background: isDone ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
        borderRadius: 0,
        padding: '5px 7px',
        marginBottom: 3,
        cursor: 'pointer',
        opacity: isDone ? 0.65 : 1,
        transition: 'box-shadow 120ms ease',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 }}>
        {appt.title}
      </div>

      {/* Time */}
      {appt.time_start && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 3 }}>
          {formatTime(appt.time_start)}{appt.time_end ? ` – ${formatTime(appt.time_end)}` : ''}
        </div>
      )}

      {/* Notes preview */}
      {appt.notes && (
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.3, marginBottom: 3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {appt.notes}
        </div>
      )}

      {/* Crew */}
      {crew.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 3 }}>
          {crew.map(c => (
            <span key={c.id} style={{
              fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 99,
              background: c.role === 'lead' ? '#fffbeb' : 'var(--bg-tertiary)',
              color: c.role === 'lead' ? '#92400e' : 'var(--text-secondary)',
              border: c.role === 'lead' ? '1px solid #f59e0b40' : 'none',
            }}>
              {c.display_name || c.full_name?.split(' ')[0]}
            </span>
          ))}
        </div>
      )}

      {/* Task progress */}
      {hasTasks && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            flex: 1, height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round((appt.tasks_done / appt.tasks_total) * 100)}%`,
              height: '100%', background: appt.tasks_done === appt.tasks_total ? '#10b981' : color,
              borderRadius: 2, transition: 'width 200ms ease',
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
            {appt.tasks_done}/{appt.tasks_total}
          </span>
        </div>
      )}

      {/* Active badge */}
      {isActive && (
        <div style={{
          fontSize: 10, fontWeight: 600, color: status.color, marginTop: 3,
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color, display: 'inline-block' }} />
          {status.label}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN: DISPATCH BOARD
// ═══════════════════════════════════════════════════════════════

export default function Schedule() {
  const { db } = useAuth();

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showWeekend, setShowWeekend] = useState(false);
  const [filterDiv, setFilterDiv] = useState('all');

  // ── Week days array ──
  const days = useMemo(() => {
    const count = showWeekend ? 7 : 5;
    const startDay = showWeekend ? new Date(weekStart.getTime() - 86400000) : weekStart; // Sun if weekend
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(startDay);
      d.setDate(startDay.getDate() + i);
      const key = formatDate(d);
      const today = formatDate(new Date());
      return {
        date: d,
        key,
        label: WEEKDAYS_FULL[d.getDay()],
        shortDate: formatShortDate(d),
        isToday: key === today,
      };
    });
  }, [weekStart, showWeekend]);

  // ── Load data ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const startKey = days[0].key;
      const endKey = days[days.length - 1].key;
      const result = await db.rpc('get_dispatch_board', {
        p_start_date: startKey,
        p_end_date: endKey,
      });
      setData(Array.isArray(result) ? result : []);
    } catch (e) {
      console.error('Dispatch load:', e);
    } finally {
      setLoading(false);
    }
  }, [db, days]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filter by division ──
  const filteredJobs = useMemo(() => {
    if (filterDiv === 'all') return data;
    return data.filter(j => j.division === filterDiv);
  }, [data, filterDiv]);

  // ── Build cell lookup: jobId+date → appointments ──
  const cellMap = useMemo(() => {
    const map = {};
    for (const job of data) {
      for (const appt of (job.appointments || [])) {
        const key = `${job.job_id}_${appt.date}`;
        if (!map[key]) map[key] = [];
        map[key].push(appt);
      }
    }
    return map;
  }, [data]);

  // ── Navigation ──
  const goThisWeek = () => setWeekStart(getMonday(new Date()));
  const goPrev = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const goNext = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  // ── Divisions present in data (for filter pills) ──
  const divisionsPresent = useMemo(() => {
    const set = new Set(data.map(j => j.division).filter(Boolean));
    return [...set].sort();
  }, [data]);

  // ── Click handlers ──
  const handleApptClick = (appt) => {
    // TODO: open appointment detail slide-out or modal
    console.log('Appointment clicked:', appt);
  };

  const handleCellClick = (jobId, dateKey) => {
    // TODO: open create appointment for this job + date
    console.log('Create appointment:', jobId, dateKey);
  };

  // ── Summary stats ──
  const totalAppts = data.reduce((sum, j) => sum + (j.appointments?.length || 0), 0);
  const todayKey = formatDate(new Date());
  const todayAppts = data.reduce((sum, j) =>
    sum + (j.appointments?.filter(a => a.date === todayKey).length || 0), 0);

  return (
    <div style={S.page}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Schedule</h1>
          <div style={S.subtitle}>
            {formatShortDate(days[0].date)} – {formatShortDate(days[days.length - 1].date)}
            <span style={S.statPill}>{filteredJobs.length} jobs</span>
            <span style={S.statPill}>{totalAppts} appointments</span>
            {todayAppts > 0 && <span style={{ ...S.statPill, background: '#eff6ff', color: '#2563eb' }}>{todayAppts} today</span>}
          </div>
        </div>
        <div style={S.controls}>
          <button style={S.btn} onClick={goThisWeek}>This week</button>
          <button style={S.btnIcon} onClick={goPrev}>‹</button>
          <button style={S.btnIcon} onClick={goNext}>›</button>
          <label style={S.checkLabel}>
            <input type="checkbox" checked={showWeekend} onChange={e => setShowWeekend(e.target.checked)} />
            <span>Weekends</span>
          </label>
        </div>
      </div>

      {/* ── Division filter pills ── */}
      {divisionsPresent.length > 1 && (
        <div style={S.filterRow}>
          <button
            style={{ ...S.filterPill, ...(filterDiv === 'all' ? S.filterPillActive : {}) }}
            onClick={() => setFilterDiv('all')}
          >
            All ({data.length})
          </button>
          {divisionsPresent.map(div => {
            const dc = DIV_COLORS[div] || { bg: '#f1f3f5', text: '#6b7280', label: div };
            const count = data.filter(j => j.division === div).length;
            return (
              <button
                key={div}
                style={{
                  ...S.filterPill,
                  ...(filterDiv === div ? { background: dc.bg, color: dc.text, borderColor: dc.text + '40' } : {}),
                }}
                onClick={() => setFilterDiv(filterDiv === div ? 'all' : div)}
              >
                {dc.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Grid ── */}
      {loading ? (
        <div style={S.loading}>Loading dispatch board...</div>
      ) : filteredJobs.length === 0 ? (
        <div style={S.empty}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
            No appointments this week
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
            Create appointments on jobs, or navigate to a different week
          </div>
        </div>
      ) : (
        <div style={S.gridWrapper}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `200px repeat(${days.length}, minmax(140px, 1fr))`,
            minWidth: 200 + days.length * 140,
          }}>
            {/* ── Column headers: blank + days ── */}
            <div style={S.cornerCell} />
            {days.map(day => (
              <div key={day.key} style={{
                ...S.dayHeader,
                ...(day.isToday ? S.dayHeaderToday : {}),
              }}>
                <div style={S.dayLabel}>{day.label}</div>
                <div style={{ ...S.dayDate, ...(day.isToday ? { color: '#2563eb', fontWeight: 600 } : {}) }}>
                  {day.shortDate}
                </div>
              </div>
            ))}

            {/* ── Rows: one per job ── */}
            {filteredJobs.map(job => {
              const dc = DIV_COLORS[job.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
              return [
                // Job label cell
                <div key={`label-${job.job_id}`} style={S.jobLabel}>
                  <div style={S.jobName} title={job.insured_name}>
                    {job.insured_name}
                  </div>
                  {job.job_number && (
                    <div style={S.jobNumber}>#{job.job_number}</div>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                      background: dc.bg, color: dc.text,
                    }}>
                      {dc.label}
                    </span>
                  </div>
                  {job.address && (
                    <div style={S.jobAddress} title={job.address}>
                      {job.address.split(',')[0]}
                    </div>
                  )}
                </div>,

                // Day cells
                ...days.map(day => {
                  const cellKey = `${job.job_id}_${day.key}`;
                  const appts = cellMap[cellKey] || [];
                  return (
                    <div
                      key={cellKey}
                      style={{
                        ...S.cell,
                        ...(day.isToday ? S.cellToday : {}),
                      }}
                      onClick={() => handleCellClick(job.job_id, day.key)}
                      onMouseEnter={e => { const p = e.currentTarget.querySelector('[data-plus]'); if (p) p.style.opacity = 1; }}
                      onMouseLeave={e => { const p = e.currentTarget.querySelector('[data-plus]'); if (p) p.style.opacity = 0; }}
                    >
                      {appts.map(appt => (
                        <ApptCard key={appt.id} appt={appt} onClick={handleApptClick} />
                      ))}
                      {appts.length === 0 && (
                        <div data-plus style={S.cellEmptyWrap}>
                          <span style={S.cellPlus}>+</span>
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
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const S = {
  page: {
    height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: 'var(--bg-secondary)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 20px 12px', background: 'var(--bg-primary)',
    borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: {
    fontSize: 13, color: 'var(--text-secondary)', marginTop: 4,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  statPill: {
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
    background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
  },
  controls: {
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
  },
  btn: {
    fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  },
  btnIcon: {
    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
    background: 'var(--bg-primary)', cursor: 'pointer', fontSize: 16,
    color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  },
  checkLabel: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
    color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: 4,
  },

  // Filter pills
  filterRow: {
    display: 'flex', gap: 6, padding: '8px 20px',
    background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)',
    flexShrink: 0, overflowX: 'auto',
  },
  filterPill: {
    fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 99,
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)',
  },
  filterPillActive: {
    background: 'var(--accent-light)', color: 'var(--accent)',
    borderColor: 'var(--accent)',
  },

  // Grid
  gridWrapper: {
    flex: 1, overflow: 'auto',
  },
  cornerCell: {
    position: 'sticky', left: 0, zIndex: 3,
    background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
    borderRight: '1px solid var(--border-color)',
  },
  dayHeader: {
    padding: '8px 6px', textAlign: 'center',
    borderBottom: '1px solid var(--border-color)',
    borderRight: '1px solid var(--border-light)',
    background: 'var(--bg-secondary)',
    position: 'sticky', top: 0, zIndex: 2,
  },
  dayHeaderToday: {
    background: '#f0f7ff',
  },
  dayLabel: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' },
  dayDate: { fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 },

  // Job label
  jobLabel: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-color)',
    borderRight: '1px solid var(--border-color)',
    background: 'var(--bg-primary)',
    position: 'sticky', left: 0, zIndex: 1,
    minHeight: 70,
  },
  jobName: {
    fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180,
  },
  jobNumber: {
    fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)',
  },
  jobAddress: {
    fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180,
  },

  // Cells
  cell: {
    borderBottom: '1px solid var(--border-color)',
    borderRight: '1px solid var(--border-light)',
    padding: 3,
    minHeight: 70,
    cursor: 'pointer',
    position: 'relative',
    verticalAlign: 'top',
  },
  cellToday: {
    background: '#fafcff',
  },
  cellEmptyWrap: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', minHeight: 64, opacity: 0,
    transition: 'opacity 120ms ease',
  },
  cellPlus: {
    width: 24, height: 24, borderRadius: 'var(--radius-md)',
    border: '1px dashed var(--border-color)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontSize: 14,
    color: 'var(--text-tertiary)',
  },

  // States
  loading: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text-tertiary)', fontSize: 14,
  },
  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: 40,
  },
};
