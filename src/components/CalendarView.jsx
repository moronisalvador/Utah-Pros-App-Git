import { useState, useRef, useCallback, useEffect } from 'react';
import { TYPE_COLORS, STATUS_LABELS, fmtTime } from '@/lib/scheduleUtils';

const CAL_START_HOUR = 7;
const CAL_END_HOUR = 18;
const CAL_HOUR_HEIGHT = 60;
const CAL_TOTAL_HOURS = CAL_END_HOUR - CAL_START_HOUR;
const SNAP_MINUTES = 30;
const MIN_DURATION = 30;
const RESIZE_HANDLE_HEIGHT = 10;
const HOVER_DELAY = 350;
const HOVER_LINGER = 200;

function timeToMinutes(t) {
  if (!t) return CAL_START_HOUR * 60 + 60;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function snapMinutes(mins) { return Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES; }
function clampMinutes(mins) { return Math.max(CAL_START_HOUR * 60, Math.min(CAL_END_HOUR * 60, mins)); }
function fmtFullDate(s) {
  if (!s) return '';
  return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function getInitials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0][0].toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
// HOVER POPOVER
// ═══════════════════════════════════════════════════════════════

function ApptPopover({ appt, rect, onEdit, onRescheduleRemaining, onMouseEnter, onMouseLeave }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null); // null = not positioned yet
  const [tasksExpanded, setTasksExpanded] = useState(false);

  useEffect(() => {
    if (!popRef.current || !rect) return;
    // Wait one frame for the popover to render so we can measure it
    requestAnimationFrame(() => {
      if (!popRef.current) return;
      const popW = 300;
      const popH = popRef.current.offsetHeight || 300;
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.right + pad;
      if (left + popW > vw - pad) left = rect.left - popW - pad;
      if (left < pad) left = pad;
      let top = rect.top;
      if (top + popH > vh - pad) top = vh - pad - popH;
      if (top < pad) top = pad;
      setPos({ top, left });
    });
  }, [rect, tasksExpanded]);

  const crew = appt.crew || [];
  const taskNames = appt.task_names || [];
  const status = STATUS_LABELS[appt.status] || STATUS_LABELS.scheduled;
  const leadCrew = crew.find(c => c.role === 'lead');
  const color = leadCrew?.color || appt.color || TYPE_COLORS[appt.type] || '#6b7280';
  const hasTasks = appt.tasks_total > 0;
  const pct = hasTasks ? Math.round((appt.tasks_done / appt.tasks_total) * 100) : 0;
  const hasIncomplete = hasTasks && appt.tasks_done < appt.tasks_total;
  const isDone = appt.status === 'completed';

  const visibleTasks = tasksExpanded ? taskNames : taskNames.slice(0, 5);
  const hiddenCount = taskNames.length - 5;

  return (
    <div ref={popRef} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed', top: pos ? pos.top : -9999, left: pos ? pos.left : -9999,
        width: 300, zIndex: 100,
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
        borderLeft: `4px solid ${color}`, overflow: 'hidden',
        opacity: pos ? 1 : 0, transition: 'opacity 80ms ease',
      }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{appt._jobName}</div>
          {appt._jobNumber && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>Job #{appt._jobNumber}</div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); onEdit(appt); }}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >Edit</button>
      </div>

      {/* Details */}
      <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>{fmtFullDate(appt.date)}</span>
        </div>
        {appt.time_start && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>{fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}</span>
          </div>
        )}
        {appt._address && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>{appt._address}</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: status.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: status.color }}>{status.label}</span>
          {appt.title && appt.title !== appt._jobName && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>· {appt.title}</span>
          )}
        </div>
      </div>

      {/* Crew */}
      {crew.length > 0 && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', marginBottom: 6 }}>Crew</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {crew.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 11, fontSize: 9, fontWeight: 700,
                  background: c.color || 'var(--bg-tertiary)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: c.role === 'lead' ? '2px solid var(--accent)' : '1px solid var(--border-color)',
                }}>{getInitials(c.full_name || c.display_name)}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{c.display_name || c.full_name}</span>
                {c.role === 'lead' && <span style={{ fontSize: 9, fontWeight: 700, color: '#92400e', background: '#fffbeb', padding: '0 4px', borderRadius: 3 }}>LEAD</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {hasTasks && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>Tasks</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: pct === 100 ? '#10b981' : 'var(--text-secondary)' }}>{appt.tasks_done}/{appt.tasks_total}</span>
          </div>
          <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#10b981' : color, borderRadius: 2 }} />
          </div>
          {visibleTasks.map((name, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, paddingLeft: 10, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 0, top: 4, width: 4, height: 4, borderRadius: 2, background: 'var(--text-tertiary)' }} />
              {name}
            </div>
          ))}
          {!tasksExpanded && hiddenCount > 0 && (
            <button onClick={e => { e.stopPropagation(); setTasksExpanded(true); }}
              style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', paddingLeft: 10, marginTop: 3, fontFamily: 'var(--font-sans)' }}
            >+{hiddenCount} more</button>
          )}
          {tasksExpanded && hiddenCount > 0 && (
            <button onClick={e => { e.stopPropagation(); setTasksExpanded(false); }}
              style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', paddingLeft: 10, marginTop: 3, fontFamily: 'var(--font-sans)' }}
            >Show less</button>
          )}
        </div>
      )}

      {/* Notes */}
      {appt.notes && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, fontStyle: 'italic',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>"{appt.notes}"</div>
        </div>
      )}

      {/* Reschedule remaining button */}
      {hasIncomplete && !isDone && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)' }}>
          <button onClick={e => { e.stopPropagation(); onRescheduleRemaining(appt); }}
            style={{
              width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600,
              color: 'var(--accent)', background: 'var(--accent-light)',
              border: '1px solid rgba(37,99,235,0.2)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#dbeafe'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-light)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Reschedule {appt.tasks_total - appt.tasks_done} remaining tasks
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════

// Detect touch device once — used to skip hover popovers and resize handles
const isTouchDevice = typeof window !== 'undefined' && (window.innerWidth <= 768 || navigator.maxTouchPoints > 0);

function CalendarView({ days, boardData, onApptClick, onCellClick, onApptDrop, onApptResize, placementMode, onPlacementClick, onCancelPlacement, onRescheduleRemaining }) {
  const isMobile = isTouchDevice;
  const timeColW = isMobile ? 36 : 52; // #1: narrower time column on mobile
  const [dragOver, setDragOver] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [hoveredAppt, setHoveredAppt] = useState(null);
  const [ghostPos, setGhostPos] = useState(null);
  const dayBodyRefs = useRef({});
  const wrapRef = useRef(null);
  const didResizeRef = useRef(false);
  const resizingRef = useRef(null);
  const hoverShowRef = useRef(null);
  const hoverHideRef = useRef(null);

  useEffect(() => {
    if (resizing || dragOver) {
      clearTimeout(hoverShowRef.current);
      clearTimeout(hoverHideRef.current);
      setHoveredAppt(null);
    }
  }, [resizing, dragOver]);

  // Clear ghost when placement mode ends
  useEffect(() => {
    if (!placementMode) setGhostPos(null);
  }, [placementMode]);

  // #8: Auto-scroll to current time on mount
  useEffect(() => {
    if (!wrapRef.current) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const topPx = ((mins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
    const scrollTo = Math.max(0, topPx - 80); // 80px above current time
    requestAnimationFrame(() => { if (wrapRef.current) wrapRef.current.scrollTop = scrollTo; });
  }, []); // mount only

  // Flatten appointments
  const allAppts = [];
  for (const job of boardData) {
    for (const appt of (job.appointments || [])) {
      allAppts.push({ ...appt, _jobName: job.insured_name, _jobId: job.job_id, _division: job.division, _address: job.address, _jobNumber: job.job_number });
    }
  }
  const byDate = {};
  for (const a of allAppts) { if (!byDate[a.date]) byDate[a.date] = []; byDate[a.date].push(a); }

  const hours = Array.from({ length: CAL_TOTAL_HOURS }, (_, i) => CAL_START_HOUR + i);

  // ── Hover handlers ──
  const scheduleShowHover = useCallback((appt, blockEl) => {
    if (placementMode || isMobile) return; // no popover during placement or on touch
    clearTimeout(hoverHideRef.current);
    clearTimeout(hoverShowRef.current);
    hoverShowRef.current = setTimeout(() => {
      if (resizingRef.current) return;
      setHoveredAppt({ appt, rect: blockEl.getBoundingClientRect() });
    }, HOVER_DELAY);
  }, [placementMode]);

  const scheduleCancelHover = useCallback(() => {
    clearTimeout(hoverShowRef.current);
    hoverHideRef.current = setTimeout(() => setHoveredAppt(null), HOVER_LINGER);
  }, []);
  const keepHoverAlive = useCallback(() => { clearTimeout(hoverHideRef.current); clearTimeout(hoverShowRef.current); }, []);
  const dismissHover = useCallback(() => { clearTimeout(hoverHideRef.current); clearTimeout(hoverShowRef.current); setHoveredAppt(null); }, []);

  // ── Drag move ──
  const handleDragStart = useCallback((e, appt) => {
    if (placementMode) { e.preventDefault(); return; }
    dismissHover();
    const startMins = timeToMinutes(appt.time_start);
    const endMins = appt.time_end ? timeToMinutes(appt.time_end) : startMins + 60;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ apptId: appt.id, duration: endMins - startMins, origDate: appt.date, origStart: appt.time_start, origEnd: appt.time_end }));
    if (e.currentTarget) e.dataTransfer.setDragImage(e.currentTarget, 40, 14);
    requestAnimationFrame(() => { if (e.currentTarget) e.currentTarget.style.opacity = '0.35'; });
  }, [dismissHover, placementMode]);

  const handleDragEnd = useCallback((e) => { e.currentTarget.style.opacity = ''; setDragOver(null); }, []);

  const getMinutesFromY = useCallback((dayKey, clientY) => {
    const bodyEl = dayBodyRefs.current[dayKey];
    if (!bodyEl) return null;
    const rect = bodyEl.getBoundingClientRect();
    return snapMinutes(CAL_START_HOUR * 60 + ((clientY - rect.top) / CAL_HOUR_HEIGHT) * 60);
  }, []);

  const handleDayDragOver = useCallback((e, dayKey) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const mins = getMinutesFromY(dayKey, e.clientY);
    if (mins !== null) setDragOver({ dayKey, minutes: clampMinutes(mins) });
  }, [getMinutesFromY]);

  const handleDayDragLeave = useCallback((e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }, []);

  const handleDayDrop = useCallback((e, dayKey) => {
    e.preventDefault(); setDragOver(null);
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!data?.apptId || !onApptDrop) return;
    const dropMins = getMinutesFromY(dayKey, e.clientY); if (dropMins === null) return;
    const newStart = clampMinutes(dropMins); const newEnd = clampMinutes(newStart + data.duration);
    const s = minutesToTime(newStart); const en = minutesToTime(newEnd);
    if (dayKey === data.origDate && s === data.origStart && en === data.origEnd) return;
    onApptDrop(data.apptId, dayKey, s, en);
  }, [onApptDrop, getMinutesFromY]);

  // ── Resize ──
  const handleResizeStart = useCallback((e, appt) => {
    e.preventDefault(); e.stopPropagation(); dismissHover();
    const startMins = timeToMinutes(appt.time_start);
    const endMins = appt.time_end ? timeToMinutes(appt.time_end) : startMins + 60;
    const state = { apptId: appt.id, dayKey: appt.date, startMins, endMins, origEnd: appt.time_end };
    setResizing(state); resizingRef.current = state; didResizeRef.current = false;
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'ns-resize';
  }, [dismissHover]);

  useEffect(() => {
    const onMouseMove = (e) => {
      const r = resizingRef.current; if (!r) return;
      const bodyEl = dayBodyRefs.current[r.dayKey]; if (!bodyEl) return;
      const rect = bodyEl.getBoundingClientRect();
      const rawMins = CAL_START_HOUR * 60 + ((e.clientY - rect.top) / CAL_HOUR_HEIGHT) * 60;
      const newEnd = Math.max(r.startMins + MIN_DURATION, clampMinutes(snapMinutes(rawMins)));
      didResizeRef.current = true;
      const next = { ...r, endMins: newEnd }; resizingRef.current = next; setResizing(next);
    };
    const onMouseUp = () => {
      const r = resizingRef.current; if (!r) return;
      document.body.style.userSelect = ''; document.body.style.cursor = '';
      const newEndStr = minutesToTime(r.endMins); const changed = newEndStr !== r.origEnd;
      resizingRef.current = null; setResizing(null);
      if (changed && onApptResize) onApptResize(r.apptId, newEndStr);
    };
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    return () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
  }, [onApptResize]);

  // ── Placement mode: ghost tracking ──
  const handlePlacementMouseMove = useCallback((e, dayKey) => {
    if (!placementMode) return;
    const mins = getMinutesFromY(dayKey, e.clientY);
    if (mins !== null) setGhostPos({ dayKey, minutes: clampMinutes(mins) });
  }, [placementMode, getMinutesFromY]);

  const handlePlacementClickInternal = useCallback((dayKey, hour) => {
    if (!placementMode || !onPlacementClick) return;
    const mins = ghostPos?.dayKey === dayKey ? ghostPos.minutes : hour * 60;
    const startMins = clampMinutes(mins);
    const endMins = clampMinutes(startMins + (placementMode.duration || 120));
    onPlacementClick(dayKey, minutesToTime(startMins), minutesToTime(endMins));
  }, [placementMode, onPlacementClick, ghostPos]);

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  const placementColor = placementMode
    ? (placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb')
    : '#2563eb';

  return (
    <div ref={wrapRef} style={CV.wrap}>
      {/* Placement mode banner */}
      {placementMode && (
        <div style={{
          padding: '8px 20px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: placementColor }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>
              Click on the calendar to place: {placementMode.jobName}
            </span>
            <span style={{ fontSize: 12, color: '#3b82f6' }}>
              · {placementMode.taskCount} tasks · {Math.round((placementMode.duration || 120) / 60)}h
            </span>
          </div>
          <button onClick={onCancelPlacement}
            style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', padding: '4px 12px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            Cancel
          </button>
        </div>
      )}

      <div style={{ ...CV.grid, minWidth: days.length * 120 + timeColW }}>
        {/* Time labels */}
        <div style={{ ...CV.timeCol, width: timeColW }}>
          <div style={CV.timeHeader} />
          {hours.map((h, i) => (
            <div key={h} style={CV.timeLabel}>
              <span style={{ position: 'absolute', right: 6, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500, top: i === 0 ? 4 : -7 }}>
                {h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map(day => {
          const appts = byDate[day.key] || [];
          const isDropTarget = dragOver?.dayKey === day.key;
          const dropTopPx = isDropTarget ? ((dragOver.minutes - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT : null;
          const showGhost = placementMode && ghostPos?.dayKey === day.key;
          const ghostTopPx = showGhost ? ((ghostPos.minutes - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT : null;
          const ghostHeight = showGhost ? ((placementMode.duration || 120) / 60) * CAL_HOUR_HEIGHT : 0;

          return (
            <div key={day.key} style={CV.dayCol}>
              <div style={{ ...CV.dayHeader, ...(day.isToday ? { background: '#f0f7ff' } : {}) }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: day.isToday ? '#2563eb' : 'var(--text-secondary)' }}>{day.label}</div>
                <div style={{ fontSize: 11, color: day.isToday ? '#2563eb' : 'var(--text-tertiary)', fontWeight: day.isToday ? 600 : 400 }}>{day.shortDate}</div>
              </div>

              <div
                ref={el => { dayBodyRefs.current[day.key] = el; }}
                style={{
                  ...CV.dayBody,
                  ...(isDropTarget ? { background: 'rgba(37, 99, 235, 0.03)' } : {}),
                  ...(placementMode ? { cursor: 'copy' } : {}),
                }}
                onDragOver={e => handleDayDragOver(e, day.key)}
                onDragLeave={handleDayDragLeave}
                onDrop={e => handleDayDrop(e, day.key)}
                onMouseMove={placementMode ? (e => handlePlacementMouseMove(e, day.key)) : undefined}
              >
                {/* Hour lines */}
                {hours.map(h => (
                  <div key={h} style={{ ...CV.hourLine, top: (h - CAL_START_HOUR) * CAL_HOUR_HEIGHT }}
                    onClick={() => placementMode ? handlePlacementClickInternal(day.key, h) : onCellClick(day.key, h)}
                    onMouseEnter={e => !placementMode && e.currentTarget.querySelector('.plus')?.style && (e.currentTarget.querySelector('.plus').style.opacity = '1')}
                    onMouseLeave={e => !placementMode && e.currentTarget.querySelector('.plus')?.style && (e.currentTarget.querySelector('.plus').style.opacity = '0')}>
                    {!placementMode && (
                      <div className="plus" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0, transition: 'opacity 100ms', pointerEvents: 'none' }}>
                        <span style={{ fontSize: 18, color: 'var(--accent)', fontWeight: 300 }}>+</span>
                      </div>
                    )}
                  </div>
                ))}

                {/* Drop indicator (move) */}
                {isDropTarget && dropTopPx !== null && (
                  <div style={{ position: 'absolute', top: dropTopPx, left: 0, right: 0, height: 2, background: '#2563eb', zIndex: 10, pointerEvents: 'none', boxShadow: '0 0 6px rgba(37,99,235,0.4)' }}>
                    <div style={{ position: 'absolute', left: -1, top: -4, width: 10, height: 10, borderRadius: 5, background: '#2563eb' }} />
                    <div style={{ position: 'absolute', right: 4, top: -8, fontSize: 9, fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '0 4px', borderRadius: 3, lineHeight: '16px', whiteSpace: 'nowrap' }}>
                      {fmtTime(minutesToTime(dragOver.minutes))}
                    </div>
                  </div>
                )}

                {/* Placement ghost block */}
                {showGhost && ghostTopPx !== null && (
                  <div style={{
                    position: 'absolute', top: ghostTopPx, left: 2, right: 2, height: Math.max(ghostHeight - 2, 26),
                    background: placementColor, borderLeft: `3px solid ${placementColor}`, borderRadius: 4,
                    opacity: 0.45, zIndex: 6, pointerEvents: 'none', padding: '4px 6px',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {placementMode.jobName}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                      {fmtTime(minutesToTime(ghostPos.minutes))} – {fmtTime(minutesToTime(ghostPos.minutes + (placementMode.duration || 120)))}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>
                      {placementMode.taskCount} tasks
                    </div>
                  </div>
                )}

                {/* Now line */}
                {day.isToday && (() => {
                  const now = new Date(); const mins = now.getHours() * 60 + now.getMinutes();
                  const top = ((mins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
                  if (top < 0 || top > CAL_TOTAL_HOURS * CAL_HOUR_HEIGHT) return null;
                  return (
                    <div style={{ position: 'absolute', top, left: 0, right: 0, height: 2, background: '#ef4444', zIndex: 5, pointerEvents: 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: '#ef4444', position: 'absolute', left: -4, top: -3 }} />
                    </div>
                  );
                })()}

                {/* Appointment blocks */}
                {(() => {
                  const sorted = [...appts].map(appt => {
                    const startMins = timeToMinutes(appt.time_start);
                    let endMins = appt.time_end ? timeToMinutes(appt.time_end) : startMins + 60;
                    if (resizing && resizing.apptId === appt.id) endMins = resizing.endMins;
                    return { ...appt, _startMins: startMins, _endMins: endMins };
                  }).sort((a, b) => a._startMins - b._startMins || a._endMins - b._endMins);

                  const columns = [];
                  const layout = sorted.map(appt => {
                    let col = columns.findIndex(endMin => endMin <= appt._startMins);
                    if (col === -1) { col = columns.length; columns.push(0); }
                    columns[col] = appt._endMins; return { ...appt, _col: col };
                  });
                  const withTotal = layout.map(appt => {
                    const ov = layout.filter(o => o._startMins < appt._endMins && o._endMins > appt._startMins);
                    return { ...appt, _totalCols: Math.max(...ov.map(o => o._col)) + 1 };
                  });

                  return withTotal.map(appt => {
                    const isBeingResized = resizing && resizing.apptId === appt.id;
                    const top = ((appt._startMins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
                    const height = Math.max(((appt._endMins - appt._startMins) / 60) * CAL_HOUR_HEIGHT, 28);
                    const crew = appt.crew || [];
                    const leadCrew = crew.find(c => c.role === 'lead');
                    const color = leadCrew?.color || appt.color || TYPE_COLORS[appt.type] || '#6b7280';
                    const isDone = appt.status === 'completed';
                    const canInteract = !isDone && !placementMode;
                    const shortAddr = appt._address ? appt._address.split(',')[0] : '';
                    const colWidth = 100 / appt._totalCols; const leftPct = appt._col * colWidth;

                    return (
                      <div key={appt.id}
                        draggable={canInteract && !isBeingResized}
                        onDragStart={e => handleDragStart(e, appt)} onDragEnd={handleDragEnd}
                        onClick={e => {
                          e.stopPropagation();
                          if (placementMode) return;
                          if (didResizeRef.current) { didResizeRef.current = false; return; }
                          dismissHover(); onApptClick(appt);
                        }}
                        style={{
                          position: 'absolute', top, height: Math.max(height - 2, 26),
                          left: `calc(${leftPct}% + 1px)`, width: `calc(${colWidth}% - 2px)`,
                          background: color, borderLeft: `3px solid ${color}`, borderRadius: 4,
                          padding: '4px 6px', overflow: 'visible',
                          cursor: placementMode ? 'copy' : isDone ? 'pointer' : 'grab',
                          zIndex: isBeingResized ? 8 : 2, opacity: isDone ? 0.5 : placementMode ? 0.7 : 1,
                          transition: isBeingResized ? 'none' : 'box-shadow 120ms ease',
                          boxShadow: isBeingResized ? '0 4px 16px rgba(0,0,0,0.25)' : 'none',
                        }}
                        onMouseEnter={e => {
                          if (!isBeingResized && !placementMode) {
                            e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
                            const h = e.currentTarget.querySelector('[data-resize]'); if (h) h.style.opacity = '1';
                            scheduleShowHover(appt, e.currentTarget);
                          }
                        }}
                        onMouseLeave={e => {
                          if (!isBeingResized && !placementMode) {
                            e.currentTarget.style.filter = 'none'; e.currentTarget.style.boxShadow = 'none';
                            const h = e.currentTarget.querySelector('[data-resize]'); if (h) h.style.opacity = '0';
                            scheduleCancelHover();
                          }
                        }}
                      >
                        <div style={{ overflow: 'hidden', height: '100%' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{appt._jobName}</div>
                          {crew.length > 0 && (
                            <div style={{ display: 'flex', gap: 2, marginBottom: 3, flexWrap: 'wrap' }}>
                              {crew.slice(0, 4).map(c => (
                                <span key={c.id} title={c.display_name || c.full_name} style={{
                                  width: 20, height: 20, borderRadius: 10, fontSize: 8, fontWeight: 700,
                                  background: c.color || 'rgba(255,255,255,0.3)', color: '#fff',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  border: c.role === 'lead' ? '2px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.3)',
                                }}>{getInitials(c.full_name || c.display_name)}</span>
                              ))}
                              {crew.length > 4 && <span style={{ fontSize: 8, fontWeight: 600, color: 'rgba(255,255,255,0.7)', alignSelf: 'center' }}>+{crew.length - 4}</span>}
                            </div>
                          )}
                          {appt.time_start && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', lineHeight: 1.3 }}>
                              🕐 {fmtTime(appt.time_start)}{appt.time_end || isBeingResized ? `-${fmtTime(isBeingResized ? minutesToTime(resizing.endMins) : appt.time_end)}` : ''}
                            </div>
                          )}
                          {height > 60 && shortAddr && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortAddr}</div>}
                          {height > 80 && appt._jobNumber && !isMobile && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', lineHeight: 1.3 }}>Job #{appt._jobNumber}</div>}
                          {height > 100 && appt.tasks_total > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.25)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.round((appt.tasks_done / appt.tasks_total) * 100)}%`, height: '100%', background: 'rgba(255,255,255,0.8)', borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>{appt.tasks_done}/{appt.tasks_total}</span>
                            </div>
                          )}
                          {height > 120 && (appt.task_names || []).length > 0 && (
                            <div style={{ marginTop: 3 }}>
                              {(appt.task_names || []).slice(0, Math.floor((height - 120) / 14)).map((name, i) => (
                                <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 8, position: 'relative' }}>
                                  <span style={{ position: 'absolute', left: 0, top: 1, fontSize: 7 }}>•</span>{name}
                                </div>
                              ))}
                              {(appt.task_names || []).length > Math.floor((height - 120) / 14) && (
                                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', paddingLeft: 8, marginTop: 1 }}>+{(appt.task_names || []).length - Math.floor((height - 120) / 14)} more</div>
                              )}
                            </div>
                          )}
                          {height > 120 && (appt.task_names || []).length === 0 && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 2, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{appt.title}</div>
                          )}
                        </div>

                        {canInteract && !placementMode && !isMobile && (
                          <div data-resize onMouseDown={e => handleResizeStart(e, appt)}
                            style={{
                              position: 'absolute', bottom: 0, left: 0, right: 0, height: RESIZE_HANDLE_HEIGHT,
                              cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center',
                              opacity: isBeingResized ? 1 : 0, transition: 'opacity 100ms',
                              borderRadius: '0 0 4px 4px', background: 'linear-gradient(transparent, rgba(0,0,0,0.15))',
                            }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
                              <div style={{ width: 16, height: 1.5, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
                              <div style={{ width: 12, height: 1.5, borderRadius: 1, background: 'rgba(255,255,255,0.5)' }} />
                            </div>
                          </div>
                        )}
                        {isBeingResized && (
                          <div style={{
                            position: 'absolute', bottom: -20, left: '50%', transform: 'translateX(-50%)',
                            fontSize: 10, fontWeight: 700, color: '#2563eb', background: '#eff6ff',
                            padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.15)', zIndex: 20, lineHeight: '16px', border: '1px solid #bfdbfe',
                          }}>{fmtTime(minutesToTime(resizing.endMins))}</div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hover popover */}
      {hoveredAppt && !placementMode && (
        <ApptPopover
          appt={hoveredAppt.appt} rect={hoveredAppt.rect}
          onEdit={a => { dismissHover(); onApptClick(a); }}
          onRescheduleRemaining={a => { dismissHover(); onRescheduleRemaining?.(a); }}
          onMouseEnter={keepHoverAlive} onMouseLeave={dismissHover}
        />
      )}
    </div>
  );
}

const CV = {
  wrap: { flex: 1, overflow: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' },
  grid: { display: 'flex', minWidth: 600, flex: 1 },
  timeCol: { width: 52, flexShrink: 0, borderRight: '1px solid var(--border-color)' },
  timeHeader: { height: 44, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' },
  timeLabel: { height: CAL_HOUR_HEIGHT, position: 'relative' },
  dayCol: { flex: 1, minWidth: 120, borderRight: '1px solid var(--border-light)' },
  dayHeader: { height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', flexShrink: 0 },
  dayBody: { position: 'relative', height: CAL_TOTAL_HOURS * CAL_HOUR_HEIGHT },
  hourLine: { position: 'absolute', left: 0, right: 0, height: CAL_HOUR_HEIGHT, borderBottom: '1px solid var(--border-light)', cursor: 'pointer' },
};

export default CalendarView;
