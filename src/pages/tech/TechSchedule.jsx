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

/* ── Filter persistence helpers ── */
const MITIGATION_DIVS = ['water', 'mold', 'contents'];

function loadFilters(empId) {
  try {
    const raw = localStorage.getItem(`tech_schedule_filters_${empId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old single-string employee filter to new format
      if (typeof parsed.employee === 'string' && parsed.employee !== 'me' && parsed.employee !== 'all') {
        parsed.employee = [parsed.employee];
      }
      return parsed;
    }
  } catch {}
  return { employee: 'me', division: 'all' };
}
function saveFilters(empId, filters) {
  try { localStorage.setItem(`tech_schedule_filters_${empId}`, JSON.stringify(filters)); } catch {}
}

/* ── Main Component ── */

export default function TechSchedule() {
  const { employee, db } = useAuth();
  const navigate = useNavigate();
  const [allAppointments, setAllAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'daily'
  const [selectedDay, setSelectedDay] = useState(() => fmtDate(new Date()));
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showCreatePicker, setShowCreatePicker] = useState(false); // Job appt vs Event picker
  const dateRefs = useRef({});
  const didScrollToToday = useRef(false);

  // Filter state — persisted per employee
  const [filterEmployee, setFilterEmployee] = useState(() => loadFilters(employee.id).employee);
  const [filterDivision, setFilterDivision] = useState(() => loadFilters(employee.id).division);

  // Persist filters on change
  useEffect(() => {
    saveFilters(employee.id, { employee: filterEmployee, division: filterDivision });
  }, [employee.id, filterEmployee, filterDivision]);

  // Build crew member list from loaded appointments
  const crewMembers = useMemo(() => {
    const map = new Map();
    allAppointments.forEach(a => {
      (a.appointment_crew || []).forEach(c => {
        if (!map.has(c.employee_id)) {
          map.set(c.employee_id, {
            id: c.employee_id,
            name: c.employees?.display_name || c.employees?.full_name || 'Unknown',
          });
        }
      });
    });
    // Sort: current user first, then alphabetical
    return [...map.values()].sort((a, b) => {
      if (a.id === employee.id) return -1;
      if (b.id === employee.id) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allAppointments, employee.id]);

  const todayStr = fmtDate(new Date());
  const tomorrowStr = fmtDate(addDays(new Date(), 1));

  // Load a wide range around the selected day
  const dateRange = useMemo(() => {
    const sel = new Date(selectedDay + 'T12:00:00');
    const start = fmtDate(addDays(sel, -STRIP_CENTER));
    const end = fmtDate(addDays(sel, STRIP_DAYS - STRIP_CENTER));
    return { start, end };
  }, [selectedDay]);

  const hasFetched = useRef(false);
  const load = useCallback(async () => {
    if (!hasFetched.current) setLoading(true);
    try {
      const result = await db.rpc('get_appointments_range', {
        p_start_date: dateRange.start,
        p_end_date: dateRange.end,
      });
      setAllAppointments(result || []);
    } catch (e) {
      toast('Failed to load schedule', 'error');
    }
    setLoading(false);
    hasFetched.current = true;
  }, [db, dateRange.start, dateRange.end]);

  useEffect(() => { load(); }, [load]);

  // Apply employee + division + search filters
  const appointments = useMemo(() => {
    let list = allAppointments;

    // Employee filter
    if (filterEmployee === 'me') {
      list = list.filter(a => a.appointment_crew?.some(c => c.employee_id === employee.id));
    } else if (Array.isArray(filterEmployee)) {
      list = list.filter(a => a.appointment_crew?.some(c => filterEmployee.includes(c.employee_id)));
    }
    // 'all' = no employee filter

    // Division filter
    if (filterDivision === 'mitigation') {
      list = list.filter(a => MITIGATION_DIVS.includes(a.jobs?.division));
    } else if (filterDivision === 'reconstruction') {
      list = list.filter(a => a.jobs?.division === 'reconstruction');
    }

    return list;
  }, [allAppointments, filterEmployee, filterDivision, employee.id]);

  // Dates that have appointments (for dot indicators — after filters)
  const apptDates = useMemo(() => {
    const set = new Set();
    appointments.forEach(a => { if (a.date) set.add(a.date); });
    return set;
  }, [appointments]);

  // Filter appointments by search query
  const filteredAppointments = useMemo(() => {
    if (!searchQuery.trim()) return appointments;
    const q = searchQuery.toLowerCase();
    return appointments.filter(a => {
      const job = a.jobs;
      return (
        (a.title || '').toLowerCase().includes(q) ||
        (job?.insured_name || '').toLowerCase().includes(q) ||
        (job?.address || '').toLowerCase().includes(q) ||
        (job?.city || '').toLowerCase().includes(q) ||
        (job?.job_number || '').toLowerCase().includes(q)
      );
    });
  }, [appointments, searchQuery]);

  const hasActiveFilters = filterEmployee !== 'me' || filterDivision !== 'all';

  // Toggle an individual crew member in/out of multi-select
  const toggleCrewFilter = (id) => {
    setFilterEmployee(prev => {
      let selected;
      if (prev === 'me') {
        // Switching from "Me" to picking individuals — start with me + the tapped person
        selected = [employee.id, id];
      } else if (prev === 'all') {
        // Switching from "All" to just this one person
        selected = [id];
      } else if (Array.isArray(prev)) {
        if (prev.includes(id)) {
          selected = prev.filter(x => x !== id);
          if (selected.length === 0) return 'me'; // nothing left → back to "Me"
          if (selected.length === 1 && selected[0] === employee.id) return 'me'; // only me left
        } else {
          selected = [...prev, id];
        }
      } else {
        selected = [id];
      }
      return selected;
    });
  };

  // Group filtered appointments by date
  const grouped = useMemo(() => {
    const g = {};
    filteredAppointments.forEach(a => {
      if (!g[a.date]) g[a.date] = [];
      g[a.date].push(a);
    });
    return g;
  }, [filteredAppointments]);

  // For list view: all sorted dates with appointments (past + future)
  const sortedDatesWithAppts = useMemo(() => {
    return Object.keys(grouped).sort();
  }, [grouped]);

  // Callback ref for today's header — scrolls it into view when first mounted
  const todayScrollRef = useCallback((el) => {
    if (!el || didScrollToToday.current) return;
    didScrollToToday.current = true;
    // Delay enough for full list to render and scroll container to get final height
    setTimeout(() => {
      const container = document.querySelector('.tech-content');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        container.scrollTop += elRect.top - containerRect.top;
      }
    }, 300);
  }, []);

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
    <div className="tech-page" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header — sticky, does not scroll with content */}
      <div style={{
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-light)',
        position: 'sticky', top: 0, zIndex: 10,
        flexShrink: 0,
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
                  height: 40, padding: '0 12px', borderRadius: 'var(--tech-radius-button)',
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
                  width: 44, height: 40, border: 'none', cursor: 'pointer',
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
                  width: 44, height: 40, border: 'none', cursor: 'pointer',
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

            {/* + New — opens Job appointment vs Event picker */}
            <button
              onClick={() => setShowCreatePicker(true)}
              style={{
                width: 44, height: 44, borderRadius: 'var(--tech-radius-button)',
                background: 'var(--accent)', color: '#fff', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
              aria-label="Create appointment or event"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar + filter toggle */}
        <div style={{ padding: '8px 16px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, address, job #..."
              style={{
                width: '100%', height: 40, paddingLeft: 36, paddingRight: searchQuery ? 32 : 12,
                fontSize: 16, borderRadius: 'var(--tech-radius-button)',
                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--bg-tertiary)', border: 'none', borderRadius: 'var(--radius-full)',
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', padding: 0,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          {/* Filter toggle button */}
          <button
            onClick={() => setShowFilters(v => !v)}
            style={{
              width: 40, height: 40, flexShrink: 0, borderRadius: 'var(--tech-radius-button)',
              border: hasActiveFilters ? '2px solid var(--accent)' : '1px solid var(--border-color)',
              background: hasActiveFilters ? 'var(--accent-light)' : 'var(--bg-secondary)',
              color: hasActiveFilters ? 'var(--accent)' : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', position: 'relative',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {hasActiveFilters && (
              <div style={{
                position: 'absolute', top: -3, right: -3, width: 10, height: 10,
                borderRadius: 5, background: 'var(--accent)', border: '2px solid var(--bg-primary)',
              }} />
            )}
          </button>
        </div>

        {/* Expandable filter panel */}
        {showFilters && (
          <div style={{ padding: '8px 16px 4px', borderTop: '1px solid var(--border-light)', marginTop: 4 }}>
            {/* Division filter */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Type</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { key: 'all', label: 'All' },
                  { key: 'mitigation', label: 'Mitigation' },
                  { key: 'reconstruction', label: 'Reconstruction' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setFilterDivision(opt.key)}
                    style={{
                      height: 36, padding: '0 14px', borderRadius: 'var(--radius-full)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      border: filterDivision === opt.key ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                      background: filterDivision === opt.key ? 'var(--accent-light)' : 'var(--bg-primary)',
                      color: filterDivision === opt.key ? 'var(--accent)' : 'var(--text-secondary)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Employee filter */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Crew</div>
              <div style={{
                display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
                scrollbarWidth: 'none', msOverflowStyle: 'none',
              }}>
                <style>{`.tech-crew-chips::-webkit-scrollbar{display:none}`}</style>
                <div className="tech-crew-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {/* Me chip */}
                  <button
                    onClick={() => setFilterEmployee('me')}
                    style={{
                      height: 36, padding: '0 14px', borderRadius: 'var(--radius-full)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                      border: filterEmployee === 'me' ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                      background: filterEmployee === 'me' ? 'var(--accent-light)' : 'var(--bg-primary)',
                      color: filterEmployee === 'me' ? 'var(--accent)' : 'var(--text-secondary)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    Me
                  </button>
                  {/* All chip */}
                  <button
                    onClick={() => setFilterEmployee('all')}
                    style={{
                      height: 36, padding: '0 14px', borderRadius: 'var(--radius-full)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                      border: filterEmployee === 'all' ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                      background: filterEmployee === 'all' ? 'var(--accent-light)' : 'var(--bg-primary)',
                      color: filterEmployee === 'all' ? 'var(--accent)' : 'var(--text-secondary)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    All
                  </button>
                  {/* Individual crew members — multi-select */}
                  {crewMembers.map(c => {
                    const isMe = c.id === employee.id;
                    const isSelected = Array.isArray(filterEmployee) && filterEmployee.includes(c.id);
                    return (
                    <button
                      key={c.id}
                      onClick={() => toggleCrewFilter(c.id)}
                      style={{
                        height: 36, padding: '0 14px', borderRadius: 'var(--radius-full)',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                        border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                        background: isSelected ? 'var(--accent-light)' : 'var(--bg-primary)',
                        color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {isMe ? `Me (${c.name})` : c.name}
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

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
            <>
              {sortedDatesWithAppts.map((dateStr, idx) => {
                const appts = grouped[dateStr];
                const isToday = dateStr === todayStr;
                const isTomorrow = dateStr === tomorrowStr;
                const isScrollTarget = dateStr >= todayStr && !sortedDatesWithAppts.slice(0, idx).some(d => d >= todayStr);

                return (
                  <div key={dateStr} ref={el => {
                    dateRefs.current[dateStr] = el;
                    if (isScrollTarget && el) todayScrollRef(el);
                  }}>
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
              })}
              {/* Spacer so today can scroll to the top even when it's the last date */}
              <div style={{ minHeight: '70vh' }} />
            </>
          )}
        </PullToRefresh>
      )}

      {/* ── Create picker: Job appointment vs Event ── */}
      {showCreatePicker && (
        <div
          onClick={() => setShowCreatePicker(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            zIndex: 1000, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 520,
              background: 'var(--bg-primary)',
              borderRadius: 'var(--tech-radius-card) var(--tech-radius-card) 0 0',
              paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))`,
              boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
              overflow: 'hidden',
              animation: 'techFabIn 0.18s ease-out',
            }}
          >
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Create new</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
            </div>
            <button
              onClick={() => { setShowCreatePicker(false); navigate(`/tech/new-appointment?date=${selectedDay}`); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                padding: '16px 20px', minHeight: 'var(--tech-min-tap)',
                background: 'var(--bg-primary)', border: 'none', borderBottom: '1px solid var(--border-light)',
                cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'var(--accent-light)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              </span>
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Job appointment</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Linked to a job, with tasks &amp; crew</div>
              </span>
              <span style={{ fontSize: 18, color: 'var(--text-tertiary)' }}>›</span>
            </button>
            <button
              onClick={() => { setShowCreatePicker(false); navigate(`/tech/new-event?date=${selectedDay}`); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                padding: '16px 20px', minHeight: 'var(--tech-min-tap)',
                background: 'var(--bg-primary)', border: 'none',
                cursor: 'pointer', fontFamily: 'var(--font-sans)', textAlign: 'left',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{
                width: 40, height: 40, borderRadius: 12,
                background: '#faf5ff', color: '#7c3aed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </span>
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Event</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Meeting, PTO, training — no job needed</div>
              </span>
              <span style={{ fontSize: 18, color: 'var(--text-tertiary)' }}>›</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
