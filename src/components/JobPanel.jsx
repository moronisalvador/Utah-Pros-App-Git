import { useState, useEffect, useCallback, useMemo } from 'react';
import ScheduleWizard from '@/components/ScheduleWizard';
import { DIV_COLORS, MITIGATION_DIVS, RECON_DIVS, classifyPhase, fmtDate, fmtShortDate } from '@/lib/scheduleUtils';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

function JobPanel({ jobs, panelOpen, onTogglePanel, onToggleJob, loading, db, onSchedulePhase, onCreateAppointment, onSelectJob, selectedJobId, refreshKey, onRefreshPanel }) {
  const [search, setSearch] = useState('');
  const [expandedGroup, setExpandedGroup] = useState('active');
  const [divFilter, setDivFilter] = useState(() => {
    try { return localStorage.getItem('upr_schedule_div_filter') || 'all'; } catch { return 'all'; }
  });
  const changeDivFilter = (f) => {
    setDivFilter(f);
    try { localStorage.setItem('upr_schedule_div_filter', f); } catch {}
  };

  // Detail view state
  const [activeJob, setActiveJob] = useState(null);
  const [taskPool, setTaskPool] = useState([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState(new Set());

  // Task selection
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());
  const [showScheduledPhases, setShowScheduledPhases] = useState(new Set()); // phases where we show scheduled/done tasks

  // Add task / add phase
  const [addingTaskToPhase, setAddingTaskToPhase] = useState(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddPhase, setShowAddPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(null); // task id pending delete

  // Refresh pool when appointment is created/saved
  useEffect(() => {
    if (refreshKey > 0 && activeJob) {
      (async () => {
        try {
          const data = await db.rpc('get_job_task_pool', { p_job_id: activeJob.id });
          const parsed = Array.isArray(data) ? data : (typeof data === 'string' ? JSON.parse(data) : []);
          setTaskPool(parsed);
        } catch {}
      })();
    }
  }, [refreshKey]);

  const mitigationCount = jobs.filter(j => MITIGATION_DIVS.includes(j.division)).length;
  const reconCount = jobs.filter(j => RECON_DIVS.includes(j.division)).length;

  const filtered = useMemo(() => {
    let list = jobs;
    if (divFilter === 'mitigation') list = list.filter(j => MITIGATION_DIVS.includes(j.division));
    else if (divFilter === 'reconstruction') list = list.filter(j => RECON_DIVS.includes(j.division));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j =>
        (j.insured_name || '').toLowerCase().includes(q) ||
        (j.job_number || '').toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [jobs, search, divFilter]);

  const onBoard = filtered.filter(j => j.on_board);
  const offBoard = filtered.filter(j => !j.on_board);

  const grouped = useMemo(() => {
    const g = { active: [], ready: [], waiting: [], leads: [], other: [] };
    for (const j of offBoard) g[classifyPhase(j.phase)].push(j);
    return g;
  }, [offBoard]);

  const groups = [
    { key: 'active', label: 'In Production', color: '#10b981', items: grouped.active },
    { key: 'ready', label: 'Ready to Start', color: '#3b82f6', items: grouped.ready },
    { key: 'waiting', label: 'Waiting', color: '#f59e0b', items: grouped.waiting },
    { key: 'leads', label: 'Leads', color: '#8b5cf6', items: grouped.leads },
    { key: 'other', label: 'Other', color: '#6b7280', items: grouped.other },
  ].filter(g => g.items.length > 0);

  // Open job detail
  const openJob = async (job) => {
    setActiveJob(job);
    setExpandedPhase(new Set());
    setPoolLoading(true);
    onSelectJob?.(job.id);
    try {
      const data = await db.rpc('get_job_task_pool', { p_job_id: job.id });
      const parsed = Array.isArray(data) ? data : (typeof data === 'string' ? JSON.parse(data) : []);
      setTaskPool(parsed);
    } catch (e) { console.error('Task pool:', e); setTaskPool([]); }
    finally { setPoolLoading(false); }
  };

  // Back to list
  const goBack = () => {
    setActiveJob(null);
    setTaskPool([]);
    setExpandedPhase(new Set());
    setSelectedTaskIds(new Set());
    setAddingTaskToPhase(null);
    setNewTaskTitle('');
    setShowAddPhase(false);
    setNewPhaseName('');
    onSelectJob?.(null);
  };

  // Refresh task pool (after creating appointment)
  const refreshPool = async () => {
    if (!activeJob) return;
    try {
      const data = await db.rpc('get_job_task_pool', { p_job_id: activeJob.id });
      const parsed = Array.isArray(data) ? data : (typeof data === 'string' ? JSON.parse(data) : []);
      setTaskPool(parsed);
    } catch {}
  };

  // ── Collapsed state ──
  if (!panelOpen) {
    return (
      <div style={P.collapsed} className="schedule-job-panel-collapsed" onClick={onTogglePanel}>
        <div style={{ fontSize: 16, color: 'var(--text-secondary)' }}>☰</div>
        <div style={P.collapsedLabel}>Jobs</div>
        <div style={P.collapsedBadge}>{jobs.filter(j => j.on_board).length}</div>
      </div>
    );
  }

  // ═════════════════════════════════════════════
  // STATE 2: Job Detail View
  // ═════════════════════════════════════════════
  if (activeJob) {
    const dc = DIV_COLORS[activeJob.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
    const isOn = activeJob.on_board;
    const today = fmtDate(new Date());

    // Schedule stats
    const totalTasks = taskPool.reduce((s, p) => s + (p.total || 0), 0);
    const completedTasks = taskPool.reduce((s, p) => s + (p.completed || 0), 0);
    const assignedTasks = taskPool.reduce((s, p) => s + (p.assigned || 0), 0);
    const unassignedTasks = totalTasks - assignedTasks;
    const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const allStarts = taskPool.filter(p => p.target_start).map(p => p.target_start);
    const allEnds = taskPool.filter(p => p.target_end).map(p => p.target_end);
    const projectStart = allStarts.length > 0 ? allStarts.sort()[0] : null;
    const projectEnd = allEnds.length > 0 ? allEnds.sort().reverse()[0] : null;

    let daysRemaining = null;
    if (projectEnd) {
      const end = new Date(projectEnd + 'T00:00:00');
      const now = new Date(); now.setHours(0, 0, 0, 0);
      daysRemaining = Math.ceil((end - now) / 86400000);
    }

    // Selection helpers
    const toggleTaskSelection = (taskId) => {
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        next.has(taskId) ? next.delete(taskId) : next.add(taskId);
        return next;
      });
    };

    const selectAllInPhase = (tasks) => {
      const selectable = tasks.filter(t => !t.is_completed && !t.appointment_id).map(t => t.id);
      const allSelected = selectable.every(id => selectedTaskIds.has(id));
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        selectable.forEach(id => allSelected ? next.delete(id) : next.add(id));
        return next;
      });
    };

    // Add task handler
    const handleAddTask = async (phaseName, phaseColor) => {
      if (!newTaskTitle.trim()) return;
      try {
        await db.rpc('add_adhoc_job_task', {
          p_job_id: activeJob.id,
          p_title: newTaskTitle.trim(),
          p_phase_name: phaseName,
          p_phase_color: phaseColor || '#6b7280',
        });
        setNewTaskTitle('');
        setAddingTaskToPhase(null);
        await refreshPool();
      } catch (e) { console.error('Add task:', e); }
    };

    // Duplicate a task (creates unassigned copy)
    const handleDuplicateTask = async (task, phaseName, phaseColor) => {
      try {
        await db.rpc('add_adhoc_job_task', {
          p_job_id: activeJob.id,
          p_title: task.title,
          p_phase_name: phaseName,
          p_phase_color: phaseColor || '#6b7280',
        });
        await refreshPool();
      } catch (e) { console.error('Duplicate task:', e); }
    };

    // Delete a task
    const handleDeleteTask = async (task) => {
      try {
        await db.delete('job_tasks', `id=eq.${task.id}`);
        setConfirmDeleteTask(null);
        await refreshPool();
      } catch (e) { console.error('Delete task:', e); errToast('Failed to delete task'); }
    };

    // Toggle task completion (un-complete also unassigns)
    const handleToggleTask = async (taskId) => {
      try {
        await db.rpc('toggle_job_task', { p_task_id: taskId, p_employee_id: null });
        await refreshPool();
      } catch (e) { console.error('Toggle task:', e); }
    };

    // Add phase handler
    const handleAddPhase = async () => {
      if (!newPhaseName.trim()) return;
      try {
        await db.rpc('add_custom_schedule_phase', {
          p_job_id: activeJob.id,
          p_phase_name: newPhaseName.trim(),
          p_phase_color: '#6b7280',
          p_duration_days: 1,
        });
        setNewPhaseName('');
        setShowAddPhase(false);
        await refreshPool();
      } catch (e) { console.error('Add phase:', e); }
    };

    // Create appointment from selected tasks
    const handleCreateFromSelected = () => {
      const ids = [...selectedTaskIds];
      // Find the earliest target_start among selected tasks' phases
      let earliestDate = null;
      for (const phase of taskPool) {
        const hasSelected = (phase.tasks || []).some(t => selectedTaskIds.has(t.id));
        if (hasSelected && phase.target_start) {
          if (!earliestDate || phase.target_start < earliestDate) earliestDate = phase.target_start;
        }
      }
      onCreateAppointment?.(activeJob.id, activeJob.insured_name, earliestDate || fmtDate(new Date()), ids);
      setSelectedTaskIds(new Set());
    };

    return (
    <>
      <div style={P.panel} className="schedule-job-panel">
        {/* Back header */}
        <div style={P.header}>
          <button onClick={goBack} style={{
            display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600,
            fontFamily: 'var(--font-sans)', padding: 0,
          }}>
            ← Jobs
          </button>
          <button style={P.closeBtn} onClick={onTogglePanel}>✕</button>
        </div>

        <div style={P.body}>
          {/* ── Job header ── */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: dc.bg, color: dc.text }}>
                {dc.label}
              </span>
              {activeJob.job_number && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>#{activeJob.job_number}</span>
              )}
              {activeJob.in_production ? (
                <span title="In production — always on schedule" style={{
                  marginLeft: 'auto', fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                  background: '#ecfdf5', color: '#10b981',
                }}>In Production</span>
              ) : (
                <div onClick={() => onToggleJob(activeJob.id, !isOn)}
                  style={{
                    marginLeft: 'auto', width: 18, height: 18, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
                    border: isOn ? 'none' : '1.5px solid var(--border-color)',
                    background: isOn ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  {isOn && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{activeJob.insured_name}</div>
            {activeJob.address && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeJob.address}
              </div>
            )}
          </div>

          {/* ── Schedule summary ── */}
          {poolLoading ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>Loading schedule...</div>
          ) : taskPool.length === 0 ? (
            <div style={{ padding: '24px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4 }}>No schedule generated</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 14 }}>Generate a schedule from a template, or add phases manually</div>
              <button onClick={() => setShowWizard(true)} style={{
                width: '100%', padding: '9px', fontSize: 12, fontWeight: 600,
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                marginBottom: 8,
              }}>
                Generate schedule & tasks
              </button>
              {showAddPhase ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', outline: 'none' }}
                    placeholder="Phase name..." value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddPhase(); if (e.key === 'Escape') { setShowAddPhase(false); setNewPhaseName(''); } }}
                    autoFocus />
                  <button onClick={handleAddPhase} style={{
                    fontSize: 11, fontWeight: 600, padding: '6px 10px', background: 'var(--accent)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  }}>Add</button>
                </div>
              ) : (
                <button onClick={() => setShowAddPhase(true)} style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)', background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                }}>or add phases manually</button>
              )}
            </div>
          ) : (
            <>
              {/* Stats row */}
              <div style={{ display: 'flex', padding: '10px 14px', gap: 6, borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: pct === 100 ? '#10b981' : 'var(--accent)' }}>{pct}%</div>
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>Done</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: unassignedTasks > 0 ? '#f59e0b' : '#10b981' }}>{unassignedTasks}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>Unsched.</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: daysRemaining !== null && daysRemaining < 0 ? '#ef4444' : 'var(--text-primary)' }}>
                    {daysRemaining !== null ? (daysRemaining < 0 ? `${Math.abs(daysRemaining)}` : daysRemaining) : '—'}
                  </div>
                  <div style={{ fontSize: 9, color: daysRemaining !== null && daysRemaining < 0 ? '#ef4444' : 'var(--text-tertiary)',
                    textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>
                    {daysRemaining !== null && daysRemaining < 0 ? 'Overdue' : 'Days left'}
                  </div>
                </div>
              </div>

              {/* Date range + progress */}
              {projectStart && (
                <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                    {fmtShortDate(projectStart)} – {fmtShortDate(projectEnd)}
                  </div>
                  <div style={{ height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#10b981' : 'var(--accent)', borderRadius: 3, transition: 'width 300ms ease' }} />
                  </div>
                </div>
              )}

              {/* ── Phase list ── */}
              <div style={{ padding: '4px 0' }}>
                {taskPool.map(phase => {
                  const total = phase.total || 0;
                  const completed = phase.completed || 0;
                  const assigned = phase.assigned || 0;
                  const unassigned = total - assigned;
                  const isDone = completed === total && total > 0;
                  const isExpanded = expandedPhase.has(phase.phase_name);
                  const tasks = phase.tasks || [];
                  const phasePct = total > 0 ? Math.round((completed / total) * 100) : 0;
                  const isBehind = !isDone && phase.target_end && phase.target_end < today;
                  const selectableTasks = tasks.filter(t => !t.is_completed && !t.appointment_id);
                  const selectedInPhase = selectableTasks.filter(t => selectedTaskIds.has(t.id)).length;
                  const showAll = showScheduledPhases.has(phase.phase_name);
                  const hiddenTasks = tasks.filter(t => t.is_completed || t.appointment_id);
                  const hiddenCount = hiddenTasks.length;

                  return (
                    <div key={phase.phase_name}>
                      {/* Phase header */}
                      <div
                        onClick={() => setExpandedPhase(prev => { const n = new Set(prev); n.has(phase.phase_name) ? n.delete(phase.phase_name) : n.add(phase.phase_name); return n; })}
                        style={{
                          padding: '8px 14px', cursor: 'pointer',
                          borderBottom: '1px solid var(--border-light)',
                          background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 2, background: phase.phase_color || '#6b7280', flexShrink: 0 }} />
                          <span style={{
                            fontSize: 12, fontWeight: 600, flex: 1,
                            color: isDone ? 'var(--text-tertiary)' : 'var(--text-primary)',
                            textDecoration: isDone ? 'line-through' : 'none',
                          }}>
                            {phase.phase_name}
                          </span>
                          {isDone && <span style={{ fontSize: 9, fontWeight: 600, color: '#10b981' }}>✓</span>}
                          {isBehind && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#fef2f2', color: '#ef4444' }}>Behind</span>
                          )}
                          {!isDone && unassigned > 0 && !isBehind && (
                            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fef3c7', color: '#92400e' }}>{unassigned}</span>
                          )}
                          {selectedInPhase > 0 && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'var(--accent-light)', color: 'var(--accent)' }}>{selectedInPhase} sel</span>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)',
                            transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '150ms' }}>▾</span>
                        </div>

                        {/* Dates + progress */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, paddingLeft: 12 }}>
                          {phase.target_start && (
                            <span style={{ fontSize: 10, color: isBehind ? '#ef4444' : 'var(--text-tertiary)' }}>
                              {fmtShortDate(phase.target_start)}
                              {phase.target_end && phase.target_end !== phase.target_start && ` – ${fmtShortDate(phase.target_end)}`}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{completed}/{total}</span>
                        </div>
                        {total > 0 && (
                          <div style={{ height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden', marginTop: 4, marginLeft: 12 }}>
                            <div style={{ width: `${phasePct}%`, height: '100%',
                              background: isDone ? '#10b981' : (phase.phase_color || 'var(--accent)'), borderRadius: 2 }} />
                          </div>
                        )}
                      </div>

                      {/* Expanded tasks */}
                      {isExpanded && (
                        <div style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
                          {/* Select all open */}
                          {selectableTasks.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px 3px 32px' }}>
                              <div onClick={() => selectAllInPhase(tasks)}
                                style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flex: 1 }}>
                                <span style={{
                                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                  border: selectedInPhase === selectableTasks.length && selectableTasks.length > 0
                                    ? '1.5px solid var(--accent)' : '1.5px solid var(--border-color)',
                                  background: selectedInPhase === selectableTasks.length && selectableTasks.length > 0
                                    ? 'var(--accent)' : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {selectedInPhase === selectableTasks.length && selectableTasks.length > 0 && (
                                    <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>
                                  )}
                                </span>
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                                  Select all open ({selectableTasks.length})
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Open/unassigned tasks */}
                          {selectableTasks.map(task => {
                            const isSelected = selectedTaskIds.has(task.id);
                            return (
                              <div key={task.id}
                                onClick={() => toggleTaskSelection(task.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px 5px 32px',
                                  cursor: 'pointer',
                                  background: isSelected ? 'var(--accent-light)' : 'transparent',
                                }}>
                                <span style={{
                                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                  border: isSelected ? '1.5px solid var(--accent)' : '1.5px solid var(--border-color)',
                                  background: isSelected ? 'var(--accent)' : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {isSelected && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                                </span>
                                <span style={{ fontSize: 11, flex: 1, color: 'var(--text-primary)' }}>
                                  {task.title}
                                </span>
                                <button onClick={e => { e.stopPropagation(); handleDuplicateTask(task, phase.phase_name, phase.phase_color); }}
                                  title="Duplicate task"
                                  style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none',
                                    cursor: 'pointer', padding: '0 3px', opacity: 0.4, flexShrink: 0, lineHeight: 1 }}
                                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                  onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}>⧉</button>
                                {confirmDeleteTask === task.id ? (
                                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                    {task.appointment_id && <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 600 }}>Scheduled!</span>}
                                    <button onClick={() => handleDeleteTask(task)} style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: '0 2px', fontFamily: 'var(--font-sans)' }}>Del</button>
                                    <button onClick={() => setConfirmDeleteTask(null)} style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'var(--font-sans)' }}>✕</button>
                                  </div>
                                ) : (
                                  <button onClick={e => { e.stopPropagation(); setConfirmDeleteTask(task.id); }}
                                    title="Delete task"
                                    style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none',
                                      cursor: 'pointer', padding: '0 3px', opacity: 0.4, flexShrink: 0, lineHeight: 1 }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}>✕</button>
                                )}
                              </div>
                            );
                          })}

                          {selectableTasks.length === 0 && hiddenCount === 0 && (
                            <div style={{ padding: '8px 14px 4px 32px', fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                              No tasks in this phase
                            </div>
                          )}

                          {/* Add task inline */}
                          {addingTaskToPhase === phase.phase_name ? (
                            <div style={{ display: 'flex', gap: 4, padding: '6px 14px 6px 32px' }}>
                              <input style={{ flex: 1, padding: '5px 8px', fontSize: 11, border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', outline: 'none', background: '#fff' }}
                                placeholder="Task name..." value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleAddTask(phase.phase_name, phase.phase_color);
                                  if (e.key === 'Escape') { setAddingTaskToPhase(null); setNewTaskTitle(''); }
                                }}
                                autoFocus />
                              <button onClick={() => handleAddTask(phase.phase_name, phase.phase_color)} style={{
                                fontSize: 10, fontWeight: 600, padding: '4px 8px', background: 'var(--accent)', color: '#fff',
                                border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0,
                              }}>Add</button>
                            </div>
                          ) : (
                            <button onClick={() => { setAddingTaskToPhase(phase.phase_name); setNewTaskTitle(''); }}
                              style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none',
                                cursor: 'pointer', padding: '5px 14px 6px 32px', fontFamily: 'var(--font-sans)', fontWeight: 500, textAlign: 'left', width: '100%' }}>
                              + Add task
                            </button>
                          )}

                          {/* Collapsible: Scheduled & Completed tasks */}
                          {hiddenCount > 0 && (
                            <>
                              <div onClick={e => {
                                e.stopPropagation();
                                setShowScheduledPhases(prev => {
                                  const n = new Set(prev);
                                  n.has(phase.phase_name) ? n.delete(phase.phase_name) : n.add(phase.phase_name);
                                  return n;
                                });
                              }} style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px 5px 32px',
                                cursor: 'pointer', borderTop: '1px solid var(--border-light)',
                              }}>
                                <span style={{ fontSize: 10, color: 'var(--text-tertiary)',
                                  transform: showAll ? 'rotate(180deg)' : 'none', transition: '150ms' }}>▾</span>
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>
                                  Scheduled & Completed ({hiddenCount})
                                </span>
                              </div>
                              {showAll && hiddenTasks.map(task => (
                                <div key={task.id}
                                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px 4px 32px' }}>
                                  <span onClick={() => handleToggleTask(task.id)}
                                    title={task.is_completed ? 'Mark incomplete — returns to open tasks' : 'Mark complete'}
                                    style={{
                                    width: 14, height: 14, borderRadius: 3, flexShrink: 0, cursor: 'pointer',
                                    border: task.is_completed ? 'none' : '1.5px solid var(--border-color)',
                                    background: task.is_completed ? '#10b981' : (task.appointment_id ? '#dbeafe' : 'transparent'),
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    transition: 'all 100ms ease',
                                  }}>
                                    {task.is_completed && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                                  </span>
                                  <span style={{ fontSize: 11, flex: 1,
                                    color: task.is_completed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                                    textDecoration: task.is_completed ? 'line-through' : 'none' }}>
                                    {task.title}
                                  </span>
                                  <button onClick={e => { e.stopPropagation(); handleDuplicateTask(task, phase.phase_name, phase.phase_color); }}
                                    title="Duplicate task"
                                    style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none',
                                      cursor: 'pointer', padding: '0 3px', opacity: 0.4, flexShrink: 0, lineHeight: 1 }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                    onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}>⧉</button>
                                  {confirmDeleteTask === task.id ? (
                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                      {task.appointment_id && <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 600 }}>Scheduled!</span>}
                                      <button onClick={() => handleDeleteTask(task)} style={{ fontSize: 10, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: '0 2px', fontFamily: 'var(--font-sans)' }}>Del</button>
                                      <button onClick={() => setConfirmDeleteTask(null)} style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'var(--font-sans)' }}>✕</button>
                                    </div>
                                  ) : (
                                    <button onClick={e => { e.stopPropagation(); setConfirmDeleteTask(task.id); }}
                                      title="Delete task"
                                      style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none',
                                        cursor: 'pointer', padding: '0 3px', opacity: 0.4, flexShrink: 0, lineHeight: 1 }}
                                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
                                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}>✕</button>
                                  )}
                                  {task.is_completed ? (
                                    <span style={{ fontSize: 8, fontWeight: 600, color: '#10b981' }}>DONE</span>
                                  ) : (
                                    <span style={{ fontSize: 8, fontWeight: 600, color: '#2563eb', background: '#eff6ff', padding: '1px 4px', borderRadius: 3 }}>SCHED</span>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add phase */}
                {showAddPhase ? (
                  <div style={{ display: 'flex', gap: 4, padding: '8px 14px' }}>
                    <input style={{ flex: 1, padding: '6px 8px', fontSize: 12, border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-sans)', outline: 'none' }}
                      placeholder="Phase name..." value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddPhase(); if (e.key === 'Escape') { setShowAddPhase(false); setNewPhaseName(''); } }}
                      autoFocus />
                    <button onClick={handleAddPhase} style={{
                      fontSize: 11, fontWeight: 600, padding: '6px 10px', background: 'var(--accent)', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    }}>Add</button>
                    <button onClick={() => { setShowAddPhase(false); setNewPhaseName(''); }} style={{
                      fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setShowAddPhase(true)}
                    style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '8px 14px', fontFamily: 'var(--font-sans)', textAlign: 'left', width: '100%',
                      borderTop: '1px solid var(--border-light)' }}>
                    + Add phase
                  </button>
                )}
              </div>

              {/* ── Bottom action bar ── */}
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                {selectedTaskIds.size > 0 ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={handleCreateFromSelected}
                      style={{
                        flex: 1, padding: '9px', fontSize: 12, fontWeight: 600,
                        background: 'var(--accent)', color: '#fff', border: 'none',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      }}>
                      Schedule {selectedTaskIds.size} task{selectedTaskIds.size !== 1 ? 's' : ''}
                    </button>
                    <button onClick={() => setSelectedTaskIds(new Set())}
                      style={{
                        padding: '9px 12px', fontSize: 12, fontWeight: 500,
                        background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      }}>
                      Clear
                    </button>
                  </div>
                ) : (
                  <button onClick={() => {
                    onCreateAppointment?.(activeJob.id, activeJob.insured_name, fmtDate(new Date()), []);
                  }}
                    style={{
                      width: '100%', padding: '9px', fontSize: 12, fontWeight: 600,
                      background: 'var(--accent)', color: '#fff', border: 'none',
                      borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    }}>
                    + Create appointment
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Schedule Wizard */}
      {showWizard && activeJob && (
        <ScheduleWizard
          jobId={activeJob.id}
          jobName={activeJob.insured_name || 'Job'}
          onClose={() => setShowWizard(false)}
          onGenerated={() => { setShowWizard(false); openJob(activeJob); onRefreshPanel?.(); }}
        />
      )}
    </>
    );
  }

  // ═════════════════════════════════════════════
  // STATE 1: Job List
  // ═════════════════════════════════════════════
  return (
    <div style={P.panel} className="schedule-job-panel">
      <div style={P.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Jobs</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
            background: 'var(--accent-light)', color: 'var(--accent)',
          }}>
            {onBoard.length} on schedule
          </span>
        </div>
        <button style={P.closeBtn} onClick={onTogglePanel}>✕</button>
      </div>

      <div style={P.searchWrap}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {[
            { key: 'all', label: `All (${jobs.length})` },
            { key: 'mitigation', label: `Mitigation (${mitigationCount})` },
            { key: 'reconstruction', label: `Recon (${reconCount})` },
          ].map(f => (
            <button key={f.key} onClick={() => changeDivFilter(f.key)} style={{
              flex: 1, fontSize: 11, fontWeight: 600, padding: '5px 0', borderRadius: 'var(--radius-md)',
              border: divFilter === f.key ? '1px solid var(--accent)' : '1px solid var(--border-color)',
              background: divFilter === f.key ? 'var(--accent-light)' : 'var(--bg-primary)',
              color: divFilter === f.key ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 120ms ease',
            }}>{f.label}</button>
          ))}
        </div>
        <input style={P.searchInput} placeholder="Search jobs..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      <div style={P.body}>
        {loading && <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading jobs...</div>}

        {/* On Schedule (production + pinned) */}
        {onBoard.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={P.groupHead}>
              <span style={{ ...P.dot, background: '#10b981' }} />
              On Schedule ({onBoard.length})
            </div>
            {onBoard.map(j => (
              <JobRow key={j.id} job={j} onToggle={onToggleJob} isOn onOpen={() => openJob(j)} />
            ))}
          </div>
        )}

        {onBoard.length > 0 && groups.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border-color)', margin: '4px 0 8px' }} />
        )}

        {/* Off-board groups */}
        {groups.map(g => (
          <div key={g.key} style={{ marginBottom: 2 }}>
            <div style={{ ...P.groupHead, cursor: 'pointer' }}
              onClick={() => setExpandedGroup(expandedGroup === g.key ? null : g.key)}>
              <span style={{ ...P.dot, background: g.color }} />
              {g.label} ({g.items.length})
              <span style={{
                marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)',
                transform: expandedGroup === g.key ? 'rotate(180deg)' : 'none', transition: '150ms ease',
              }}>▾</span>
            </div>
            {expandedGroup === g.key && g.items.map(j => (
              <JobRow key={j.id} job={j} onToggle={onToggleJob} isOn={false} onOpen={() => openJob(j)} />
            ))}
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center' }}>
            No jobs match
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, onToggle, isOn, onOpen }) {
  const dc = DIV_COLORS[job.division] || { bg: '#f1f3f5', text: '#6b7280', label: '' };
  const isProduction = job.in_production;
  return (
    <div style={{ ...P.jobRow, background: isOn ? 'var(--accent-light)' : 'transparent' }}>
      {/* Name area — click to open detail */}
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen?.()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={P.jobName}>{job.insured_name}</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 600, padding: '0 5px', borderRadius: 3, background: dc.bg, color: dc.text }}>
            {dc.label}
          </span>
          {job.job_number && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>#{job.job_number}</span>
          )}
          {job.appointment_count > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{job.appointment_count} appt{job.appointment_count !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      {/* Production jobs: auto indicator (no toggle). Others: checkbox toggle */}
      {isProduction ? (
        <div title="In production — always on schedule" style={{
          width: 20, height: 20, borderRadius: 4, flexShrink: 0,
          background: '#10b981',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>
        </div>
      ) : (
        <div onClick={e => { e.stopPropagation(); onToggle(job.id, !isOn); }}
          style={{
            width: 20, height: 20, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
            border: isOn ? 'none' : '1.5px solid var(--border-color)',
            background: isOn ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          {isOn && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
        </div>
      )}
    </div>
  );
}

const P = {
  collapsed: {
    width: 40, background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12, gap: 8,
    cursor: 'pointer', flexShrink: 0,
  },
  collapsedLabel: {
    writingMode: 'vertical-rl', fontSize: 12, fontWeight: 600,
    color: 'var(--text-secondary)', letterSpacing: '0.05em',
  },
  collapsedBadge: {
    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
    background: 'var(--accent-light)', padding: '2px 6px', borderRadius: 99,
  },
  panel: {
    width: 300, background: 'var(--bg-primary)', borderRight: '1px solid var(--border-color)',
    display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  closeBtn: { fontSize: 14, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 },
  searchWrap: { padding: '8px 12px', borderBottom: '1px solid var(--border-light)', flexShrink: 0 },
  searchInput: {
    width: '100%', padding: '6px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-sans)',
    outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-primary)',
  },
  body: { flex: 1, overflowY: 'auto', padding: '0' },
  groupHead: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: 'var(--text-tertiary)', userSelect: 'none',
  },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  jobRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
    cursor: 'pointer', borderBottom: '1px solid var(--border-light)',
  },
  jobName: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
};

export default JobPanel;
