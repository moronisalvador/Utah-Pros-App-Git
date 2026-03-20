import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_COLORS, TYPE_COLORS, STATUS_LABELS, WEEKDAYS_FULL, fmtDate, fmtShort, fmtTime, getMonday } from '@/lib/scheduleUtils';
import JobPanel from '@/components/JobPanel';
import CreateAppointmentModal from '@/components/CreateAppointmentModal';
import EditAppointmentModal from '@/components/EditAppointmentModal';
import CalendarView from '@/components/CalendarView';

const SPAN_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3 Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ═══════════════════════════════════════════════════════════════
// APPOINTMENT CARDS (used in Jobs/Crew grid views)
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
// CREW APPOINTMENT CARD (shows job name instead of crew)
// ═══════════════════════════════════════════════════════════════

function CrewApptCard({ appt, onClick }) {
  const dc = DIV_COLORS[appt._division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
  const color = appt.color || TYPE_COLORS[appt.type] || '#6b7280';
  const isDone = appt.status === 'completed';
  const isActive = ['en_route', 'in_progress'].includes(appt.status);
  const status = STATUS_LABELS[appt.status] || STATUS_LABELS.scheduled;

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
      {/* Job name badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
          background: dc.bg, color: dc.text,
        }}>{appt._jobName}</span>
      </div>
      {/* Appointment title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 }}>
        {appt.title}
      </div>
      {appt.time_start && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 2 }}>
          {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
        </div>
      )}
      {appt.notes && (
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.3, marginBottom: 2,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{appt.notes}</div>
      )}
      {isActive && (
        <div style={{ fontSize: 10, fontWeight: 600, color: status.color, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />
          {status.label}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MONTH VIEW — traditional calendar grid
// ═══════════════════════════════════════════════════════════════

function MonthView({ anchor, boardData, onApptClick, onDayClick, showWeekend }) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDow = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = lastOfMonth.getDate();
  const todayKey = fmtDate(new Date());
  const weekdayHeaders = showWeekend ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const colCount = weekdayHeaders.length;

  // Build appointment lookup by date
  const byDate = {};
  for (const job of boardData) {
    for (const appt of (job.appointments || [])) {
      if (!byDate[appt.date]) byDate[appt.date] = [];
      const crew = appt.crew || [];
      const leadCrew = crew.find(c => c.role === 'lead');
      byDate[appt.date].push({
        ...appt,
        _jobName: job.insured_name,
        _color: leadCrew?.color || appt.color || TYPE_COLORS[appt.type] || '#6b7280',
      });
    }
  }

  // Build 6-week grid (always 6 rows for consistent height)
  const weeks = [];
  let day = 1 - startDow;
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(year, month, day);
      const inMonth = day >= 1 && day <= daysInMonth;
      week.push({ day, date, inMonth, key: fmtDate(date) });
      day++;
    }
    weeks.push(week);
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 0 8px' }}>
      {/* Weekday headers */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${colCount}, 1fr)`, borderBottom: '1px solid var(--border-color)' }}>
        {weekdayHeaders.map(d => (
          <div key={d} style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            textAlign: 'center', padding: '8px 0', background: 'var(--bg-secondary)',
          }}>{d}</div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => {
        const filtered = showWeekend ? week : week.filter(cell => {
          const dow = cell.date.getDay();
          return dow !== 0 && dow !== 6;
        });
        return (
        <div key={wi} style={{ display: 'grid', gridTemplateColumns: `repeat(${colCount}, 1fr)`, minHeight: 90 }}>
          {filtered.map((cell, di) => {
            const appts = byDate[cell.key] || [];
            const isToday = cell.key === todayKey;
            return (
              <div key={di}
                onClick={() => cell.inMonth && onDayClick(cell.key)}
                style={{
                  borderBottom: '1px solid var(--border-light)',
                  borderRight: di < filtered.length - 1 ? '1px solid var(--border-light)' : 'none',
                  padding: '4px 5px', cursor: cell.inMonth ? 'pointer' : 'default',
                  background: isToday ? '#f8fbff' : 'transparent',
                  opacity: cell.inMonth ? 1 : 0.35,
                  minHeight: 90,
                }}
                onMouseEnter={e => { if (cell.inMonth) e.currentTarget.style.background = isToday ? '#f0f7ff' : 'var(--bg-secondary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isToday ? '#f8fbff' : 'transparent'; }}
              >
                {/* Day number */}
                <div style={{
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#fff' : cell.inMonth ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                  borderRadius: 11, background: isToday ? 'var(--accent)' : 'transparent',
                  display: isToday ? 'flex' : 'block', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 3,
                }}>{cell.date.getDate()}</div>

                {/* Appointment strips */}
                {appts.slice(0, 3).map(a => (
                  <div key={a.id}
                    onClick={e => { e.stopPropagation(); onApptClick(a); }}
                    style={{
                      fontSize: 10, fontWeight: 500, lineHeight: 1.2,
                      padding: '2px 4px', marginBottom: 2, borderRadius: 3,
                      background: a._color, color: '#fff',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'}
                    onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                  >
                    {a.time_start ? fmtTime(a.time_start) + ' ' : ''}{a._jobName}
                  </div>
                ))}
                {appts.length > 3 && (
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 500, paddingLeft: 4 }}>
                    +{appts.length - 3} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN: SCHEDULE PAGE
// ═══════════════════════════════════════════════════════════════

export default function Schedule() {
  const { db, employee } = useAuth();

  const [anchor, setAnchor] = useState(() => new Date()); // reference date for all views
  const [boardData, setBoardData] = useState([]);
  const [panelJobs, setPanelJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState(true);
  const [showWeekend, setShowWeekend] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('upr_schedule_view') || 'calendar'; } catch { return 'calendar'; }
  });
  const changeViewMode = (mode) => {
    setViewMode(mode);
    try { localStorage.setItem('upr_schedule_view', mode); } catch {}
  };
  const [calSpan, setCalSpan] = useState(() => {
    try { return localStorage.getItem('upr_schedule_span') || 'week'; } catch { return 'week'; }
  });
  const changeCalSpan = (span) => {
    setCalSpan(span);
    try { localStorage.setItem('upr_schedule_span', span); } catch {}
  };

  const [crewFilter, setCrewFilter] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [selectedPanelJob, setSelectedPanelJob] = useState(null);
  const [allEmployees, setAllEmployees] = useState([]);
  const [autoShow, setAutoShow] = useState(true);
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);

  // ── Compute days array based on calSpan ──
  const days = useMemo(() => {
    const todayStr = fmtDate(new Date());

    if (calSpan === 'day') {
      const d = new Date(anchor);
      const key = fmtDate(d);
      return [{ date: d, key, label: WEEKDAYS_FULL[d.getDay()], shortDate: fmtShort(d), isToday: key === todayStr }];
    }

    if (calSpan === '3day') {
      const result = [];
      const cursor = new Date(anchor);
      while (result.length < 3) {
        const dow = cursor.getDay();
        if (showWeekend || (dow !== 0 && dow !== 6)) {
          const key = fmtDate(cursor);
          result.push({ date: new Date(cursor), key, label: WEEKDAYS_FULL[dow], shortDate: fmtShort(cursor), isToday: key === todayStr });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      return result;
    }

    if (calSpan === 'month') {
      const y = anchor.getFullYear(), m = anchor.getMonth();
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      const startDay = new Date(first); startDay.setDate(1 - first.getDay()); // back to Sunday
      const endDay = new Date(last); endDay.setDate(last.getDate() + (6 - last.getDay())); // forward to Saturday
      const result = [];
      const cursor = new Date(startDay);
      while (cursor <= endDay) {
        const key = fmtDate(cursor);
        result.push({ date: new Date(cursor), key, label: WEEKDAYS_FULL[cursor.getDay()], shortDate: fmtShort(cursor), isToday: key === todayStr });
        cursor.setDate(cursor.getDate() + 1);
      }
      return result;
    }

    // week (default)
    const monday = getMonday(anchor);
    const count = showWeekend ? 7 : 5;
    const start = showWeekend ? new Date(monday.getTime() - 86400000) : monday;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = fmtDate(d);
      return { date: d, key, label: WEEKDAYS_FULL[d.getDay()], shortDate: fmtShort(d), isToday: key === todayStr };
    });
  }, [anchor, calSpan, showWeekend]);

  // ── Navigation ──
  const goToday = () => setAnchor(new Date());
  const goPrev = () => {
    setAnchor(d => {
      const n = new Date(d);
      if (calSpan === 'day') n.setDate(n.getDate() - 1);
      else if (calSpan === '3day') n.setDate(n.getDate() - 3);
      else if (calSpan === 'month') n.setMonth(n.getMonth() - 1);
      else n.setDate(n.getDate() - 7);
      return n;
    });
  };
  const goNext = () => {
    setAnchor(d => {
      const n = new Date(d);
      if (calSpan === 'day') n.setDate(n.getDate() + 1);
      else if (calSpan === '3day') n.setDate(n.getDate() + 3);
      else if (calSpan === 'month') n.setMonth(n.getMonth() + 1);
      else n.setDate(n.getDate() + 7);
      return n;
    });
  };

  const todayLabel = calSpan === 'month' ? 'This month' : calSpan === 'week' ? 'This week' : 'Today';

  // ── Subtitle ──
  const subtitleText = useMemo(() => {
    if (calSpan === 'month') {
      return `${MONTHS_FULL[anchor.getMonth()]} ${anchor.getFullYear()}`;
    }
    if (calSpan === 'day') {
      return days[0]?.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) || '';
    }
    return `${fmtShort(days[0]?.date)} – ${fmtShort(days[days.length - 1]?.date)}`;
  }, [days, calSpan, anchor]);

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
      const r = await db.rpc('get_dispatch_board', {
        p_start_date: days[0].key,
        p_end_date: days[days.length - 1].key,
        p_auto_show: autoShow,
      });
      setBoardData(Array.isArray(r) ? r : []);
    } catch (e) { console.error('Board:', e); }
    finally { setLoading(false); }
  }, [db, days, autoShow]);

  const silentReloadBoard = useCallback(async () => {
    try {
      const r = await db.rpc('get_dispatch_board', {
        p_start_date: days[0].key,
        p_end_date: days[days.length - 1].key,
        p_auto_show: autoShow,
      });
      setBoardData(Array.isArray(r) ? r : []);
    } catch (e) { console.error('Silent reload:', e); }
  }, [db, days, autoShow]);

  useEffect(() => { loadPanelJobs(); }, [loadPanelJobs]);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // ── Load employees for crew assignment ──
  useEffect(() => {
    db.select('employees', 'is_active=eq.true&order=display_name.asc&select=id,display_name,full_name,role,color,avatar_url')
      .then(setAllEmployees)
      .catch(() => {});
  }, [db]);

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

  // ── Cell lookup: job view ──
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

  // ── Crew view: pivot by employee × date ──
  const { crewList, crewCellMap } = useMemo(() => {
    const empMap = {};
    const cells = {};
    for (const job of boardData) {
      for (const appt of (job.appointments || [])) {
        for (const crew of (appt.crew || [])) {
          if (!empMap[crew.employee_id]) {
            empMap[crew.employee_id] = {
              id: crew.employee_id, display_name: crew.display_name,
              full_name: crew.full_name, role: crew.role,
            };
          }
          const k = `${crew.employee_id}_${appt.date}`;
          if (!cells[k]) cells[k] = [];
          cells[k].push({
            ...appt, _jobName: job.insured_name, _jobNumber: job.job_number,
            _division: job.division, _jobId: job.job_id,
          });
        }
      }
    }
    const list = Object.values(empMap).sort((a, b) =>
      (a.display_name || a.full_name || '').localeCompare(b.display_name || b.full_name || '')
    );
    return { crewList: list, crewCellMap: cells };
  }, [boardData]);

  // ── Apply crew filter ──
  const filteredCellMap = useMemo(() => {
    if (!crewFilter) return cellMap;
    const m = {};
    for (const [key, appts] of Object.entries(cellMap)) {
      const filtered = appts.filter(a => a.crew?.some(c => c.employee_id === crewFilter));
      if (filtered.length > 0) m[key] = filtered;
    }
    return m;
  }, [cellMap, crewFilter]);

  const filteredBoardData = useMemo(() => {
    if (!crewFilter) return boardData;
    return boardData.filter(job =>
      job.appointments?.some(a => a.crew?.some(c => c.employee_id === crewFilter))
    );
  }, [boardData, crewFilter]);

  const filteredCrewList = useMemo(() => {
    if (!crewFilter) return crewList;
    return crewList.filter(e => e.id === crewFilter);
  }, [crewList, crewFilter]);

  const totalAppts = filteredBoardData.reduce((s, j) => s + (j.appointments?.length || 0), 0);
  const todayKey = fmtDate(new Date());
  const todayAppts = filteredBoardData.reduce((s, j) => s + (j.appointments?.filter(a => a.date === todayKey).length || 0), 0);

  const handleApptClick = (appt) => { setEditModal(appt); };

  // ── Drag-and-drop: MOVE appointment (optimistic) ──
  const handleApptDrop = async (apptId, newDate, newTimeStart, newTimeEnd) => {
    const prev = boardData;
    setBoardData(data => data.map(job => ({
      ...job,
      appointments: (job.appointments || []).map(a =>
        a.id === apptId ? { ...a, date: newDate, time_start: newTimeStart, time_end: newTimeEnd } : a
      ),
    })));
    try {
      await db.rpc('update_appointment', {
        p_appointment_id: apptId, p_title: null, p_date: newDate,
        p_time_start: newTimeStart, p_time_end: newTimeEnd,
        p_type: null, p_status: null, p_notes: null,
      });
      silentReloadBoard();
    } catch (e) { console.error('Drop move failed:', e); setBoardData(prev); }
  };

  // ── Drag resize: change end time (optimistic) ──
  const handleApptResize = async (apptId, newTimeEnd) => {
    const prev = boardData;
    setBoardData(data => data.map(job => ({
      ...job,
      appointments: (job.appointments || []).map(a =>
        a.id === apptId ? { ...a, time_end: newTimeEnd } : a
      ),
    })));
    try {
      await db.rpc('update_appointment', {
        p_appointment_id: apptId, p_title: null, p_date: null,
        p_time_start: null, p_time_end: newTimeEnd,
        p_type: null, p_status: null, p_notes: null,
      });
      silentReloadBoard();
    } catch (e) { console.error('Resize failed:', e); setBoardData(prev); }
  };

  const [jobPickerModal, setJobPickerModal] = useState(null);
  const [jobPickerSearch, setJobPickerSearch] = useState('');

  const handleCellClick = (dateKey, hour) => {
    if (selectedPanelJob) {
      const timeStr = `${String(hour).padStart(2, '0')}:00`;
      const endHour = Math.min(hour + 2, 18);
      const endStr = `${String(endHour).padStart(2, '0')}:00`;
      setCreateModal({
        jobId: selectedPanelJob.id, jobName: selectedPanelJob.insured_name,
        dateKey, prefillTaskIds: [], prefillTimeStart: timeStr, prefillTimeEnd: endStr,
      });
    } else {
      setJobPickerModal({ dateKey, hour });
      setJobPickerSearch('');
    }
  };

  const handleJobPicked = (job) => {
    const { dateKey, hour } = jobPickerModal;
    const timeStr = `${String(hour).padStart(2, '0')}:00`;
    const endHour = Math.min(hour + 2, 18);
    const endStr = `${String(endHour).padStart(2, '0')}:00`;
    setJobPickerModal(null);
    setCreateModal({
      jobId: job.job_id || job.id, jobName: job.insured_name,
      dateKey, prefillTaskIds: [], prefillTimeStart: timeStr, prefillTimeEnd: endStr,
    });
  };

  // Month view: click day → switch to day view
  const handleMonthDayClick = (dateKey) => {
    const d = new Date(dateKey + 'T00:00:00');
    setAnchor(d);
    changeCalSpan('day');
  };

  return (
    <div style={S.page}>
      {/* Left panel */}
      <JobPanel
        jobs={panelJobs} panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
        onToggleJob={toggleJob} loading={panelLoading}
        db={db}
        refreshKey={panelRefreshKey}
        onSchedulePhase={(jobId, jobName, phase) => {
          const dateKey = phase?.target_start || fmtDate(new Date());
          setCreateModal({ jobId, jobName, dateKey, prefillPhase: phase?.phase_name || null, prefillTaskIds: [] });
        }}
        onCreateAppointment={(jobId, jobName, dateKey, taskIds) => {
          setCreateModal({ jobId, jobName, dateKey, prefillTaskIds: taskIds || [] });
        }}
        onSelectJob={(jobId) => {
          if (jobId) {
            const job = panelJobs.find(j => j.id === jobId);
            setSelectedPanelJob(job ? { id: job.id, insured_name: job.insured_name } : null);
          } else {
            setSelectedPanelJob(null);
          }
        }}
        onRefreshPanel={() => { loadPanelJobs(); loadBoard(); }}
      />

      {/* Main board */}
      <div style={S.main}>
        {/* Header */}
        <div style={S.header}>
          <div>
            <h1 style={S.title}>Schedule</h1>
            <div style={S.subtitle}>
              {subtitleText}
              <span style={S.pill}>{filteredBoardData.length} jobs</span>
              <span style={S.pill}>{totalAppts} appts</span>
              {todayAppts > 0 && <span style={{ ...S.pill, background: '#eff6ff', color: '#2563eb' }}>{todayAppts} today</span>}
            </div>
          </div>
          <div style={S.controls}>
            {/* View toggle (Calendar/Jobs/Crew) */}
            <div style={S.viewToggle}>
              <button style={{ ...S.viewBtn, ...(viewMode === 'calendar' ? S.viewBtnActive : {}) }}
                onClick={() => changeViewMode('calendar')}>Calendar</button>
              <button style={{ ...S.viewBtn, ...(viewMode === 'jobs' ? S.viewBtnActive : {}) }}
                onClick={() => changeViewMode('jobs')}>Jobs</button>
              <button style={{ ...S.viewBtn, ...(viewMode === 'crew' ? S.viewBtnActive : {}), borderRight: 'none' }}
                onClick={() => changeViewMode('crew')}>Crew</button>
            </div>
            {/* Span toggle (Day/3 Day/Week/Month) — only in calendar mode */}
            {viewMode === 'calendar' && (
              <div style={S.viewToggle}>
                {SPAN_OPTIONS.map((opt, i) => (
                  <button key={opt.value}
                    onClick={() => changeCalSpan(opt.value)}
                    style={{
                      ...S.viewBtn,
                      ...(calSpan === opt.value ? S.viewBtnActive : {}),
                      ...(i === SPAN_OPTIONS.length - 1 ? { borderRight: 'none' } : {}),
                    }}
                  >{opt.label}</button>
                ))}
              </div>
            )}
            {!panelOpen && <button style={S.btn} onClick={() => setPanelOpen(true)}>Jobs</button>}
            <button style={S.btn} onClick={goToday}>{todayLabel}</button>
            <button style={S.btnIcon} onClick={goPrev}>‹</button>
            <button style={S.btnIcon} onClick={goNext}>›</button>
            {viewMode === 'calendar' && calSpan !== 'day' && (
              <label style={S.checkLabel}>
                <input type="checkbox" checked={showWeekend} onChange={e => setShowWeekend(e.target.checked)} />
                <span>Weekends</span>
              </label>
            )}
            <label style={S.checkLabel}>
              <input type="checkbox" checked={autoShow} onChange={e => setAutoShow(e.target.checked)} />
              <span>Auto-show</span>
            </label>
          </div>
        </div>

        {/* Crew filter bar */}
        {crewList.length > 0 && (
          <div style={S.filterBar}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginRight: 4, flexShrink: 0 }}>Crew:</span>
            <button onClick={() => setCrewFilter(null)}
              style={{ ...S.crewPill, ...(crewFilter === null ? S.crewPillActive : {}) }}>All</button>
            {crewList.map(emp => (
              <button key={emp.id}
                onClick={() => setCrewFilter(crewFilter === emp.id ? null : emp.id)}
                style={{ ...S.crewPill, ...(crewFilter === emp.id ? S.crewPillActive : {}) }}>
                {emp.display_name || emp.full_name}
              </button>
            ))}
            {crewFilter && (
              <button onClick={() => setCrewFilter(null)}
                style={{ ...S.crewPill, color: 'var(--text-tertiary)', fontSize: 11 }}>Clear</button>
            )}
          </div>
        )}

        {/* Board */}
        {loading ? (
          <div style={S.center}>Loading...</div>
        ) : viewMode === 'calendar' && calSpan === 'month' ? (
          <MonthView anchor={anchor} boardData={filteredBoardData} onApptClick={handleApptClick} onDayClick={handleMonthDayClick} showWeekend={showWeekend} />
        ) : viewMode === 'calendar' ? (
          <CalendarView
            days={days}
            boardData={filteredBoardData}
            onApptClick={handleApptClick}
            onCellClick={handleCellClick}
            onApptDrop={handleApptDrop}
            onApptResize={handleApptResize}
          />
        ) : filteredBoardData.length === 0 && !crewFilter ? (
          <div style={S.center}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
              No jobs in production
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4, maxWidth: 280, textAlign: 'center' }}>
              Jobs move here automatically when a schedule is generated
            </div>
          </div>
        ) : filteredBoardData.length === 0 && crewFilter ? (
          <div style={S.center}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
              No appointments for this crew member
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
              <button onClick={() => setCrewFilter(null)} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-sans)' }}>Clear filter</button> to see all
            </div>
          </div>
        ) : viewMode === 'crew' && filteredCrewList.length === 0 ? (
          <div style={S.center}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
              No crew assigned this week
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4, maxWidth: 300, textAlign: 'center' }}>
              Assign crew members to appointments to see them here, or switch to Jobs view
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

              {/* ═══ JOBS VIEW ═══ */}
              {viewMode === 'jobs' && filteredBoardData.map(job => {
                const dc = DIV_COLORS[job.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
                return [
                  <div key={`lbl-${job.job_id}`} style={S.jobCell}>
                    <div style={S.jobCellName} title={job.insured_name}>{job.insured_name}</div>
                    {job.job_number && <div style={S.jobCellNum}>#{job.job_number}</div>}
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3, background: dc.bg, color: dc.text }}>
                        {dc.label}
                      </span>
                      {!job.pinned && (
                        <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>auto</span>
                      )}
                    </div>
                    {job.address && <div style={S.jobCellAddr} title={job.address}>{job.address.split(',')[0]}</div>}
                  </div>,
                  ...days.map(day => {
                    const appts = filteredCellMap[`${job.job_id}_${day.key}`] || [];
                    return (
                      <div
                        key={`${job.job_id}_${day.key}`}
                        style={{ ...S.cell, ...(day.isToday ? { background: '#fafcff' } : {}) }}
                        onClick={() => {
                          setCreateModal({
                            jobId: job.job_id, jobName: job.insured_name,
                            dateKey: day.key, prefillTaskIds: [],
                          });
                        }}
                        onMouseEnter={e => { const el = e.currentTarget.querySelector('[data-plus]'); if (el) el.style.opacity = '1'; }}
                        onMouseLeave={e => { const el = e.currentTarget.querySelector('[data-plus]'); if (el) el.style.opacity = '0'; }}
                      >
                        {appts.map(a => <ApptCard key={a.id} appt={a} onClick={handleApptClick} />)}
                        {appts.length === 0 && (
                          <div data-plus style={S.plusWrap}><span style={S.plus}>+</span></div>
                        )}
                      </div>
                    );
                  }),
                ];
              })}

              {/* ═══ CREW VIEW ═══ */}
              {viewMode === 'crew' && filteredCrewList.map(emp => {
                return [
                  <div key={`emp-${emp.id}`} style={S.jobCell}>
                    <div style={S.jobCellName}>{emp.display_name || emp.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize', marginTop: 2 }}>
                      {days.reduce((c, d) => c + (crewCellMap[`${emp.id}_${d.key}`]?.length || 0), 0)} appts this week
                    </div>
                  </div>,
                  ...days.map(day => {
                    const appts = crewCellMap[`${emp.id}_${day.key}`] || [];
                    return (
                      <div
                        key={`${emp.id}_${day.key}`}
                        style={{ ...S.cell, ...(day.isToday ? { background: '#fafcff' } : {}) }}
                      >
                        {appts.map(a => <CrewApptCard key={`${a.id}_${emp.id}`} appt={a} onClick={handleApptClick} />)}
                      </div>
                    );
                  }),
                ];
              })}
            </div>
          </div>
        )}
      </div>

      {/* Create appointment modal */}
      {createModal && (
        <CreateAppointmentModal
          jobId={createModal.jobId}
          jobName={createModal.jobName}
          dateKey={createModal.dateKey}
          prefillTaskIds={createModal.prefillTaskIds || []}
          prefillTimeStart={createModal.prefillTimeStart}
          prefillTimeEnd={createModal.prefillTimeEnd}
          db={db}
          employees={allEmployees}
          onClose={() => setCreateModal(null)}
          onSaved={(savedDate) => {
            if (savedDate) setAnchor(new Date(savedDate + 'T00:00:00'));
            setCreateModal(null);
            loadBoard();
            setPanelRefreshKey(k => k + 1);
          }}
        />
      )}

      {/* Edit appointment modal */}
      {editModal && (
        <EditAppointmentModal
          appointment={editModal}
          db={db}
          employees={allEmployees}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); loadBoard(); setPanelRefreshKey(k => k + 1); }}
          onDeleted={() => { setEditModal(null); loadBoard(); setPanelRefreshKey(k => k + 1); }}
        />
      )}

      {/* Job picker modal */}
      {jobPickerModal && (() => {
        const fmtPickerDate = new Date(jobPickerModal.dateKey + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        });
        const fmtPickerTime = `${jobPickerModal.hour % 12 || 12}:00${jobPickerModal.hour >= 12 ? 'pm' : 'am'}`;
        const q = jobPickerSearch.toLowerCase();
        const productionJobs = boardData.filter(j => q ? j.insured_name.toLowerCase().includes(q) : true);
        const otherJobs = panelJobs.filter(j =>
          !boardData.some(b => b.job_id === j.id) &&
          (q ? j.insured_name.toLowerCase().includes(q) : true)
        );
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
            alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, paddingTop: 80 }}
            onClick={() => setJobPickerModal(null)}>
            <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)',
              width: '100%', maxWidth: 400, maxHeight: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column',
              boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Select job</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{fmtPickerDate} at {fmtPickerTime}</div>
              </div>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}>
                <input style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-sans)',
                  outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-primary)' }}
                  placeholder="Search jobs..." value={jobPickerSearch}
                  onChange={e => setJobPickerSearch(e.target.value)} autoFocus />
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {productionJobs.length > 0 && (
                  <>
                    <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      color: 'var(--text-tertiary)', letterSpacing: '0.04em', background: 'var(--bg-secondary)' }}>
                      In Production ({productionJobs.length})
                    </div>
                    {productionJobs.map(job => (
                      <div key={job.job_id} onClick={() => handleJobPicked(job)}
                        style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{job.insured_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                          #{job.job_number} · {job.address?.split(',')[0]}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {otherJobs.length > 0 && (
                  <>
                    <div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      color: 'var(--text-tertiary)', letterSpacing: '0.04em', background: 'var(--bg-secondary)' }}>
                      Other Jobs ({otherJobs.length})
                    </div>
                    {otherJobs.map(job => (
                      <div key={job.id} onClick={() => handleJobPicked(job)}
                        style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{job.insured_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                          #{job.job_number}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {productionJobs.length === 0 && otherJobs.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
                    No jobs found
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
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

  filterBar: {
    display: 'flex', alignItems: 'center', gap: 5, padding: '6px 20px',
    background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)',
    flexShrink: 0, overflowX: 'auto',
  },
  crewPill: {
    fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 99,
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)', transition: 'all 120ms ease',
  },
  crewPillActive: {
    background: 'var(--accent-light)', color: 'var(--accent)',
    borderColor: 'var(--accent)', fontWeight: 600,
  },
  viewToggle: {
    display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  viewBtn: {
    fontSize: 12, fontWeight: 500, padding: '5px 14px', border: 'none',
    background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-sans)', transition: 'all 120ms ease',
    borderRight: '1px solid var(--border-color)',
  },
  viewBtnActive: {
    background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600,
  },
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
