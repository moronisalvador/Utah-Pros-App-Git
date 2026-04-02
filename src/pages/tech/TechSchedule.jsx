import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { APPT_STATUS_COLORS as STATUS_COLORS, DIV_BORDER_COLORS, TYPE_CONFIG } from './techConstants';
import { toast } from '@/lib/toast';
import { fmtDate } from '@/lib/scheduleUtils';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STRIP_DAYS = 61; // ~1 month each side of today
const STRIP_CENTER = 30; // index of today in the strip
const DAY_WIDTH = 52; // px per day cell

/* ── helpers ── */

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

/* ── Continuous Date Strip ── */

function DateStrip({ selectedDay, onSelectDay, apptDates }) {
  const scrollRef = useRef(null);
  const todayStr = fmtDate(new Date());
  const didCenter = useRef(false);

  const days = useMemo(() => {
    const today = new Date();
    const result = [];
    for (let i = -STRIP_CENTER; i < STRIP_DAYS - STRIP_CENTER; i++) {
      const d = addDays(today, i);
      result.push({ date: d, key: fmtDate(d), day: d.getDate(), dow: d.getDay(), month: d.getMonth() });
    }
    return result;
  }, []);

  // Center on today on mount
  useEffect(() => {
    if (scrollRef.current && !didCenter.current) {
      const scrollTo = STRIP_CENTER * DAY_WIDTH - (scrollRef.current.clientWidth / 2) + (DAY_WIDTH / 2);
      scrollRef.current.scrollLeft = scrollTo;
      didCenter.current = true;
    }
  }, []);

  // Scroll selected day into view when it changes
  useEffect(() => {
    if (!scrollRef.current) return;
    const idx = days.findIndex(d => d.key === selectedDay);
    if (idx < 0) return;
    const targetScroll = idx * DAY_WIDTH - (scrollRef.current.clientWidth / 2) + (DAY_WIDTH / 2);
    scrollRef.current.scrollTo({ left: targetScroll, behavior: 'smooth' });
  }, [selectedDay, days]);

  return (
    <div
      ref={scrollRef}
      style={{
        display: 'flex', overflowX: 'auto', overflowY: 'hidden',
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
        padding: '4px 0 8px', msOverflowStyle: 'none',
      }}
    >
      {/* Hide scrollbar */}
      <style>{`.tech-date-strip::-webkit-scrollbar{display:none}`}</style>
      <div className="tech-date-strip" style={{ display: 'flex' }}>
        {days.map((d, i) => {
          const isToday = d.key === todayStr;
          const isSelected = d.key === selectedDay;
          const hasAppt = apptDates.has(d.key);
          const showMonth = i === 0 || d.day === 1;

          return (
            <button
              key={d.key}
              onClick={() => onSelectDay(d.key)}
              style={{
                width: DAY_WIDTH, flexShrink: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '4px 0', border: 'none', background: 'transparent',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Month label on first day of month */}
              {showMonth && (
                <div style={{
                  fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2,
                  height: 12, lineHeight: '12px',
                }}>
                  {MONTHS[d.month].slice(0, 3)}
                </div>
              )}
              {!showMonth && <div style={{ height: 12 }} />}

              {/* Day of week */}
              <div style={{
                fontSize: 11, fontWeight: 500,
                color: isSelected ? 'var(--accent)' : (isToday ? 'var(--accent)' : 'var(--text-tertiary)'),
                marginBottom: 4,
              }}>
                {DOW[d.dow].charAt(0)}
              </div>

              {/* Date circle */}
              <div style={{
                width: 38, height: 38, borderRadius: 19,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: isToday || isSelected ? 700 : 500,
                background: isSelected ? 'var(--accent)' : (isToday ? 'var(--accent-light)' : 'transparent'),
                color: isSelected ? '#fff' : (isToday ? 'var(--accent)' : 'var(--text-primary)'),
                border: isToday && !isSelected ? '2px solid var(--accent)' : '2px solid transparent',
              }}>
                {d.day}
              </div>

              {/* Dot indicator */}
              <div style={{
                width: 5, height: 5, borderRadius: 3, marginTop: 3,
                background: hasAppt ? (isSelected ? 'var(--accent)' : 'var(--text-tertiary)') : 'transparent',
              }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Month Picker (full calendar overlay) ── */

function MonthPicker({ selectedDay, onSelectDay, onClose, apptDates }) {
  const sel = new Date(selectedDay + 'T12:00:00');
  const [viewMonth, setViewMonth] = useState(sel.getMonth());
  const [viewYear, setViewYear] = useState(sel.getFullYear());
  const todayStr = fmtDate(new Date());

  const calDays = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const result = [];
    // Pad with empty cells
    for (let i = 0; i < startDow; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      result.push({ date, key: fmtDate(date), day: d });
    }
    return result;
  }, [viewMonth, viewYear]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
        zIndex: 100, WebkitTapHighlightColor: 'transparent',
      }} />
      <div style={{
        position: 'fixed', left: 16, right: 16, top: '15%',
        background: 'var(--bg-primary)', borderRadius: 'var(--tech-radius-card)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 101, padding: 16,
        animation: 'techFabIn 0.15s ease-out',
      }}>
        {/* Month/year nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button onClick={prevMonth} style={{
            width: 40, height: 40, borderRadius: 20, border: 'none',
            background: 'var(--bg-tertiary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
            {MONTHS[viewMonth]} {viewYear}
          </div>
          <button onClick={nextMonth} style={{
            width: 40, height: 40, borderRadius: 20, border: 'none',
            background: 'var(--bg-tertiary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2.5"><polyline points="9 6 15 12 9 18" /></svg>
          </button>
        </div>

        {/* DOW headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 4 }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', padding: '4px 0' }}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {calDays.map((d, i) => {
            if (!d) return <div key={`empty-${i}`} />;
            const isToday = d.key === todayStr;
            const isSelected = d.key === selectedDay;
            const hasAppt = apptDates.has(d.key);
            return (
              <button
                key={d.key}
                onClick={() => { onSelectDay(d.key); onClose(); }}
                style={{
                  width: '100%', aspectRatio: '1', border: 'none',
                  borderRadius: 'var(--radius-full)', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: isSelected ? 'var(--accent)' : (isToday ? 'var(--accent-light)' : 'transparent'),
                  color: isSelected ? '#fff' : (isToday ? 'var(--accent)' : 'var(--text-primary)'),
                  fontSize: 14, fontWeight: isToday || isSelected ? 700 : 500,
                  WebkitTapHighlightColor: 'transparent',
                  position: 'relative',
                }}
              >
                {d.day}
                {hasAppt && (
                  <div style={{
                    position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2,
                    background: isSelected ? '#fff' : 'var(--accent)',
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Today shortcut */}
        <button onClick={() => { onSelectDay(todayStr); onClose(); }} style={{
          width: '100%', marginTop: 12, height: 44, borderRadius: 'var(--tech-radius-button)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          fontSize: 14, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
        }}>
          Go to Today
        </button>
      </div>
    </>
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
  const [selectedDay, setSelectedDay] = useState(() => fmtDate(new Date()));
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const dateRefs = useRef({});

  const todayStr = fmtDate(new Date());
  const tomorrowStr = fmtDate(addDays(new Date(), 1));

  // Load a wide range around the selected day
  const dateRange = useMemo(() => {
    const sel = new Date(selectedDay + 'T12:00:00');
    const start = fmtDate(addDays(sel, -STRIP_CENTER));
    const end = fmtDate(addDays(sel, STRIP_DAYS - STRIP_CENTER));
    return { start, end };
  }, [selectedDay]);

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

  // Dates that have appointments (for dot indicators)
  const apptDates = useMemo(() => {
    const set = new Set();
    appointments.forEach(a => { if (a.date) set.add(a.date); });
    return set;
  }, [appointments]);

  // Group appointments by date
  const grouped = useMemo(() => {
    const g = {};
    appointments.forEach(a => {
      if (!g[a.date]) g[a.date] = [];
      g[a.date].push(a);
    });
    return g;
  }, [appointments]);

  // For list view: sorted dates that have appointments
  const sortedDatesWithAppts = useMemo(() => {
    return Object.keys(grouped).sort();
  }, [grouped]);

  // For daily view: selected day's appointments
  const dailyAppts = useMemo(() => {
    return (grouped[selectedDay] || []).sort((a, b) => (a.time_start || '').localeCompare(b.time_start || ''));
  }, [grouped, selectedDay]);

  // Month/year label for header
  const headerLabel = useMemo(() => {
    const d = new Date(selectedDay + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [selectedDay]);

  const handleSelectDay = (dayKey) => {
    setSelectedDay(dayKey);
    if (view === 'list' && dateRefs.current[dayKey]) {
      dateRefs.current[dayKey].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="tech-page" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-light)',
      }}>
        {/* Top row: title + controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
          <div>
            <div style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
              Schedule
            </div>
            {/* Tappable month/year label → opens month picker */}
            <button
              onClick={() => setShowMonthPicker(true)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: 'var(--accent)',
                display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
              }}
            >
              {headerLabel}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Today button — visible when not on today */}
            {selectedDay !== todayStr && (
              <button
                onClick={() => handleSelectDay(todayStr)}
                style={{
                  height: 32, padding: '0 12px', borderRadius: 'var(--tech-radius-button)',
                  background: 'transparent', border: '1px solid var(--accent)',
                  color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
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

        {/* Continuous scrolling date strip */}
        <DateStrip
          selectedDay={selectedDay}
          onSelectDay={handleSelectDay}
          apptDates={apptDates}
        />
      </div>

      {/* Month picker overlay */}
      {showMonthPicker && (
        <MonthPicker
          selectedDay={selectedDay}
          onSelectDay={handleSelectDay}
          onClose={() => setShowMonthPicker(false)}
          apptDates={apptDates}
        />
      )}

      {/* Content */}
      {loading ? (
        <div className="loading-page"><div className="spinner" /></div>
      ) : view === 'daily' ? (
        /* ── Daily View ── */
        <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
          <div style={{
            padding: '8px 16px', background: 'var(--accent-light)',
            borderBottom: '1px solid var(--border-light)',
            fontSize: 14, fontWeight: 700, color: 'var(--accent)',
          }}>
            {formatDateHeader(selectedDay, todayStr, tomorrowStr)}
          </div>

          {dailyAppts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" style={{ opacity: 0.4, marginBottom: 8 }}>
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <div style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>No appointments this day</div>
            </div>
          ) : (
            dailyAppts.map(appt => <ApptRow key={appt.id} appt={appt} navigate={navigate} />)
          )}
        </PullToRefresh>
      ) : (
        /* ── List View ── */
        <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
          {sortedDatesWithAppts.length === 0 ? (
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
                Scroll the date strip or tap the month to navigate
              </div>
            </div>
          ) : (
            sortedDatesWithAppts.map(dateStr => {
              const appts = grouped[dateStr];
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
