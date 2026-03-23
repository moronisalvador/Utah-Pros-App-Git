import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_COLORS, TYPE_COLORS, STATUS_LABELS, WEEKDAYS_FULL, fmtDate, fmtShort, fmtTime, getMonday } from '@/lib/scheduleUtils';
import JobPanel from '@/components/JobPanel';
import CreateAppointmentModal from '@/components/CreateAppointmentModal';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
import EditAppointmentModal from '@/components/EditAppointmentModal';
import CalendarView from '@/components/CalendarView';

const SPAN_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: '3day', label: '3 Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const HOVER_DELAY = 350;
const HOVER_LINGER = 200;

const MITIGATION_DIVISIONS = ['water', 'mold', 'fire', 'contents'];
const DIV_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'mitigation', label: 'Mitigation', emoji: '💧' },
  { key: 'reconstruction', label: 'Recon', emoji: '🏗️' },
];

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
// GRID POPOVER (shared by Jobs + Crew views)
// ═══════════════════════════════════════════════════════════════

function GridPopover({ appt, rect, onEdit, onRescheduleRemaining, onMouseEnter, onMouseLeave }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [tasksExpanded, setTasksExpanded] = useState(false);

  useEffect(() => {
    if (!popRef.current || !rect) return;
    requestAnimationFrame(() => {
      if (!popRef.current) return;
      const popW = 300; const popH = popRef.current.offsetHeight || 300;
      const pad = 8; const vw = window.innerWidth; const vh = window.innerHeight;
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
  const visibleTasks = tasksExpanded ? taskNames : taskNames.slice(0, 5);
  const hiddenCount = taskNames.length - 5;

  return (
    <div ref={popRef} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed', top: pos ? pos.top : -9999, left: pos ? pos.left : -9999,
        width: 300, zIndex: 100, background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
        borderLeft: `4px solid ${color}`, overflow: 'hidden',
        opacity: pos ? 1 : 0, transition: 'opacity 80ms ease',
      }}>
      <div style={{ padding: '10px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{appt._jobName || 'Job'}</div>
          {appt._jobNumber && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>Job #{appt._jobNumber}</div>}
        </div>
        <button onClick={e => { e.stopPropagation(); onEdit(appt); }}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Edit</button>
      </div>
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
          <span style={{ width: 7, height: 7, borderRadius: 4, background: status.color }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: status.color }}>{status.label}</span>
          {appt.title && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>· {appt.title}</span>}
        </div>
      </div>
      {crew.length > 0 && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', marginBottom: 6 }}>Crew</div>
          {crew.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 22, height: 22, borderRadius: 11, fontSize: 9, fontWeight: 700, background: c.color || 'var(--bg-tertiary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: c.role === 'lead' ? '2px solid var(--accent)' : '1px solid var(--border-color)' }}>{getInitials(c.full_name || c.display_name)}</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{c.display_name || c.full_name}</span>
              {c.role === 'lead' && <span style={{ fontSize: 9, fontWeight: 700, color: '#92400e', background: '#fffbeb', padding: '0 4px', borderRadius: 3 }}>LEAD</span>}
            </div>
          ))}
        </div>
      )}
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
              <span style={{ position: 'absolute', left: 0, top: 4, width: 4, height: 4, borderRadius: 2, background: 'var(--text-tertiary)' }} />{name}
            </div>
          ))}
          {!tasksExpanded && hiddenCount > 0 && <button onClick={e => { e.stopPropagation(); setTasksExpanded(true); }} style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', paddingLeft: 10, marginTop: 3, fontFamily: 'var(--font-sans)' }}>+{hiddenCount} more</button>}
          {tasksExpanded && hiddenCount > 0 && <button onClick={e => { e.stopPropagation(); setTasksExpanded(false); }} style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', paddingLeft: 10, marginTop: 3, fontFamily: 'var(--font-sans)' }}>Show less</button>}
        </div>
      )}
      {appt.notes && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>"{appt.notes}"</div>
        </div>
      )}
      {hasTasks && appt.tasks_done < appt.tasks_total && appt.status !== 'completed' && (
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
// ENHANCED APPOINTMENT CARD (Jobs view — draggable, colored, hoverable)
// ═══════════════════════════════════════════════════════════════

function hexToTint(hex, opacity = 0.08) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function ApptCard({ appt, onClick, onDragStart, onHoverEnter, onHoverLeave }) {
  const crew = appt.crew || [];
  const leadCrew = crew.find(c => c.role === 'lead');
  const color = leadCrew?.color || appt.color || TYPE_COLORS[appt.type] || '#6b7280';
  const status = STATUS_LABELS[appt.status] || STATUS_LABELS.scheduled;
  const isActive = ['en_route', 'in_progress'].includes(appt.status);
  const isDone = appt.status === 'completed';
  const hasTasks = appt.tasks_total > 0;
  const taskNames = appt.task_names || [];
  const bgTint = isDone ? 'var(--bg-tertiary)' : hexToTint(color, 0.07);

  return (
    <div
      draggable={!isDone}
      onDragStart={e => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ apptId: appt.id, origDate: appt.date, time_start: appt.time_start, time_end: appt.time_end }));
        requestAnimationFrame(() => { e.target.style.opacity = '0.35'; });
        if (onDragStart) onDragStart();
      }}
      onDragEnd={e => { e.target.style.opacity = ''; }}
      onClick={e => { e.stopPropagation(); onClick?.(appt); }}
      onMouseEnter={e => onHoverEnter?.(appt, e.currentTarget)}
      onMouseLeave={() => onHoverLeave?.()}
      style={{
        borderLeft: `3px solid ${color}`, borderRadius: 4,
        background: bgTint, padding: '6px 8px', marginBottom: 4,
        cursor: isDone ? 'pointer' : 'grab', opacity: isDone ? 0.6 : 1,
        transition: 'box-shadow 120ms ease',
      }}
      onMouseOver={e => { if (!isDone) e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
      onMouseOut={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Title + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
        {isActive && <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color, flexShrink: 0 }} />}
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appt.title}</div>
      </div>

      {/* Time */}
      {appt.time_start && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
          {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
        </div>
      )}

      {/* Crew circles */}
      {crew.length > 0 && (
        <div style={{ display: 'flex', gap: 3, marginBottom: hasTasks || taskNames.length > 0 ? 5 : 0, alignItems: 'center' }}>
          {crew.slice(0, 5).map(c => (
            <span key={c.id} title={c.display_name || c.full_name} style={{
              width: 20, height: 20, borderRadius: 10, fontSize: 8, fontWeight: 700,
              background: c.color || 'var(--bg-tertiary)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: c.role === 'lead' ? `2px solid ${c.color || 'var(--accent)'}` : '1px solid rgba(0,0,0,0.1)',
            }}>{getInitials(c.full_name || c.display_name)}</span>
          ))}
          {crew.length > 5 && <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>+{crew.length - 5}</span>}
        </div>
      )}

      {/* Task progress bar */}
      {hasTasks && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: taskNames.length > 0 ? 4 : 0 }}>
          <div style={{ flex: 1, height: 3, background: isDone ? 'rgba(0,0,0,0.06)' : hexToTint(color, 0.15), borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((appt.tasks_done / appt.tasks_total) * 100)}%`, height: '100%', background: appt.tasks_done === appt.tasks_total ? '#10b981' : color, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{appt.tasks_done}/{appt.tasks_total}</span>
        </div>
      )}

      {/* Task name previews (max 2) */}
      {taskNames.length > 0 && (
        <div>
          {taskNames.slice(0, 2).map((name, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.4, paddingLeft: 8, position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ position: 'absolute', left: 0, top: 3, width: 3, height: 3, borderRadius: 2, background: 'var(--text-tertiary)' }} />{name}
            </div>
          ))}
          {taskNames.length > 2 && <div style={{ fontSize: 9, color: 'var(--text-tertiary)', paddingLeft: 8, opacity: 0.7 }}>+{taskNames.length - 2} more</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENHANCED CREW CARD (Crew view — draggable, colored, hoverable)
// ═══════════════════════════════════════════════════════════════

function CrewApptCard({ appt, onClick, onDragStart, onHoverEnter, onHoverLeave }) {
  const dc = DIV_COLORS[appt._division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
  const crew = appt.crew || [];
  const leadCrew = crew.find(c => c.role === 'lead');
  const color = leadCrew?.color || appt.color || TYPE_COLORS[appt.type] || '#6b7280';
  const isDone = appt.status === 'completed';
  const isActive = ['en_route', 'in_progress'].includes(appt.status);
  const status = STATUS_LABELS[appt.status] || STATUS_LABELS.scheduled;
  const hasTasks = appt.tasks_total > 0;
  const taskNames = appt.task_names || [];
  const bgTint = isDone ? 'var(--bg-tertiary)' : hexToTint(color, 0.07);

  return (
    <div
      draggable={!isDone}
      onDragStart={e => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ apptId: appt.id, origDate: appt.date, time_start: appt.time_start, time_end: appt.time_end }));
        requestAnimationFrame(() => { e.target.style.opacity = '0.35'; });
        if (onDragStart) onDragStart();
      }}
      onDragEnd={e => { e.target.style.opacity = ''; }}
      onClick={e => { e.stopPropagation(); onClick?.(appt); }}
      onMouseEnter={e => onHoverEnter?.(appt, e.currentTarget)}
      onMouseLeave={() => onHoverLeave?.()}
      style={{
        borderLeft: `3px solid ${color}`, borderRadius: 4,
        background: bgTint, padding: '6px 8px', marginBottom: 4,
        cursor: isDone ? 'pointer' : 'grab', opacity: isDone ? 0.6 : 1,
        transition: 'box-shadow 120ms ease',
      }}
      onMouseOver={e => { if (!isDone) e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
      onMouseOut={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Job name badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: dc.bg, color: dc.text }}>{appt._jobName}</span>
        {isActive && <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color, flexShrink: 0 }} />}
      </div>

      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appt.title}</div>

      {/* Time */}
      {appt.time_start && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
          {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
        </div>
      )}

      {/* Task progress bar */}
      {hasTasks && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: taskNames.length > 0 ? 4 : 0 }}>
          <div style={{ flex: 1, height: 3, background: isDone ? 'rgba(0,0,0,0.06)' : hexToTint(color, 0.15), borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((appt.tasks_done / appt.tasks_total) * 100)}%`, height: '100%', background: appt.tasks_done === appt.tasks_total ? '#10b981' : color, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{appt.tasks_done}/{appt.tasks_total}</span>
        </div>
      )}

      {/* Task name previews */}
      {taskNames.length > 0 && (
        <div>
          {taskNames.slice(0, 2).map((name, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.4, paddingLeft: 8, position: 'relative', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ position: 'absolute', left: 0, top: 3, width: 3, height: 3, borderRadius: 2, background: 'var(--text-tertiary)' }} />{name}
            </div>
          ))}
          {taskNames.length > 2 && <div style={{ fontSize: 9, color: 'var(--text-tertiary)', paddingLeft: 8, opacity: 0.7 }}>+{taskNames.length - 2} more</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MONTH VIEW
// ═══════════════════════════════════════════════════════════════

function MonthView({ anchor, boardData, onApptClick, onDayClick, showWeekend }) {
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const todayKey = fmtDate(new Date());
  const hdrs = showWeekend ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] : ['Mon','Tue','Wed','Thu','Fri'];
  const cols = hdrs.length;
  const byDate = {};
  for (const job of boardData) for (const appt of (job.appointments || [])) {
    if (!byDate[appt.date]) byDate[appt.date] = [];
    const lc = (appt.crew || []).find(c => c.role === 'lead');
    byDate[appt.date].push({ ...appt, _jobName: job.insured_name, _color: lc?.color || appt.color || TYPE_COLORS[appt.type] || '#6b7280' });
  }
  const weeks = []; let day = 1 - startDow;
  for (let w = 0; w < 6; w++) { const wk = []; for (let d = 0; d < 7; d++) { const dt = new Date(year, month, day); wk.push({ day, date: dt, inMonth: day >= 1 && day <= daysInMonth, key: fmtDate(dt) }); day++; } weeks.push(wk); }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 0 8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, borderBottom: '1px solid var(--border-color)' }}>
        {hdrs.map(d => <div key={d} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textAlign: 'center', padding: '8px 0', background: 'var(--bg-secondary)' }}>{d}</div>)}
      </div>
      {weeks.map((wk, wi) => {
        const f = showWeekend ? wk : wk.filter(c => { const dow = c.date.getDay(); return dow !== 0 && dow !== 6; });
        return (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, minHeight: 90 }}>
            {f.map((cell, di) => {
              const appts = byDate[cell.key] || []; const isToday = cell.key === todayKey;
              return (
                <div key={di} onClick={() => cell.inMonth && onDayClick(cell.key)}
                  style={{ borderBottom: '1px solid var(--border-light)', borderRight: di < f.length - 1 ? '1px solid var(--border-light)' : 'none', padding: '4px 5px', cursor: cell.inMonth ? 'pointer' : 'default', background: isToday ? '#f8fbff' : 'transparent', opacity: cell.inMonth ? 1 : 0.35, minHeight: 90 }}
                  onMouseEnter={e => { if (cell.inMonth) e.currentTarget.style.background = isToday ? '#f0f7ff' : 'var(--bg-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isToday ? '#f8fbff' : 'transparent'; }}>
                  <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#fff' : cell.inMonth ? 'var(--text-primary)' : 'var(--text-tertiary)', width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto', borderRadius: 11, background: isToday ? 'var(--accent)' : 'transparent', display: isToday ? 'flex' : 'block', alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}>{cell.date.getDate()}</div>
                  {appts.slice(0, 3).map(a => <div key={a.id} onClick={e => { e.stopPropagation(); onApptClick(a); }} style={{ fontSize: 10, fontWeight: 500, lineHeight: 1.2, padding: '2px 4px', marginBottom: 2, borderRadius: 3, background: a._color, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.15)'} onMouseLeave={e => e.currentTarget.style.filter = 'none'}>{a.time_start ? fmtTime(a.time_start) + ' ' : ''}{a._jobName}</div>)}
                  {appts.length > 3 && <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 500, paddingLeft: 4 }}>+{appts.length - 3} more</div>}
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

  const [anchor, setAnchor] = useState(() => new Date());
  const [boardData, setBoardData] = useState([]);
  const [panelJobs, setPanelJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState(true);
  const [showWeekend, setShowWeekend] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('upr_schedule_view') || 'calendar'; } catch { return 'calendar'; } });
  const changeViewMode = (mode) => {
    setViewMode(mode);
    try { localStorage.setItem('upr_schedule_view', mode); } catch {}
    // Month only available in calendar view
    if (mode !== 'calendar' && calSpan === 'month') changeCalSpan('week');
  };
  const [calSpan, setCalSpan] = useState(() => {
    // Always default to Day view on mobile — week/3day are unreadable on a phone
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return 'day';
    try { return localStorage.getItem('upr_schedule_span') || 'week'; } catch { return 'week'; }
  });
  const changeCalSpan = (span) => { setCalSpan(span); try { localStorage.setItem('upr_schedule_span', span); } catch {} };
  const [crewFilter, setCrewFilter] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [selectedPanelJob, setSelectedPanelJob] = useState(null);
  const [allEmployees, setAllEmployees] = useState([]);
  const [autoShow, setAutoShow] = useState(true);
  const [showExtraControls, setShowExtraControls] = useState(false); // mobile ⚙ toggle
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);
  const [placementMode, setPlacementMode] = useState(null);
  const [divFilter, setDivFilter] = useState(() => employee?.default_division || 'all');

  // ── Grid hover popover state ──
  const [gridHover, setGridHover] = useState(null); // { appt, rect }
  const gridHoverShowRef = useRef(null);
  const gridHoverHideRef = useRef(null);

  const scheduleGridHover = useCallback((appt, el) => {
    clearTimeout(gridHoverHideRef.current);
    clearTimeout(gridHoverShowRef.current);
    gridHoverShowRef.current = setTimeout(() => {
      setGridHover({ appt, rect: el.getBoundingClientRect() });
    }, HOVER_DELAY);
  }, []);
  const cancelGridHover = useCallback(() => {
    clearTimeout(gridHoverShowRef.current);
    gridHoverHideRef.current = setTimeout(() => setGridHover(null), HOVER_LINGER);
  }, []);
  const keepGridHover = useCallback(() => { clearTimeout(gridHoverHideRef.current); clearTimeout(gridHoverShowRef.current); }, []);
  const dismissGridHover = useCallback(() => { clearTimeout(gridHoverHideRef.current); clearTimeout(gridHoverShowRef.current); setGridHover(null); }, []);

  // ── Placement: Escape to cancel ──
  useEffect(() => { if (!placementMode) { setGridPlacementPicker(null); return; } const h = e => { if (e.key === 'Escape') { setPlacementMode(null); setGridPlacementPicker(null); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [placementMode]);

  // ── Days ──
  const days = useMemo(() => {
    const todayStr = fmtDate(new Date());
    if (calSpan === 'day') { const d = new Date(anchor); const k = fmtDate(d); return [{ date: d, key: k, label: WEEKDAYS_FULL[d.getDay()], shortDate: fmtShort(d), isToday: k === todayStr }]; }
    if (calSpan === '3day') { const r = []; const c = new Date(anchor); while (r.length < 3) { const dow = c.getDay(); if (showWeekend || (dow !== 0 && dow !== 6)) { const k = fmtDate(c); r.push({ date: new Date(c), key: k, label: WEEKDAYS_FULL[dow], shortDate: fmtShort(c), isToday: k === todayStr }); } c.setDate(c.getDate() + 1); } return r; }
    if (calSpan === 'month') { const y = anchor.getFullYear(), m = anchor.getMonth(); const first = new Date(y, m, 1); const last = new Date(y, m + 1, 0); const s = new Date(first); s.setDate(1 - first.getDay()); const e = new Date(last); e.setDate(last.getDate() + (6 - last.getDay())); const r = []; const c = new Date(s); while (c <= e) { const k = fmtDate(c); r.push({ date: new Date(c), key: k, label: WEEKDAYS_FULL[c.getDay()], shortDate: fmtShort(c), isToday: k === todayStr }); c.setDate(c.getDate() + 1); } return r; }
    const monday = getMonday(anchor); const count = showWeekend ? 7 : 5; const start = showWeekend ? new Date(monday.getTime() - 86400000) : monday;
    return Array.from({ length: count }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const k = fmtDate(d); return { date: d, key: k, label: WEEKDAYS_FULL[d.getDay()], shortDate: fmtShort(d), isToday: k === todayStr }; });
  }, [anchor, calSpan, showWeekend]);

  // ── Nav ──
  const goToday = () => setAnchor(new Date());
  const goPrev = () => setAnchor(d => { const n = new Date(d); if (calSpan === 'day') n.setDate(n.getDate() - 1); else if (calSpan === '3day') n.setDate(n.getDate() - 3); else if (calSpan === 'month') n.setMonth(n.getMonth() - 1); else n.setDate(n.getDate() - 7); return n; });
  const goNext = () => setAnchor(d => { const n = new Date(d); if (calSpan === 'day') n.setDate(n.getDate() + 1); else if (calSpan === '3day') n.setDate(n.getDate() + 3); else if (calSpan === 'month') n.setMonth(n.getMonth() + 1); else n.setDate(n.getDate() + 7); return n; });
  const todayLabel = calSpan === 'month' ? 'This month' : calSpan === 'week' ? 'This week' : 'Today';
  const subtitleText = useMemo(() => { if (calSpan === 'month') return `${MONTHS_FULL[anchor.getMonth()]} ${anchor.getFullYear()}`; if (calSpan === 'day') return days[0]?.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) || ''; return `${fmtShort(days[0]?.date)} – ${fmtShort(days[days.length - 1]?.date)}`; }, [days, calSpan, anchor]);

  // ── Load ──
  const loadPanelJobs = useCallback(async () => { setPanelLoading(true); try { const r = await db.rpc('get_dispatch_panel_jobs'); setPanelJobs(Array.isArray(r) ? r : []); } catch (e) { console.error('Panel:', e); } finally { setPanelLoading(false); } }, [db]);
  const loadBoard = useCallback(async () => { setLoading(true); try { const r = await db.rpc('get_dispatch_board', { p_start_date: days[0].key, p_end_date: days[days.length - 1].key, p_auto_show: autoShow }); setBoardData(Array.isArray(r) ? r : []); } catch (e) { console.error('Board:', e); } finally { setLoading(false); } }, [db, days, autoShow]);
  const silentReloadBoard = useCallback(async () => { try { const r = await db.rpc('get_dispatch_board', { p_start_date: days[0].key, p_end_date: days[days.length - 1].key, p_auto_show: autoShow }); setBoardData(Array.isArray(r) ? r : []); } catch (e) { console.error('Silent:', e); } }, [db, days, autoShow]);

  useEffect(() => { loadPanelJobs(); }, [loadPanelJobs]);
  useEffect(() => { loadBoard(); }, [loadBoard]);
  useEffect(() => { db.select('employees', 'is_active=eq.true&order=display_name.asc&select=id,display_name,full_name,role,color,avatar_url').then(setAllEmployees).catch(() => {}); }, [db]);

  const toggleJob = async (jobId, addToBoard) => { try { if (addToBoard) await db.insert('dispatch_board_jobs', { job_id: jobId, added_by: employee?.id }); else await db.delete('dispatch_board_jobs', `job_id=eq.${jobId}`); setPanelJobs(prev => prev.map(j => j.id === jobId ? { ...j, on_board: addToBoard } : j)); loadBoard(); } catch (e) { console.error('Toggle:', e); } };

  // ── Division filter ──
  const divFilteredBoardData = useMemo(() => {
    if (divFilter === 'all' || !divFilter) return boardData;
    if (divFilter === 'mitigation') return boardData.filter(j => MITIGATION_DIVISIONS.includes(j.division));
    if (divFilter === 'reconstruction') return boardData.filter(j => j.division === 'reconstruction');
    return boardData;
  }, [boardData, divFilter]);

  // ── Cell lookups (enriched with job metadata) ──
  const cellMap = useMemo(() => {
    const m = {};
    for (const job of divFilteredBoardData) for (const appt of (job.appointments || [])) {
      const k = `${job.job_id}_${appt.date}`; if (!m[k]) m[k] = [];
      m[k].push({ ...appt, _jobName: job.insured_name, _jobNumber: job.job_number, _address: job.address, _division: job.division, _jobId: job.job_id });
    }
    return m;
  }, [divFilteredBoardData]);

  const { crewList, crewCellMap } = useMemo(() => {
    const empMap = {}, cells = {};
    for (const job of divFilteredBoardData) for (const appt of (job.appointments || [])) for (const crew of (appt.crew || [])) {
      if (!empMap[crew.employee_id]) empMap[crew.employee_id] = { id: crew.employee_id, display_name: crew.display_name, full_name: crew.full_name, role: crew.role };
      const k = `${crew.employee_id}_${appt.date}`; if (!cells[k]) cells[k] = [];
      cells[k].push({ ...appt, _jobName: job.insured_name, _jobNumber: job.job_number, _division: job.division, _jobId: job.job_id, _address: job.address });
    }
    return { crewList: Object.values(empMap).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')), crewCellMap: cells };
  }, [divFilteredBoardData]);

  const filteredCellMap = useMemo(() => { if (!crewFilter) return cellMap; const m = {}; for (const [key, appts] of Object.entries(cellMap)) { const f = appts.filter(a => a.crew?.some(c => c.employee_id === crewFilter)); if (f.length > 0) m[key] = f; } return m; }, [cellMap, crewFilter]);
  const filteredBoardData = useMemo(() => crewFilter ? divFilteredBoardData.filter(j => j.appointments?.some(a => a.crew?.some(c => c.employee_id === crewFilter))) : divFilteredBoardData, [divFilteredBoardData, crewFilter]);
  const filteredCrewList = useMemo(() => crewFilter ? crewList.filter(e => e.id === crewFilter) : crewList, [crewList, crewFilter]);

  const totalAppts = filteredBoardData.reduce((s, j) => s + (j.appointments?.length || 0), 0);
  const todayKey = fmtDate(new Date());
  const todayAppts = filteredBoardData.reduce((s, j) => s + (j.appointments?.filter(a => a.date === todayKey).length || 0), 0);

  const handleApptClick = (appt) => { dismissGridHover(); setEditModal(appt); };

  // ── Optimistic drag-drop (move) ──
  const handleApptDrop = async (apptId, newDate, newTimeStart, newTimeEnd) => {
    const prev = boardData;
    setBoardData(data => data.map(job => ({ ...job, appointments: (job.appointments || []).map(a => a.id === apptId ? { ...a, date: newDate, time_start: newTimeStart, time_end: newTimeEnd } : a) })));
    try { await db.rpc('update_appointment', { p_appointment_id: apptId, p_title: null, p_date: newDate, p_time_start: newTimeStart, p_time_end: newTimeEnd, p_type: null, p_status: null, p_notes: null }); silentReloadBoard(); } catch (e) { console.error('Drop failed:', e); setBoardData(prev); }
  };
  const handleApptResize = async (apptId, newTimeEnd) => {
    const prev = boardData;
    setBoardData(data => data.map(job => ({ ...job, appointments: (job.appointments || []).map(a => a.id === apptId ? { ...a, time_end: newTimeEnd } : a) })));
    try { await db.rpc('update_appointment', { p_appointment_id: apptId, p_title: null, p_date: null, p_time_start: null, p_time_end: newTimeEnd, p_type: null, p_status: null, p_notes: null }); silentReloadBoard(); } catch (e) { console.error('Resize failed:', e); setBoardData(prev); }
  };

  // ── Grid cell drop handler (Jobs/Crew views — date change only) ──
  const handleGridCellDrop = useCallback((e, newDateKey) => {
    e.preventDefault();
    let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!data?.apptId) return;
    if (newDateKey === data.origDate) return; // same day, no-op
    handleApptDrop(data.apptId, newDateKey, data.time_start, data.time_end);
  }, [handleApptDrop]);

  const handleGridCellDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);

  // ── Reschedule remaining ──
  const handleRescheduleRemaining = async (appt) => {
    try {
      const tasks = await db.select('job_tasks', `appointment_id=eq.${appt.id}&is_completed=eq.false&select=id,title,phase_name`);
      if (!tasks || tasks.length === 0) { errToast('No incomplete tasks on this appointment.'); return; }
      const startMins = appt.time_start ? (parseInt(appt.time_start.split(':')[0]) * 60 + parseInt(appt.time_start.split(':')[1] || 0)) : 0;
      const endMins = appt.time_end ? (parseInt(appt.time_end.split(':')[0]) * 60 + parseInt(appt.time_end.split(':')[1] || 0)) : startMins + 120;
      setPlacementMode({ jobId: appt._jobId || appt.job_id, jobName: appt._jobName, taskIds: tasks.map(t => t.id), taskCount: tasks.length, crew: appt.crew || [], duration: Math.max(endMins - startMins, 60), type: appt.type || 'reconstruction', sourceApptId: appt.id, timeStart: appt.time_start || '09:00', timeEnd: appt.time_end || '11:00' });
    } catch (e) { console.error('Reschedule remaining:', e); }
  };

  // Grid placement: clicking a day cell in Jobs/Crew during placement mode
  const [gridPlacementPicker, setGridPlacementPicker] = useState(null); // { dateKey }

  const handleGridPlacementCellClick = (dateKey) => {
    if (!placementMode) return;
    setGridPlacementPicker({
      dateKey,
      timeStart: placementMode.timeStart || '09:00',
      timeEnd: placementMode.timeEnd || '11:00',
      crew: [...(placementMode.crew || [])], // editable copy
    });
  };

  const handlePlacementClick = async (dateKey, timeStart, timeEnd, crewOverride) => {
    if (!placementMode) return; const pm = placementMode; setPlacementMode(null);
    const crewToUse = crewOverride || pm.crew || [];
    try {
      const result = await db.insert('appointments', { job_id: pm.jobId, title: `${pm.jobName} (continued)`, date: dateKey, time_start: timeStart, time_end: timeEnd, type: pm.type, status: 'scheduled' });
      if (result && result.length > 0) {
        const nid = result[0].id;
        for (const c of crewToUse) await db.insert('appointment_crew', { appointment_id: nid, employee_id: c.employee_id, role: c.role });
        if (pm.taskIds.length > 0) await db.rpc('assign_tasks_to_appointment', { p_appointment_id: nid, p_task_ids: pm.taskIds });
      }
      loadBoard(); setPanelRefreshKey(k => k + 1);
    } catch (e) { console.error('Placement create failed:', e); errToast('Failed: ' + e.message); }
  };

  const [jobPickerModal, setJobPickerModal] = useState(null);
  const [jobPickerSearch, setJobPickerSearch] = useState('');
  const handleCellClick = (dateKey, hour) => {
    if (placementMode) return;
    if (selectedPanelJob) { const t = `${String(hour).padStart(2, '0')}:00`; const e = `${String(Math.min(hour + 2, 18)).padStart(2, '0')}:00`; setCreateModal({ jobId: selectedPanelJob.id, jobName: selectedPanelJob.insured_name, dateKey, prefillTaskIds: [], prefillTimeStart: t, prefillTimeEnd: e }); }
    else { setJobPickerModal({ dateKey, hour }); setJobPickerSearch(''); }
  };
  const handleJobPicked = (job) => { const { dateKey, hour } = jobPickerModal; const t = `${String(hour).padStart(2, '0')}:00`; const e = `${String(Math.min(hour + 2, 18)).padStart(2, '0')}:00`; setJobPickerModal(null); setCreateModal({ jobId: job.job_id || job.id, jobName: job.insured_name, dateKey, prefillTaskIds: [], prefillTimeStart: t, prefillTimeEnd: e }); };
  const handleMonthDayClick = (dateKey) => { setAnchor(new Date(dateKey + 'T00:00:00')); changeCalSpan('day'); };

  // Filter days for Jobs/Crew grids (respect weekends)
  const gridDays = useMemo(() => {
    if (calSpan === 'month') return days; // month uses its own renderer
    return days;
  }, [days, calSpan]);

  return (
    <div style={S.page}>
      <div className={`schedule-panel-wrap${panelOpen ? ' panel-is-open' : ''}`}>
        {panelOpen && <div className="schedule-panel-backdrop" onClick={() => setPanelOpen(false)} />}
        <JobPanel jobs={panelJobs} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(!panelOpen)} onToggleJob={toggleJob} loading={panelLoading} db={db} refreshKey={panelRefreshKey}
        onSchedulePhase={(jid, jn, ph) => setCreateModal({ jobId: jid, jobName: jn, dateKey: ph?.target_start || fmtDate(new Date()), prefillPhase: ph?.phase_name || null, prefillTaskIds: [] })}
        onCreateAppointment={(jid, jn, dk, tids) => setCreateModal({ jobId: jid, jobName: jn, dateKey: dk, prefillTaskIds: tids || [] })}
        onSelectJob={(jid) => { if (jid) { const j = panelJobs.find(x => x.id === jid); setSelectedPanelJob(j ? { id: j.id, insured_name: j.insured_name } : null); } else setSelectedPanelJob(null); }}
        onRefreshPanel={() => { loadPanelJobs(); loadBoard(); }}
        />
      </div>

      <div style={S.main}>
        <div style={S.header} className="schedule-header">
          <div>
            <h1 style={S.title}>Schedule</h1>
            <div style={S.subtitle}>
              {subtitleText}
              <span style={S.pill}>{filteredBoardData.length} jobs</span>
              <span style={S.pill}>{totalAppts} appts</span>
              {todayAppts > 0 && <span style={{ ...S.pill, background: '#eff6ff', color: '#2563eb' }}>{todayAppts} today</span>}
            </div>
          </div>
          <div style={S.controls} className="schedule-controls">
            {/* Mobile-only Jobs panel button */}
            <button className="schedule-mobile-jobs-btn" onClick={() => setPanelOpen(true)}>
              📋 Jobs ({panelJobs.filter(j => j.on_board).length} on schedule)
            </button>
            {/* Mobile-only ⚙ settings toggle */}
            <button className="schedule-gear-btn" onClick={() => setShowExtraControls(p => !p)} title="Settings">
              {showExtraControls ? '✕' : '⚙️'}
            </button>
            <div style={S.viewToggle}>
              <button style={{ ...S.viewBtn, ...(viewMode === 'calendar' ? S.viewBtnActive : {}) }} onClick={() => changeViewMode('calendar')}>Calendar</button>
              <button style={{ ...S.viewBtn, ...(viewMode === 'jobs' ? S.viewBtnActive : {}) }} onClick={() => changeViewMode('jobs')}>Jobs</button>
              <button style={{ ...S.viewBtn, ...(viewMode === 'crew' ? S.viewBtnActive : {}), borderRight: 'none' }} onClick={() => changeViewMode('crew')}>Crew</button>
            </div>
            <div style={S.viewToggle}>
              {SPAN_OPTIONS.filter(opt => viewMode === 'calendar' || opt.value !== 'month').map((opt, i, arr) => (
                <button key={opt.value} onClick={() => changeCalSpan(opt.value)}
                  style={{ ...S.viewBtn, ...(calSpan === opt.value ? S.viewBtnActive : {}), ...(i === arr.length - 1 ? { borderRight: 'none' } : {}) }}>{opt.label}</button>
              ))}
            </div>
            <button style={S.btn} onClick={goToday}>{todayLabel}</button>
            <button style={S.btnIcon} onClick={goPrev}>‹</button>
            <button style={S.btnIcon} onClick={goNext}>›</button>
            <div className={`schedule-extra-controls${showExtraControls ? ' open' : ''}`}>
              {calSpan !== 'day' && <label style={S.checkLabel}><input type="checkbox" checked={showWeekend} onChange={e => setShowWeekend(e.target.checked)} /><span>Weekends</span></label>}
              <label style={S.checkLabel}><input type="checkbox" checked={autoShow} onChange={e => setAutoShow(e.target.checked)} /><span>Auto-show</span></label>
            </div>
          </div>
        </div>

        {/* Division + Crew filter bar */}
        <div style={S.filterBar}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginRight: 4, flexShrink: 0 }}>Division:</span>
          {DIV_FILTER_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => setDivFilter(opt.key)}
              style={{ ...S.crewPill, ...(divFilter === opt.key ? S.crewPillActive : {}), display: 'flex', alignItems: 'center', gap: 4 }}>
              {opt.emoji && <span style={{ fontSize: 12 }}>{opt.emoji}</span>}
              {opt.label}
            </button>
          ))}
          {divFilter !== 'all' && (
            <button onClick={() => setDivFilter('all')} style={{ ...S.crewPill, color: 'var(--text-tertiary)', fontSize: 11 }}>Clear</button>
          )}
          {crewList.length > 0 && (
            <span className="schedule-crew-filter-wrap" style={{ display: 'contents' }}>
              <span style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 6px', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginRight: 4, flexShrink: 0 }}>Crew:</span>
              <button onClick={() => setCrewFilter(null)} style={{ ...S.crewPill, ...(crewFilter === null ? S.crewPillActive : {}) }}>All</button>
              {crewList.map(emp => <button key={emp.id} onClick={() => setCrewFilter(crewFilter === emp.id ? null : emp.id)} style={{ ...S.crewPill, ...(crewFilter === emp.id ? S.crewPillActive : {}) }}>{emp.display_name || emp.full_name}</button>)}
              {crewFilter && <button onClick={() => setCrewFilter(null)} style={{ ...S.crewPill, color: 'var(--text-tertiary)', fontSize: 11 }}>Clear</button>}
            </span>
          )}
        </div>

        {/* Board */}
        {loading ? (
          <div style={S.center}>Loading...</div>
        ) : viewMode === 'calendar' && calSpan === 'month' ? (
          <MonthView anchor={anchor} boardData={filteredBoardData} onApptClick={handleApptClick} onDayClick={handleMonthDayClick} showWeekend={showWeekend} />
        ) : viewMode === 'calendar' ? (
          <CalendarView days={gridDays} boardData={filteredBoardData} onApptClick={handleApptClick} onCellClick={handleCellClick} onApptDrop={handleApptDrop} onApptResize={handleApptResize} placementMode={placementMode} onPlacementClick={handlePlacementClick} onCancelPlacement={() => setPlacementMode(null)} onRescheduleRemaining={handleRescheduleRemaining} />
        ) : filteredBoardData.length === 0 && !crewFilter && divFilter === 'all' ? (
          <div style={S.center}><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No jobs in production</div><div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>Jobs move here automatically when a schedule is generated</div></div>
        ) : filteredBoardData.length === 0 ? (
          <div style={S.center}><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No appointments match current filters</div><div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}><button onClick={() => { setCrewFilter(null); setDivFilter('all'); }} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: 13, fontFamily: 'var(--font-sans)' }}>Clear all filters</button></div></div>
        ) : viewMode === 'crew' && filteredCrewList.length === 0 ? (
          <div style={S.center}>No crew assigned</div>
        ) : (
          <div style={S.gridWrap}>
            {/* Placement banner for Jobs/Crew views */}
            {placementMode && (viewMode === 'jobs' || viewMode === 'crew') && (
              <div style={{ padding: '8px 20px', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb' }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>Click a day to place: {placementMode.jobName}</span>
                  <span style={{ fontSize: 12, color: '#3b82f6' }}>· {placementMode.taskCount} tasks</span>
                </div>
                <button onClick={() => { setPlacementMode(null); setGridPlacementPicker(null); }}
                  style={{ fontSize: 12, fontWeight: 500, color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 'var(--radius-md)', padding: '4px 12px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Cancel</button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: `200px repeat(${gridDays.length}, minmax(140px, 1fr))`, minWidth: 200 + gridDays.length * 140 }}>
              <div style={S.corner} />
              {gridDays.map(day => <div key={day.key} style={{ ...S.dayHead, ...(day.isToday ? { background: '#f0f7ff' } : {}) }}><div style={{ fontSize: 12, fontWeight: 600, color: day.isToday ? '#2563eb' : 'var(--text-secondary)' }}>{day.label}</div><div style={{ fontSize: 11, color: day.isToday ? '#2563eb' : 'var(--text-tertiary)', marginTop: 1, fontWeight: day.isToday ? 600 : 400 }}>{day.shortDate}</div></div>)}

              {/* ═══ JOBS VIEW ═══ */}
              {viewMode === 'jobs' && filteredBoardData.map(job => {
                const dc = DIV_COLORS[job.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
                return [
                  <div key={`lbl-${job.job_id}`} style={S.jobCell}>
                    <div style={S.jobCellName} title={job.insured_name}>{job.insured_name}</div>
                    {job.job_number && <div style={S.jobCellNum}>#{job.job_number}</div>}
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}><span style={{ fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3, background: dc.bg, color: dc.text }}>{dc.label}</span>{!job.pinned && <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>auto</span>}</div>
                    {job.address && <div style={S.jobCellAddr} title={job.address}>{job.address.split(',')[0]}</div>}
                  </div>,
                  ...gridDays.map(day => {
                    const appts = filteredCellMap[`${job.job_id}_${day.key}`] || [];
                    return (
                      <div key={`${job.job_id}_${day.key}`}
                        style={{ ...S.cell, ...(day.isToday ? { background: '#fafcff' } : {}), ...(placementMode ? { cursor: 'copy', position: 'relative' } : {}) }}
                        onClick={() => placementMode ? handleGridPlacementCellClick(day.key) : setCreateModal({ jobId: job.job_id, jobName: job.insured_name, dateKey: day.key, prefillTaskIds: [] })}
                        onDragOver={handleGridCellDragOver} onDrop={e => handleGridCellDrop(e, day.key)}
                        onMouseEnter={e => {
                          const el = e.currentTarget.querySelector('[data-plus]'); if (el) el.style.opacity = '1';
                          const ghost = e.currentTarget.querySelector('[data-ghost]'); if (ghost) ghost.style.opacity = '1';
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget.querySelector('[data-plus]'); if (el) el.style.opacity = '0';
                          const ghost = e.currentTarget.querySelector('[data-ghost]'); if (ghost) ghost.style.opacity = '0';
                        }}>
                        {appts.map(a => <ApptCard key={a.id} appt={a} onClick={handleApptClick}
                          onDragStart={dismissGridHover} onHoverEnter={scheduleGridHover} onHoverLeave={cancelGridHover} />)}
                        {appts.length === 0 && !placementMode && <div data-plus style={S.plusWrap}><span style={S.plus}>+</span></div>}
                        {placementMode && (
                          <div data-ghost style={{ opacity: 0, transition: 'opacity 100ms', borderLeft: `3px solid ${placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb'}`, borderRadius: 4, background: hexToTint(placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb', 0.1), padding: '5px 7px', marginBottom: 3, pointerEvents: 'none' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{placementMode.jobName}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{placementMode.taskCount} tasks</div>
                          </div>
                        )}
                      </div>
                    );
                  }),
                ];
              })}

              {/* ═══ CREW VIEW ═══ */}
              {viewMode === 'crew' && filteredCrewList.map(emp => [
                <div key={`emp-${emp.id}`} style={S.jobCell}><div style={S.jobCellName}>{emp.display_name || emp.full_name}</div><div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{gridDays.reduce((c, d) => c + (crewCellMap[`${emp.id}_${d.key}`]?.length || 0), 0)} appts</div></div>,
                ...gridDays.map(day => {
                  const appts = crewCellMap[`${emp.id}_${day.key}`] || [];
                  return (
                    <div key={`${emp.id}_${day.key}`}
                      style={{ ...S.cell, ...(day.isToday ? { background: '#fafcff' } : {}), ...(placementMode ? { cursor: 'copy', position: 'relative' } : {}) }}
                      onClick={() => placementMode ? handleGridPlacementCellClick(day.key) : undefined}
                      onDragOver={handleGridCellDragOver} onDrop={e => handleGridCellDrop(e, day.key)}
                      onMouseEnter={e => { const ghost = e.currentTarget.querySelector('[data-ghost]'); if (ghost) ghost.style.opacity = '1'; }}
                      onMouseLeave={e => { const ghost = e.currentTarget.querySelector('[data-ghost]'); if (ghost) ghost.style.opacity = '0'; }}>
                      {appts.map(a => <CrewApptCard key={`${a.id}_${emp.id}`} appt={a} onClick={handleApptClick}
                        onDragStart={dismissGridHover} onHoverEnter={scheduleGridHover} onHoverLeave={cancelGridHover} />)}
                      {placementMode && (
                        <div data-ghost style={{ opacity: 0, transition: 'opacity 100ms', borderLeft: `3px solid ${placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb'}`, borderRadius: 4, background: hexToTint(placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb', 0.1), padding: '5px 7px', marginBottom: 3, pointerEvents: 'none' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{placementMode.jobName}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{placementMode.taskCount} tasks</div>
                        </div>
                      )}
                    </div>
                  );
                }),
              ])}
            </div>
          </div>
        )}
      </div>

      {/* Grid hover popover (Jobs/Crew views) */}
      {gridHover && (viewMode === 'jobs' || viewMode === 'crew') && (
        <GridPopover appt={gridHover.appt} rect={gridHover.rect}
          onEdit={a => { dismissGridHover(); setEditModal(a); }}
          onRescheduleRemaining={a => { dismissGridHover(); handleRescheduleRemaining(a); }}
          onMouseEnter={keepGridHover} onMouseLeave={dismissGridHover} />
      )}

      {createModal && <CreateAppointmentModal jobId={createModal.jobId} jobName={createModal.jobName} dateKey={createModal.dateKey} prefillTaskIds={createModal.prefillTaskIds || []} prefillTimeStart={createModal.prefillTimeStart} prefillTimeEnd={createModal.prefillTimeEnd} db={db} employees={allEmployees} onClose={() => setCreateModal(null)} onSaved={(sd) => { if (sd) setAnchor(new Date(sd + 'T00:00:00')); setCreateModal(null); loadBoard(); setPanelRefreshKey(k => k + 1); }} />}
      {/* Mobile + FAB — creates appointment for today */}
      <button
        className="schedule-mobile-fab"
        onClick={() => { setJobPickerModal({ dateKey: fmtDate(new Date()), hour: 9 }); setJobPickerSearch(''); }}
        aria-label="Create appointment"
      >+</button>

      {editModal && <EditAppointmentModal appointment={editModal} db={db} employees={allEmployees} onClose={() => setEditModal(null)} onSaved={() => { setEditModal(null); loadBoard(); setPanelRefreshKey(k => k + 1); }} onDeleted={() => { setEditModal(null); loadBoard(); setPanelRefreshKey(k => k + 1); }} />}

      {/* Grid placement time picker (Jobs/Crew views) */}
      {gridPlacementPicker && placementMode && (() => {
        const gp = gridPlacementPicker;
        const placementColor = placementMode.crew?.find(c => c.role === 'lead')?.color || '#2563eb';

        // Time helpers
        const parseTime = (t) => { const [h, m] = (t || '09:00').split(':').map(Number); return { h, m: m || 0 }; };
        const formatTime12 = (t) => { const { h, m } = parseTime(t); const hr = h % 12 || 12; return `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

        const HOUR_OPTIONS = [];
        for (let h = 6; h <= 20; h++) for (let m = 0; m < 60; m += 30) {
          const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          const hr = h % 12 || 12;
          const label = `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
          HOUR_OPTIONS.push({ val, label });
        }

        const togglePickerCrew = (emp) => {
          setGridPlacementPicker(prev => {
            const exists = prev.crew.find(c => c.employee_id === emp.id);
            if (exists) return { ...prev, crew: prev.crew.filter(c => c.employee_id !== emp.id) };
            return { ...prev, crew: [...prev.crew, { employee_id: emp.id, role: prev.crew.length === 0 ? 'lead' : 'tech', display_name: emp.display_name, full_name: emp.full_name, color: emp.color }] };
          });
        };

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, paddingTop: 100 }}
            onClick={() => setGridPlacementPicker(null)}>
            <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 380, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', borderTop: `3px solid ${placementColor}` }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '16px 20px 12px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Place appointment</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {placementMode.jobName} · {new Date(gp.dateKey + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3, fontWeight: 500 }}>{placementMode.taskCount} tasks will be assigned</div>
              </div>

              {/* Time selects */}
              <div style={{ padding: '0 20px 16px', display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Start</label>
                  <select value={gp.timeStart}
                    onChange={e => setGridPlacementPicker(p => ({ ...p, timeStart: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)', cursor: 'pointer', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%238b929e\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}>
                    {HOUR_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>End</label>
                  <select value={gp.timeEnd}
                    onChange={e => setGridPlacementPicker(p => ({ ...p, timeEnd: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)', cursor: 'pointer', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%238b929e\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}>
                    {HOUR_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Crew toggle */}
              <div style={{ padding: '0 20px 16px' }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Crew</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allEmployees.map(emp => {
                    const sel = gp.crew.find(c => c.employee_id === emp.id);
                    return (
                      <button key={emp.id} onClick={() => togglePickerCrew(emp)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px 4px 4px',
                          borderRadius: 99, border: sel ? `2px solid ${emp.color || 'var(--accent)'}` : '1px solid var(--border-color)',
                          background: sel ? hexToTint(emp.color || '#2563eb', 0.1) : 'var(--bg-primary)',
                          cursor: 'pointer', fontSize: 12, fontWeight: sel ? 600 : 400,
                          color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                          fontFamily: 'var(--font-sans)', transition: 'all 100ms ease',
                        }}>
                        <span style={{
                          width: 22, height: 22, borderRadius: 11, fontSize: 9, fontWeight: 700,
                          background: sel ? (emp.color || 'var(--accent)') : 'var(--bg-tertiary)',
                          color: sel ? '#fff' : 'var(--text-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{getInitials(emp.full_name || emp.display_name)}</span>
                        {emp.display_name || emp.full_name}
                        {sel?.role === 'lead' && <span style={{ fontSize: 8, fontWeight: 700, color: '#92400e', background: '#fffbeb', padding: '0 3px', borderRadius: 2, marginLeft: 2 }}>LEAD</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time validation warning */}
              {gp.timeStart && gp.timeEnd && gp.timeEnd <= gp.timeStart && (
                <div style={{ padding: '0 20px 8px', fontSize: 11, color: '#ef4444', fontWeight: 500 }}>End time must be after start time</div>
              )}

              {/* Footer */}
              <div style={{ padding: '12px 20px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setGridPlacementPicker(null)}
                  style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 14px', fontFamily: 'var(--font-sans)' }}>Cancel</button>
                <button onClick={() => {
                  handlePlacementClick(gp.dateKey, gp.timeStart, gp.timeEnd, gp.crew);
                  setGridPlacementPicker(null);
                }}
                  disabled={gp.timeStart && gp.timeEnd && gp.timeEnd <= gp.timeStart}
                  style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', cursor: 'pointer', fontFamily: 'var(--font-sans)', opacity: (gp.timeStart && gp.timeEnd && gp.timeEnd <= gp.timeStart) ? 0.5 : 1 }}>
                  Create appointment
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {jobPickerModal && (() => {
        const fpd = new Date(jobPickerModal.dateKey + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const fpt = `${jobPickerModal.hour % 12 || 12}:00${jobPickerModal.hour >= 12 ? 'pm' : 'am'}`;
        const q = jobPickerSearch.toLowerCase();
        const pj = boardData.filter(j => q ? j.insured_name.toLowerCase().includes(q) : true);
        const oj = panelJobs.filter(j => !boardData.some(b => b.job_id === j.id) && (q ? j.insured_name.toLowerCase().includes(q) : true));
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, paddingTop: 80 }} onClick={() => setJobPickerModal(null)}>
            <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 400, maxHeight: 'calc(100dvh - 160px - env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)' }}><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Select job</div><div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{fpd} at {fpt}</div></div>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}><input style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-sans)', outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-primary)' }} placeholder="Search jobs..." value={jobPickerSearch} onChange={e => setJobPickerSearch(e.target.value)} autoFocus /></div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {pj.length > 0 && <><div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.04em', background: 'var(--bg-secondary)' }}>In Production ({pj.length})</div>{pj.map(j => <div key={j.job_id} onClick={() => handleJobPicked(j)} style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{j.insured_name}</div><div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>#{j.job_number} · {j.address?.split(',')[0]}</div></div>)}</>}
                {oj.length > 0 && <><div style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.04em', background: 'var(--bg-secondary)' }}>Other ({oj.length})</div>{oj.map(j => <div key={j.id} onClick={() => handleJobPicked(j)} style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{j.insured_name}</div><div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>#{j.job_number}</div></div>)}</>}
                {pj.length === 0 && oj.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>No jobs found</div>}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
const S = {
  page: { height: '100%', display: 'flex', overflow: 'hidden', background: 'var(--bg-secondary)' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 20px 10px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 },
  pill: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' },
  controls: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  btn: { fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' },
  btnIcon: { width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' },
  filterBar: { display: 'flex', alignItems: 'center', gap: 5, padding: '6px 20px', background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, overflowX: 'auto' },
  crewPill: { fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 99, border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', transition: 'all 120ms ease' },
  crewPillActive: { background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 600 },
  viewToggle: { display: 'flex', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' },
  viewBtn: { fontSize: 12, fontWeight: 500, padding: '5px 14px', border: 'none', background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-tertiary)', fontFamily: 'var(--font-sans)', transition: 'all 120ms ease', borderRight: '1px solid var(--border-color)' },
  viewBtnActive: { background: 'var(--accent-light)', color: 'var(--accent)', fontWeight: 600 },
  gridWrap: { flex: 1, overflow: 'auto' },
  corner: { position: 'sticky', left: 0, top: 0, zIndex: 3, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' },
  dayHead: { padding: '8px 6px', textAlign: 'center', position: 'sticky', top: 0, zIndex: 2, borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-light)', background: 'var(--bg-secondary)' },
  jobCell: { padding: '8px 10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', background: 'var(--bg-primary)', position: 'sticky', left: 0, zIndex: 1, minHeight: 70 },
  jobCellName: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 },
  jobCellNum: { fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' },
  jobCellAddr: { fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 },
  cell: { borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-light)', padding: 3, minHeight: 70, cursor: 'pointer' },
  plusWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 64, opacity: 0, transition: 'opacity 120ms ease' },
  plus: { width: 24, height: 24, borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-tertiary)' },
  center: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-tertiary)' },
};
