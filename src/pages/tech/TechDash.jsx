import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import TimeTracker, { formatTimeStr } from '@/components/tech/TimeTracker';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

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

  const toggleTasks = (e) => {
    e.stopPropagation();
    if (!tasksOpen) loadTasks();
    setTasksOpen(o => !o);
  };

  const toggleTask = async (task) => {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.id, p_employee_id: employee.id });
    } catch (e) {
      toast('Failed to toggle task', 'error');
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    }
  };

  const openMap = (e) => {
    e.stopPropagation();
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

  const goToDetail = () => navigate(`/tech/appointment/${appt.id}`);

  const doneCount = tasks.filter(t => t.is_completed).length;
  const totalCount = tasks.length;
  const timeStr = appt.time_start ? formatTimeStr(appt.time_start) : '';

  // Collapsed card for future appointments
  if (!expanded) {
    return (
      <div className="tech-appt-card" style={{ opacity: 0.75, cursor: 'pointer' }} onClick={goToDetail}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tech-appt-time" style={{ marginBottom: 0 }}>{timeStr}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{appt.title || 'Appointment'}</span>
        </div>
        {address && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{address}</div>}
      </div>
    );
  }

  return (
    <div className="tech-appt-card" style={{ cursor: 'pointer' }} onClick={goToDetail}>
      <div className="tech-appt-time">{timeStr}</div>
      <div className="tech-appt-title">{appt.title || job?.division || 'Appointment'}</div>

      {address && (
        <button className="tech-appt-address" onClick={openMap}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {address}
        </button>
      )}

      {/* Stop propagation on interactive elements inside the card */}
      <div onClick={e => e.stopPropagation()}>
        <TimeTracker appt={appt} employee={employee} db={db} onUpdate={onReload} />
      </div>

      {/* Tasks toggle */}
      <button className="tech-tasks-toggle" onClick={toggleTasks}>
        <span>Tasks{tasksLoaded ? ` ${doneCount}/${totalCount}` : ''}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: tasksOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {tasksOpen && (
        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
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
      <div className="tech-appt-actions" onClick={e => e.stopPropagation()}>
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
          onClick={() => navigate('/tech/conversations')}
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
    <PullToRefresh onRefresh={load}>
      <div className="tech-page">
        <div className="tech-page-header">
          <div className="tech-page-date">{dateStr}</div>
          <div className="tech-page-title">{firstName}</div>
          <div className="tech-page-subtitle">{appointments.length} appointment{appointments.length !== 1 ? 's' : ''} today</div>
        </div>

        {active.map(appt => (
          <AppointmentCard key={appt.id} appt={appt} employee={employee} db={db} expanded onReload={load} />
        ))}

        {future.map(appt => (
          <AppointmentCard key={appt.id} appt={appt} employee={employee} db={db} expanded={false} onReload={load} />
        ))}

        {completed.map(appt => (
          <AppointmentCard key={appt.id} appt={appt} employee={employee} db={db} expanded onReload={load} />
        ))}
      </div>
    </PullToRefresh>
  );
}
