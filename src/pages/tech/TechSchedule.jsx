import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { APPT_STATUS_COLORS as STATUS_COLORS, DIV_BORDER_COLORS, TYPE_CONFIG } from './techConstants';
import { toast } from '@/lib/toast';
import { fmtDate } from '@/lib/scheduleUtils';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* ── helpers ── */

function getSunday(d) {
  const date = new Date(d);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function formatDuration(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rm = mins % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function formatDateHeader(dateStr, todayStr, tomorrowStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  if (dateStr === todayStr) return `Today \u00b7 ${weekday} ${month} ${day}`;
  if (dateStr === tomorrowStr) return `Tomorrow \u00b7 ${weekday} ${month} ${day}`;
  return `${weekday} ${month} ${day}`;
}

/* ── Week Strip ── */

function WeekStrip({ anchor, selectedDay, onSelectDay, onNavigate, appointments, rows = 1 }) {
  const todayStr = fmtDate(new Date());
  const touchRef = useRef(null);

  const days = useMemo(() => {
    const result = [];
    const totalDays = rows * 7;
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(anchor, i);
      const key = fmtDate(d);
      result.push({ date: d, key, day: d.getDate(), dow: d.getDay() });
    }
    return result;
  }, [anchor, rows]);

  // Dates with appointments (for dot indicators)
  const datesWithAppts = useMemo(() => {
    const set = new Set();
    (appointments || []).forEach(a => { if (a.date) set.add(a.date); });
    return set;
  }, [appointments]);

  const handleTouchStart = (e) => { touchRef.current = { x: e.touches[0].clientX, t: Date.now() }; };
  const handleTouchEnd = (e) => {
    if (!touchRef.current) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dt = Date.now() - touchRef.current.t;
    touchRef.current = null;
    if (Math.abs(dx) > 50 && dt < 400) {
      onNavigate(dx < 0 ? 1 : -1); // swipe left = next, right = prev
    }
  };

  // Month label for first day of each row that starts a new month
  const monthBreak = days.length > 7 ? (() => {
    const m1 = days[0].date.getMonth();
    const idx = days.findIndex((d, i) => i > 0 && d.date.getMonth() !== m1);
    return idx > 0 ? { idx, label: days[idx].date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() } : null;
  })() : null;

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', padding: '0 8px' }}>
        {DAYS.map((d, i) => (
          <div key={i} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Date cells */}
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', padding: '2px 8px' }}>
          {days.slice(row * 7, (row + 1) * 7).map(d => {
            const isToday = d.key === todayStr;
            const isSelected = d.key === selectedDay;
            const hasAppt = datesWithAppts.has(d.key);

            return (
              <button
                key={d.key}
                onClick={() => onSelectDay(d.key)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '6px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent', minHeight: 44,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 18, lineHeight: '36px',
                  fontSize: 15, fontWeight: isToday || isSelected ? 700 : 500,
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? '#fff' : (isToday ? 'var(--accent)' : 'var(--text-primary)'),
                  position: 'relative',
                }}>
                  {d.day}
                  {/* Month label under date on month boundary */}
                  {monthBreak && days.indexOf(d) === monthBreak.idx && (
                    <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {monthBreak.label}
                    </div>
                  )}
                </div>
                {/* Dot indicator */}
                <div style={{
                  width: 4, height: 4, borderRadius: 2, marginTop: 2,
                  background: hasAppt ? (isSelected ? '#fff' : 'var(--accent)') : 'transparent',
                }} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Appointment Row (shared between views) ── */

function ApptRow({ appt, navigate }) {
  const job = appt.jobs;
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
  const sc = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;
  const tc = TYPE_CONFIG[appt.type] || TYPE_CONFIG.other;
  const divBorder = job?.division ? DIV_BORDER_COLORS[job.division] || 'var(--border-color)' : 'var(--border-color)';
  const duration = formatDuration(appt.time_start, appt.time_end);

  return (
    <div
      className="tech-schedule-row"
      onClick={() => navigate(`/tech/appointment/${appt.id}`)}
      style={{
        display: 'flex', alignItems: 'flex-start',
        padding: '14px var(--space-4)', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)', cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        borderLeft: `4px solid ${divBorder}`, minHeight: 72,
      }}
    >
      <div style={{ width: 70, flexShrink: 0, paddingRight: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {formatTime(appt.time_start)}
        </div>
        {duration && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{duration}</div>
        )}
      </div>
      <div style={{
        width: 2, alignSelf: 'stretch', flexShrink: 0, marginRight: 12,
        background: divBorder, borderRadius: 1, opacity: 0.4,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {job?.insured_name ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {job.insured_name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {appt.title || 'Appointment'}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            {appt.title || 'Appointment'}
          </div>
        )}
        {address && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {address}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {appt.type && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px',
              borderRadius: 'var(--radius-full)', background: tc.bg, color: tc.color,
            }}>
              {tc.icon} {tc.label}
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
          }}>
            {(appt.status || 'scheduled').replace(/_/g, ' ')}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ── */

export default function TechSchedule() {
  const { employee, db } = useAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'daily'
  const [anchor, setAnchor] = useState(() => getSunday(new Date())); // Sunday of current week
  const [selectedDay, setSelectedDay] = useState(() => fmtDate(new Date()));
  const dateRefs = useRef({});

  const todayStr = fmtDate(new Date());
  const tomorrowStr = fmtDate(addDays(new Date(), 1));

  // Date range for data loading
  const dateRange = useMemo(() => {
    const totalDays = view === 'list' ? 14 : 7;
    const start = fmtDate(anchor);
    const end = fmtDate(addDays(anchor, totalDays - 1));
    return { start, end };
  }, [anchor, view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.rpc('get_appointments_range', {
        p_start_date: dateRange.start,
        p_end_date: dateRange.end,
      });
      const mine = (result || []).filter(a =>
        a.appointment_crew?.some(c => c.employee_id === employee.id)
      );
      setAppointments(mine);
    } catch (e) {
      toast('Failed to load schedule', 'error');
    }
    setLoading(false);
  }, [db, employee.id, dateRange.start, dateRange.end]);

  useEffect(() => { load(); }, [load]);

  // Navigate weeks
  const navigateWeek = (dir) => {
    setAnchor(prev => addDays(prev, dir * 7));
  };

  const goToday = () => {
    setAnchor(getSunday(new Date()));
    setSelectedDay(todayStr);
  };

  const handleSelectDay = (dayKey) => {
    setSelectedDay(dayKey);
    if (view === 'list' && dateRefs.current[dayKey]) {
      dateRefs.current[dayKey].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Group appointments by date
  const grouped = useMemo(() => {
    const g = {};
    appointments.forEach(a => {
      if (!g[a.date]) g[a.date] = [];
      g[a.date].push(a);
    });
    return g;
  }, [appointments]);

  // For list view: all dates in range (show empty dates too for context)
  const allDates = useMemo(() => {
    const totalDays = view === 'list' ? 14 : 7;
    const dates = [];
    for (let i = 0; i < totalDays; i++) {
      dates.push(fmtDate(addDays(anchor, i)));
    }
    return dates;
  }, [anchor, view]);

  // For daily view: only selected day's appointments
  const dailyAppts = useMemo(() => {
    return (grouped[selectedDay] || []).sort((a, b) => (a.time_start || '').localeCompare(b.time_start || ''));
  }, [grouped, selectedDay]);

  // Check if anchor includes today
  const anchorIncludesToday = todayStr >= fmtDate(anchor) && todayStr <= fmtDate(addDays(anchor, view === 'list' ? 13 : 6));

  return (
    <div className="tech-page" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px 0', background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-light)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
            Schedule
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Today button */}
            {!anchorIncludesToday && (
              <button
                onClick={goToday}
                style={{
                  height: 32, padding: '0 12px', borderRadius: 'var(--tech-radius-button)',
                  background: 'transparent', border: '1px solid var(--accent)',
                  color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Today
              </button>
            )}

            {/* View toggle */}
            <div style={{
              display: 'flex', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)', overflow: 'hidden',
            }}>
              <button
                onClick={() => setView('daily')}
                style={{
                  width: 36, height: 32, border: 'none', cursor: 'pointer',
                  background: view === 'daily' ? 'var(--accent)' : 'var(--bg-primary)',
                  color: view === 'daily' ? '#fff' : 'var(--text-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>
              <button
                onClick={() => setView('list')}
                style={{
                  width: 36, height: 32, border: 'none', cursor: 'pointer',
                  background: view === 'list' ? 'var(--accent)' : 'var(--bg-primary)',
                  color: view === 'list' ? '#fff' : 'var(--text-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </button>
            </div>

            {/* + New appointment */}
            <button
              onClick={() => navigate(`/tech/new-appointment?date=${selectedDay}`)}
              style={{
                width: 36, height: 36, borderRadius: 'var(--tech-radius-button)',
                background: 'var(--accent)', color: '#fff', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Week strip */}
        <WeekStrip
          anchor={anchor}
          selectedDay={selectedDay}
          onSelectDay={handleSelectDay}
          onNavigate={navigateWeek}
          appointments={appointments}
          rows={view === 'list' ? 2 : 1}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="loading-page"><div className="spinner" /></div>
      ) : view === 'daily' ? (
        /* ── Daily View ── */
        <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
          {/* Selected day header */}
          <div style={{
            padding: '8px 16px', background: 'var(--accent-light)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: 14, fontWeight: 700, color: 'var(--accent)',
          }}>
            {formatDateHeader(selectedDay, todayStr, tomorrowStr)}
          </div>

          {dailyAppts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.3 }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>No appointments this day</div>
            </div>
          ) : (
            dailyAppts.map(appt => <ApptRow key={appt.id} appt={appt} navigate={navigate} />)
          )}
        </PullToRefresh>
      ) : (
        /* ── List View ── */
        <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
          {allDates.filter(d => grouped[d]?.length > 0).length === 0 ? (
            <div className="empty-state" style={{ marginTop: 60 }}>
              <div className="empty-state-icon">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  <polyline points="9 16 11 18 15 14" strokeWidth="2" />
                </svg>
              </div>
              <div className="empty-state-text">No appointments in this range</div>
              <div className="empty-state-sub" style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
                Swipe the calendar to navigate
              </div>
            </div>
          ) : (
            allDates.map(dateStr => {
              const appts = grouped[dateStr];
              if (!appts || appts.length === 0) return null;
              const isToday = dateStr === todayStr;
              const isTomorrow = dateStr === tomorrowStr;

              return (
                <div key={dateStr} ref={el => { dateRefs.current[dateStr] = el; }}>
                  <div style={{
                    position: 'sticky', top: 0, zIndex: 5,
                    padding: '8px var(--space-4)',
                    background: isToday ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-light)',
                    fontSize: 14, fontWeight: 700,
                    color: isToday ? 'var(--accent)' : (isTomorrow ? 'var(--text-primary)' : 'var(--text-secondary)'),
                  }}>
                    {formatDateHeader(dateStr, todayStr, tomorrowStr)}
                  </div>
                  {appts.map(appt => <ApptRow key={appt.id} appt={appt} navigate={navigate} />)}
                </div>
              );
            })
          )}
        </PullToRefresh>
      )}
    </div>
  );
}
