import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'all', label: 'All' },
];

export default function TechTasks() {
  const { employee, db } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('today');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.rpc('get_assigned_tasks', { p_employee_id: employee.id });
      setTasks(result || []);
    } catch (e) {
      toast('Failed to load tasks', 'error');
    }
    setLoading(false);
  }, [db, employee.id]);

  useEffect(() => { load(); }, [load]);

  const toggleTask = async (task) => {
    // Optimistic update
    setTasks(prev => prev.map(t => t.task_id === task.task_id ? { ...t, is_complete: !t.is_complete } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.task_id, p_employee_id: employee.id });
      toast('Task updated');
    } catch (e) {
      toast('Failed to toggle task', 'error');
      setTasks(prev => prev.map(t => t.task_id === task.task_id ? { ...t, is_complete: !t.is_complete } : t));
    }
  };

  const filtered = tab === 'today' ? tasks.filter(t => t.is_today) : tasks;

  // Group by job
  const grouped = {};
  filtered.forEach(t => {
    const key = t.job_id || 'unknown';
    if (!grouped[key]) grouped[key] = { job_number: t.job_number, insured_name: t.insured_name, tasks: [] };
    grouped[key].tasks.push(t);
  });
  const groups = Object.entries(grouped);

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <div className="tech-page-header">
          <div className="tech-page-title">Tasks</div>
        </div>

        {/* Pill tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-4)' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid',
                fontSize: 12, fontWeight: tab === t.key ? 600 : 400, cursor: 'pointer',
                background: tab === t.key ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                borderColor: tab === t.key ? 'var(--accent)' : 'var(--border-color)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
        {groups.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <div className="empty-state-text">
              {tab === 'today' ? 'No tasks for today' : 'No tasks assigned'}
            </div>
            {tab === 'today' && (
              <div className="empty-state-sub">
                <button
                  onClick={() => setTab('all')}
                  style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)' }}
                >
                  View all tasks
                </button>
              </div>
            )}
          </div>
        ) : (
          groups.map(([jobId, group]) => (
            <div key={jobId}>
              {/* Job group header */}
              <div style={{
                padding: '8px var(--space-4)',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-light)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {group.job_number || 'Job'}
                </span>
                {group.insured_name && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                    {group.insured_name}
                  </span>
                )}
              </div>

              {/* Task rows */}
              {group.tasks.map(task => (
                <div
                  key={task.task_id}
                  className="tech-task-row"
                  onClick={() => toggleTask(task)}
                  style={{ padding: '10px var(--space-4)', borderBottom: '1px solid var(--border-light)', background: 'var(--bg-primary)' }}
                >
                  <div className={`tech-task-check${task.is_complete ? ' done' : ''}`}>
                    {task.is_complete && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className={`tech-task-name${task.is_complete ? ' done' : ''}`}>{task.task_name}</div>
                    {task.phase_name && (
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{task.phase_name}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </PullToRefresh>
    </div>
  );
}
