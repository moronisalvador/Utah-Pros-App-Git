import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

/* ── Time Tracker Widget ── */

function TimeTracker({ appt, employee, db, onUpdate }) {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState('0:00:00');
  const [confirmFinish, setConfirmFinish] = useState(false);
  const timerRef = useRef(null);

  const loadEntry = useCallback(async () => {
    try {
      const rows = await db.select(
        'job_time_entries',
        `appointment_id=eq.${appt.id}&employee_id=eq.${employee.id}&select=*&limit=1`
      );
      setEntry(rows?.[0] || null);
    } catch { /* ignore */ }
    setLoading(false);
  }, [db, appt.id, employee.id]);

  useEffect(() => { loadEntry(); }, [loadEntry]);

  // Live timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!entry?.clock_in || entry?.clock_out) return;
    if (entry.paused_at) {
      // frozen timer — show time up to pause
      const pausedMs = new Date(entry.paused_at) - new Date(entry.clock_in)
        - (entry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, pausedMs)));
      return;
    }
    const tick = () => {
      const ms = Date.now() - new Date(entry.clock_in).getTime()
        - (entry.total_paused_minutes || 0) * 60000;
      setElapsed(fmtMs(Math.max(0, ms)));
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [entry]);

  const doAction = async (action) => {
    if (action === 'finish') {
      if (!confirmFinish) { setConfirmFinish(true); return; }
      setConfirmFinish(false);
    }
    setActing(true);
    try {
      await db.rpc('clock_appointment_action', {
        p_appointment_id: appt.id,
        p_employee_id: employee.id,
        p_action: action,
      });
      await loadEntry();
      if (onUpdate) onUpdate();
    } catch (e) {
      toast('Action failed: ' + e.message, 'error');
    }
    setActing(false);
  };

  if (loading) return <div className="tech-tracker" style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading...</div>;

  const hasTravel = entry?.travel_start;
  const hasClockIn = entry?.clock_in;
  const hasClockOut = entry?.clock_out;
  const isPaused = entry?.paused_at;

  // Completed
  if (hasClockOut) {
    return (
      <div className="tech-tracker">
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 6 }}>COMPLETED</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span><strong>In:</strong> {fmtTime(entry.clock_in)}</span>
          <span><strong>Out:</strong> {fmtTime(entry.clock_out)}</span>
          <span><strong>Hours:</strong> {entry.hours ?? '—'}</span>
        </div>
      </div>
    );
  }

  // In Progress or Paused
  if (hasClockIn) {
    return (
      <div className="tech-tracker">
        <div className="tech-tracker-timer">{elapsed}</div>
        {isPaused && <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', marginBottom: 6 }}>PAUSED</div>}
        <div className="tech-tracker-actions">
          {isPaused ? (
            <button className="btn btn-primary" onClick={() => doAction('resume')} disabled={acting} style={{ flex: 1 }}>
              Resume
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => doAction('pause')} disabled={acting} style={{ flex: 1 }}>
              Pause
            </button>
          )}
          <button
            className="btn"
            onClick={() => doAction('finish')}
            onBlur={() => setConfirmFinish(false)}
            disabled={acting}
            style={{
              flex: 1,
              background: confirmFinish ? '#fef2f2' : 'var(--bg-tertiary)',
              color: confirmFinish ? '#dc2626' : 'var(--text-primary)',
              border: `1px solid ${confirmFinish ? '#fecaca' : 'var(--border-color)'}`,
              fontWeight: confirmFinish ? 700 : 500,
            }}
          >
            {confirmFinish ? 'Confirm Finish' : 'Finish'}
          </button>
        </div>
      </div>
    );
  }

  // En Route
  if (hasTravel) {
    return (
      <div className="tech-tracker">
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Left at {fmtTime(entry.travel_start)}
        </div>
        <button
          className="btn"
          onClick={() => doAction('start')}
          disabled={acting}
          style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600 }}
        >
          Start Work
        </button>
      </div>
    );
  }

  // Scheduled — no entry yet
  return (
    <div className="tech-tracker">
      <button
        className="btn"
        onClick={() => doAction('omw')}
        disabled={acting}
        style={{ width: '100%', background: '#d97706', color: '#fff', border: 'none', fontWeight: 600 }}
      >
        On My Way
      </button>
    </div>
  );
}

/* ── Appointment Card ── */

function AppointmentCard({ appt, employee, db, expanded, onReload }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const fileRef = useRef(null);

  const job = appt.jobs;
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';

  const loadTasks = useCallback(async () => {
    if (tasksLoaded) return;
    try {
      const result = await db.rpc('get_appointment_tasks', { p_appointment_id: appt.id });
      setTasks(result || []);
    } catch { /* ignore */ }
    setTasksLoaded(true);
  }, [db, appt.id, tasksLoaded]);

  const toggleTasks = () => {
    if (!tasksOpen) loadTasks();
    setTasksOpen(o => !o);
  };

  const toggleTask = async (task) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.id, p_employee_id: employee.id });
    } catch (e) {
      toast('Failed to toggle task', 'error');
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    }
  };

  const openMap = () => {
    if (!address) return;
    const encoded = encodeURIComponent(address);
    const url = /iPhone|iPad/.test(navigator.userAgent)
      ? `maps://?q=${encoded}`
      : `https://maps.google.com/?q=${encoded}`;
    window.open(url);
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !job) return;
    try {
      const ts = Date.now();
      const path = `${job.id}/${ts}-${file.name}`;
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${db.apiKey}`,
          'Content-Type': file.type,
        },
        body: file,
      });
      if (!res.ok) throw new Error('Upload failed');
      await db.rpc('insert_job_document', {
        p_job_id: job.id,
        p_name: file.name,
        p_file_path: `job-files/${path}`,
        p_mime_type: file.type,
        p_category: 'photo',
        p_uploaded_by: employee.id,
      });
      toast('Photo uploaded');
    } catch (e) {
      toast('Photo upload failed: ' + e.message, 'error');
    }
    e.target.value = '';
  };

  const doneCount = tasks.filter(t => t.is_completed).length;
  const totalCount = tasks.length;
  const timeStr = appt.time_start ? formatTimeStr(appt.time_start) : '';

  // Collapsed card for future appointments
  if (!expanded) {
    return (
      <div className="tech-appt-card" style={{ opacity: 0.75 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tech-appt-time" style={{ marginBottom: 0 }}>{timeStr}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{appt.title || 'Appointment'}</span>
        </div>
        {address && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{address}</div>}
      </div>
    );
  }

  return (
    <div className="tech-appt-card">
      <div className="tech-appt-time">{timeStr}</div>
      <div className="tech-appt-title">{appt.title || job?.division || 'Appointment'}</div>

      {address && (
        <button className="tech-appt-address" onClick={openMap}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {address}
        </button>
      )}

      <TimeTracker appt={appt} employee={employee} db={db} onUpdate={onReload} />

      {/* Tasks toggle */}
      <button className="tech-tasks-toggle" onClick={toggleTasks}>
        <span>Tasks{tasksLoaded ? ` ${doneCount}/${totalCount}` : ''}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: tasksOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {tasksOpen && (
        <div style={{ marginTop: 8 }}>
          {tasks.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>No tasks assigned</div>}
          {tasks.map(task => (
            <div key={task.id} className="tech-task-row" onClick={() => toggleTask(task)}>
              <div className={`tech-task-check${task.is_completed ? ' done' : ''}`}>
                {task.is_completed && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </div>
              <span className={`tech-task-name${task.is_completed ? ' done' : ''}`}>{task.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions row */}
      <div className="tech-appt-actions">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          ref={fileRef}
          onChange={handlePhoto}
        />
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => fileRef.current?.click()}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Photo
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/conversations')}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Message
        </button>
      </div>
    </div>
  );
}

/* ── TechDash Page ── */

export default function TechDash() {
  const { employee, db } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.rpc('get_my_appointments_today', { p_employee_id: employee.id });
      setAppointments(result || []);
    } catch (e) {
      toast('Failed to load appointments', 'error');
    }
    setLoading(false);
  }, [db, employee.id]);

  useEffect(() => { load(); }, [load]);

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const firstName = (employee.display_name || employee.full_name || '').split(' ')[0];

  // Determine which appointments are "active" (en_route, in_progress, paused, scheduled)
  const activeStatuses = ['scheduled', 'en_route', 'in_progress', 'paused', 'confirmed'];
  const active = appointments.filter(a => activeStatuses.includes(a.status));
  const future = appointments.filter(a => !activeStatuses.includes(a.status) && a.status !== 'completed');
  const completed = appointments.filter(a => a.status === 'completed');

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (appointments.length === 0) {
    return (
      <div className="tech-page">
        <div className="tech-page-header">
          <div className="tech-page-date">{dateStr}</div>
          <div className="tech-page-title">{firstName}</div>
        </div>
        <div className="empty-state" style={{ marginTop: 60 }}>
          <div className="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div className="empty-state-text">No appointments today</div>
          <div className="empty-state-sub">
            <Link to="/tech/schedule" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              Check your schedule for upcoming jobs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tech-page">
      <div className="tech-page-header">
        <div className="tech-page-date">{dateStr}</div>
        <div className="tech-page-title">{firstName}</div>
        <div className="tech-page-subtitle">{appointments.length} appointment{appointments.length !== 1 ? 's' : ''} today</div>
      </div>

      {/* Active / scheduled appointments — expanded */}
      {active.map(appt => (
        <AppointmentCard key={appt.id} appt={appt} employee={employee} db={db} expanded onReload={load} />
      ))}

      {/* Future appointments — collapsed */}
      {future.map(appt => (
        <AppointmentCard key={appt.id} appt={appt} employee={employee} db={db} expanded={false} onReload={load} />
      ))}

      {/* Completed appointments — collapsed */}
      {completed.map(appt => (
        <AppointmentCard key={appt.id} appt={appt} employee={employee} db={db} expanded onReload={load} />
      ))}
    </div>
  );
}

/* ── Helpers ── */

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatTimeStr(timeStr) {
  if (!timeStr) return '';
  // timeStr may be "08:00:00" or "08:00"
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
