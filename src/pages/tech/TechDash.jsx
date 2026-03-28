import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import TimeTracker, { formatTimeStr } from '@/components/tech/TimeTracker';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

/* ── Active Appointment Card (expanded) ── */

function ActiveCard({ appt, employee, db, onReload }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [showAllTasks, setShowAllTasks] = useState(false);

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

  useEffect(() => { loadTasks(); }, [loadTasks]);

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

  const goToDetail = () => navigate(`/tech/appointment/${appt.id}`);

  const doneCount = tasks.filter(t => t.is_completed).length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
  const visibleTasks = (totalCount <= 5 || showAllTasks) ? tasks : tasks.slice(0, 5);

  return (
    <div className="tech-appt-card" data-status={appt.status} onClick={goToDetail}>
      <div className="tech-appt-title">{appt.title || job?.division || 'Appointment'}</div>

      {address && (
        <button className="tech-appt-address" onClick={openMap}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          {address}
        </button>
      )}

      {/* Task progress inline */}
      {tasksLoaded && totalCount > 0 && (
        <div style={{ marginBottom: 8 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Tasks {doneCount}/{totalCount}
            </span>
          </div>
          <div className="tech-task-progress-bar">
            <div className="tech-task-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>

          {/* Inline tasks */}
          <div style={{ marginTop: 8 }}>
            {visibleTasks.map(task => (
              <div key={task.id} className="tech-task-row" onClick={() => toggleTask(task)}>
                <div className={`tech-task-check${task.is_completed ? ' done' : ''}`}>
                  {task.is_completed && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </div>
                <span className={`tech-task-name${task.is_completed ? ' done' : ''}`}>{task.title}</span>
              </div>
            ))}
            {totalCount > 5 && !showAllTasks && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTasks(true); }}
                style={{
                  background: 'none', border: 'none', color: 'var(--accent)',
                  fontSize: 13, fontWeight: 600, padding: '8px 0', cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                Show {totalCount - 5} more tasks
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Future Appointment Row (timeline style) ── */

function FutureRow({ appt }) {
  const navigate = useNavigate();
  const job = appt.jobs;
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
  const timeStr = appt.time_start ? formatTimeStr(appt.time_start) : '';

  return (
    <div className="tech-future-row" onClick={() => navigate(`/tech/appointment/${appt.id}`)}>
      <div className="tech-future-time-col">
        <div className="tech-future-time">{timeStr}</div>
      </div>
      <div className="tech-future-line" />
      <div className="tech-future-content">
        <div className="tech-future-title">{appt.title || 'Appointment'}</div>
        {address && <div className="tech-future-address">{address}</div>}
      </div>
    </div>
  );
}

/* ── Quick Actions ── */

function QuickActions() {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  return (
    <div className="tech-quick-actions">
      <input
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        ref={fileRef}
        onChange={() => { /* handled at appointment level */ fileRef.current.value = ''; }}
      />
      <button className="tech-quick-action-btn" onClick={() => fileRef.current?.click()}>
        <div className="tech-quick-action-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <span className="tech-quick-action-label">Photo</span>
      </button>
      <Link className="tech-quick-action-btn" to="/tech/conversations">
        <div className="tech-quick-action-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <span className="tech-quick-action-label">Message</span>
      </Link>
      <Link className="tech-quick-action-btn" to="/tech/schedule">
        <div className="tech-quick-action-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <span className="tech-quick-action-label">Schedule</span>
      </Link>
    </div>
  );
}

/* ── Skeleton Loading ── */

function DashSkeleton() {
  return (
    <div className="tech-page">
      {/* Greeting skeleton */}
      <div style={{ marginBottom: 16 }}>
        <div className="tech-skeleton-line short" style={{ height: 10, width: '30%' }} />
        <div className="tech-skeleton-line" style={{ height: 28, width: '55%', marginBottom: 6 }} />
        <div className="tech-skeleton-line" style={{ height: 14, width: '40%' }} />
      </div>
      {/* Tracker skeleton */}
      <div className="tech-skeleton-card" style={{ padding: 20 }}>
        <div className="tech-skeleton-line" style={{ height: 40, width: '50%', margin: '12px auto' }} />
        <div className="tech-skeleton-line" style={{ height: 52, width: '100%' }} />
      </div>
      {/* Card skeleton */}
      <div className="tech-skeleton-card">
        <div className="tech-skeleton-line medium" style={{ height: 18 }} />
        <div className="tech-skeleton-line long" />
        <div className="tech-skeleton-line" style={{ height: 4, width: '60%' }} />
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

  if (loading) return <DashSkeleton />;

  const activeStatuses = ['scheduled', 'en_route', 'in_progress', 'paused', 'confirmed'];
  const active = appointments.filter(a => activeStatuses.includes(a.status));
  const completed = appointments.filter(a => a.status === 'completed');
  const future = appointments.filter(a => !activeStatuses.includes(a.status) && a.status !== 'completed');

  // The "hero" appointment for the TimeTracker — first active or first overall
  const heroAppt = active[0] || (appointments.length > 0 ? appointments.find(a => a.status !== 'completed') : null);

  if (appointments.length === 0) {
    return (
      <div className="tech-page">
        <div className="tech-dash-greeting">
          <div className="tech-dash-date">{dateStr}</div>
          <div className="tech-dash-name">Hey {firstName} 👋</div>
          <div className="tech-dash-summary">0 appointments today</div>
        </div>
        <div className="empty-state" style={{ marginTop: 40 }}>
          <div className="empty-state-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <polyline points="9 16 11 18 15 14" strokeWidth="2"/>
            </svg>
          </div>
          <div className="empty-state-text">No appointments today</div>
          <div className="empty-state-sub">
            <Link to="/tech/schedule" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              Check your upcoming schedule →
            </Link>
          </div>
        </div>
        <QuickActions />
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={load}>
      <div className="tech-page">
        {/* Greeting */}
        <div className="tech-dash-greeting">
          <div className="tech-dash-date">{dateStr}</div>
          <div className="tech-dash-name">Hey {firstName} 👋</div>
          <div className="tech-dash-summary">
            {appointments.length} appointment{appointments.length !== 1 ? 's' : ''} today
          </div>
        </div>

        {/* Hero TimeTracker */}
        {heroAppt && (
          <div onClick={e => e.stopPropagation()}>
            <TimeTracker appt={heroAppt} employee={employee} db={db} onUpdate={load} />
          </div>
        )}

        {/* Active appointment cards */}
        {active.map(appt => (
          <ActiveCard key={appt.id} appt={appt} employee={employee} db={db} onReload={load} />
        ))}

        {/* Future appointments — timeline style */}
        {future.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 8, paddingLeft: 4,
            }}>
              Upcoming
            </div>
            {future.map(appt => (
              <FutureRow key={appt.id} appt={appt} />
            ))}
          </div>
        )}

        {/* Completed — compact */}
        {completed.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 8, paddingLeft: 4,
            }}>
              Completed
            </div>
            {completed.map(appt => {
              const timeStr = appt.time_start ? formatTimeStr(appt.time_start) : '';
              return (
                <div
                  key={appt.id}
                  className="tech-appt-card"
                  data-status="completed"
                  onClick={() => {}}
                  style={{ opacity: 0.65, padding: '12px 16px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)' }}>{timeStr}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {appt.title || 'Appointment'}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Actions */}
        <QuickActions />
      </div>
    </PullToRefresh>
  );
}
