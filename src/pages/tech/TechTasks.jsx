import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { toast } from '@/lib/toast';

const haptic = (ms = 50) => { if ('vibrate' in navigator) navigator.vibrate(ms); };

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'all', label: 'All' },
];

/* ── Completion Ring SVG ── */

function CompletionRing({ done, total }) {
  const size = 52;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? done / total : 0;
  const dashOffset = circumference * (1 - pct);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {/* Track */}
      <circle cx={size/2} cy={size/2} r={radius}
        fill="none" stroke="var(--bg-tertiary)" strokeWidth={stroke} />
      {/* Progress */}
      <circle cx={size/2} cy={size/2} r={radius}
        fill="none" stroke="#16a34a" strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.3s ease' }}
      />
      {/* Center text */}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 14, fontWeight: 700, fill: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
        {done}/{total}
      </text>
    </svg>
  );
}

/* ── Swipeable Task Row ── */

function SwipeTaskRow({ task, onToggle }) {
  const [swipeX, setSwipeX] = useState(0);
  const startX = useRef(null);
  const [recentlyDone, setRecentlyDone] = useState(false);

  const handlePointerDown = (e) => { startX.current = e.clientX; };
  const handlePointerMove = (e) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    if (dx > 0) {
      setSwipeX(Math.min(dx, 80));
      if (dx >= 40 && dx < 42) haptic(20);
    }
  };
  const justSwiped = useRef(false);
  const handlePointerUp = () => {
    if (swipeX > 40) {
      haptic(50);
      justSwiped.current = true;
      if (!task.is_complete) setRecentlyDone(true);
      onToggle(task);
      if (!task.is_complete) setTimeout(() => setRecentlyDone(false), 300);
    }
    setSwipeX(0);
    startX.current = null;
  };

  const handleToggle = (t) => {
    if (justSwiped.current) { justSwiped.current = false; return; }
    if (!t.is_complete) setRecentlyDone(true);
    onToggle(t);
    if (!t.is_complete) setTimeout(() => setRecentlyDone(false), 300);
  };

  return (
    <div className="tech-task-swipe-wrap">
      {swipeX > 0 && (
        <div className="tech-task-swipe-bg">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 600, marginLeft: 4 }}>Done</span>
        </div>
      )}
      <div
        className="tech-task-row"
        onClick={() => handleToggle(task)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { setSwipeX(0); startX.current = null; }}
        style={{
          padding: '10px var(--space-4)',
          borderBottom: '1px solid var(--border-light)',
          transform: swipeX > 0 ? `translateX(${swipeX}px)` : 'none',
          minHeight: 'var(--tech-row-height)',
        }}
      >
        <div className={`tech-task-check${task.is_complete ? ' done' : ''}${recentlyDone ? ' tech-check-pop' : ''}`}>
          {task.is_complete && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div className={`tech-task-name${task.is_complete ? ' done' : ''}`}>{task.task_name}</div>
          {task.phase_name && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>{task.phase_name}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── TechTasks Page ── */

export default function TechTasks() {
  const { employee, db } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const togglingRef = useRef(new Set());
  const [tab, setTab] = useState('today');
  const [collapsed, setCollapsed] = useState({});

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
    if (togglingRef.current.has(task.task_id)) return;
    togglingRef.current.add(task.task_id);
    setTasks(prev => prev.map(t => t.task_id === task.task_id ? { ...t, is_complete: !t.is_complete } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.task_id, p_employee_id: employee.id });
      toast('Task updated');
    } catch (e) {
      toast('Failed to toggle task', 'error');
      setTasks(prev => prev.map(t => t.task_id === task.task_id ? { ...t, is_complete: !t.is_complete } : t));
    } finally {
      togglingRef.current.delete(task.task_id);
    }
  };

  const toggleCollapse = (jobId) => setCollapsed(prev => ({ ...prev, [jobId]: !prev[jobId] }));

  const filtered = tab === 'today' ? tasks.filter(t => t.is_today) : tasks;
  const doneCount = filtered.filter(t => t.is_complete).length;
  const totalCount = filtered.length;

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
        <div className="tech-page-header" style={{ marginBottom: 12 }}>
          <div className="tech-page-title">Tasks</div>
        </div>

        {/* Pill tabs */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 'var(--space-4)' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 18px', borderRadius: 'var(--radius-full)', border: '1px solid',
                fontSize: 14, fontWeight: tab === t.key ? 600 : 400, cursor: 'pointer',
                height: 40,
                background: tab === t.key ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                borderColor: tab === t.key ? 'var(--accent)' : 'var(--border-color)',
                fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Completion summary — today tab only */}
        {tab === 'today' && totalCount > 0 && (
          <div className="tech-tasks-summary" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 'var(--space-4)',
          }}>
            <CompletionRing done={doneCount} total={totalCount} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                {doneCount} of {totalCount} done
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>today's tasks</div>
            </div>
          </div>
        )}
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
                  style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 600 }}
                >
                  View all tasks
                </button>
              </div>
            )}
          </div>
        ) : (
          groups.map(([jobId, group]) => {
            const isCollapsed = collapsed[jobId];
            const groupDone = group.tasks.filter(t => t.is_complete).length;
            const groupTotal = group.tasks.length;
            const groupPct = groupTotal > 0 ? (groupDone / groupTotal) * 100 : 0;

            return (
              <div key={jobId}>
                {/* Collapsible job group header */}
                <div
                  onClick={() => toggleCollapse(jobId)}
                  style={{
                    padding: '10px var(--space-4)',
                    background: 'var(--bg-tertiary)',
                    borderBottom: '1px solid var(--border-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                        {group.job_number || 'Job'}
                      </span>
                      {group.insured_name && (
                        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                          {group.insured_name}
                        </span>
                      )}
                    </div>
                    {/* Mini progress bar */}
                    <div className="tech-task-progress-bar" style={{ marginTop: 6, height: 4 }}>
                      <div className="tech-task-progress-fill" style={{ width: `${groupPct}%` }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                      {groupDone}/{groupTotal}
                    </span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Task rows — hidden when collapsed */}
                {!isCollapsed && group.tasks.map(task => (
                  <SwipeTaskRow key={task.task_id} task={task} onToggle={toggleTask} />
                ))}
              </div>
            );
          })
        )}
      </PullToRefresh>
    </div>
  );
}
