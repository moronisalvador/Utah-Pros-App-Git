import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ScheduleWizard from '@/components/ScheduleWizard';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DIV_COLORS = {
  water:          { bg: '#dbeafe', text: '#1e40af', label: 'Water' },
  mold:           { bg: '#fce7f3', text: '#9d174d', label: 'Mold' },
  reconstruction: { bg: '#fef3c7', text: '#92400e', label: 'Recon' },
  fire:           { bg: '#fee2e2', text: '#991b1b', label: 'Fire' },
  contents:       { bg: '#d1fae5', text: '#065f46', label: 'Contents' },
};

const TYPE_COLORS = {
  monitoring: '#3b82f6', mitigation: '#0ea5e9', inspection: '#8b5cf6',
  reconstruction: '#f59e0b', estimate: '#10b981', delivery: '#6b7280',
  mold_remediation: '#059669', content_cleaning: '#8b5cf6', other: '#6b7280',
};

const APPT_TYPES = [
  { value: 'reconstruction', label: 'Reconstruction' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'mitigation', label: 'Mitigation' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABELS = {
  scheduled:   { label: 'Scheduled', color: '#3b82f6' },
  en_route:    { label: 'En Route',  color: '#f59e0b' },
  in_progress: { label: 'Active',    color: '#10b981' },
  paused:      { label: 'Paused',    color: '#ef4444' },
  completed:   { label: 'Done',      color: '#6b7280' },
  cancelled:   { label: 'Cancelled', color: '#9ca3af' },
};

// Map phases to panel groups
const ACTIVE_PHASES = [
  'emergency_response', 'mitigation_in_progress', 'drying', 'monitoring',
  'mold_remediation', 'content_packout', 'content_cleaning', 'content_storage',
  'demo_in_progress', 'reconstruction_in_progress', 'reconstruction_punch_list',
  'supplement_in_progress',
];
const READY_PHASES = ['job_received', 'estimate_submitted', 'estimate_approved', 'work_authorized'];
const WAITING_PHASES = [
  'pending_inspection', 'waiting_on_insurance', 'waiting_on_payment',
  'waiting_on_client', 'waiting_on_adjuster', 'on_hold',
  'supplement_submitted', 'supplement_review',
];
const LEAD_PHASES = ['lead'];

function classifyPhase(phase) {
  if (ACTIVE_PHASES.includes(phase)) return 'active';
  if (READY_PHASES.includes(phase)) return 'ready';
  if (WAITING_PHASES.includes(phase)) return 'waiting';
  if (LEAD_PHASES.includes(phase)) return 'leads';
  return 'other';
}

const WEEKDAYS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return date;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtShort(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m}${hr >= 12 ? 'p' : 'a'}`;
}

// ═══════════════════════════════════════════════════════════════
// JOB PANEL — Two-state: Job List ↔ Job Detail
// ═══════════════════════════════════════════════════════════════

const MITIGATION_DIVS = ['water', 'mold', 'fire', 'contents'];
const RECON_DIVS = ['reconstruction'];

function fmtShortDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
      <div style={P.collapsed} onClick={onTogglePanel}>
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
      <div style={P.panel}>
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
                  const visibleTasks = showAll ? tasks : selectableTasks;
                  const hiddenCount = tasks.length - selectableTasks.length;

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
                          {/* Toolbar: Select all + eye toggle */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px 3px 32px' }}>
                            {selectableTasks.length > 0 && (
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
                            )}
                            {hiddenCount > 0 && (
                              <button onClick={e => {
                                e.stopPropagation();
                                setShowScheduledPhases(prev => {
                                  const n = new Set(prev);
                                  n.has(phase.phase_name) ? n.delete(phase.phase_name) : n.add(phase.phase_name);
                                  return n;
                                });
                              }} style={{
                                display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none',
                                cursor: 'pointer', fontSize: 10, color: showAll ? 'var(--accent)' : 'var(--text-tertiary)',
                                fontFamily: 'var(--font-sans)', padding: '2px 4px', marginLeft: 'auto', flexShrink: 0,
                              }} title={showAll ? 'Hide scheduled/done' : `Show ${hiddenCount} scheduled/done`}>
                                <span style={{ fontSize: 13 }}>{showAll ? '👁' : '👁‍🗨'}</span>
                                <span>{hiddenCount}</span>
                              </button>
                            )}
                          </div>

                          {visibleTasks.map(task => {
                            const isSelectable = !task.is_completed && !task.appointment_id;
                            const isSelected = selectedTaskIds.has(task.id);
                            return (
                              <div key={task.id}
                                onClick={() => isSelectable && toggleTaskSelection(task.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px 5px 32px',
                                  cursor: isSelectable ? 'pointer' : 'default',
                                  background: isSelected ? 'var(--accent-light)' : 'transparent',
                                }}>
                                {isSelectable ? (
                                  <span style={{
                                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                    border: isSelected ? '1.5px solid var(--accent)' : '1.5px solid var(--border-color)',
                                    background: isSelected ? 'var(--accent)' : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    {isSelected && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                                  </span>
                                ) : (
                                  <span style={{
                                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                                    border: task.is_completed ? 'none' : '1.5px solid var(--border-color)',
                                    background: task.is_completed ? '#10b981' : (task.appointment_id ? '#dbeafe' : 'transparent'),
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    {task.is_completed && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                                  </span>
                                )}
                                <span style={{ fontSize: 11, flex: 1,
                                  color: task.is_completed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                                  textDecoration: task.is_completed ? 'line-through' : 'none' }}>
                                  {task.title}
                                </span>
                                {task.is_completed ? (
                                  <span style={{ fontSize: 8, fontWeight: 600, color: '#10b981' }}>DONE</span>
                                ) : task.appointment_id ? (
                                  <span style={{ fontSize: 8, fontWeight: 600, color: '#2563eb', background: '#eff6ff', padding: '1px 4px', borderRadius: 3 }}>SCHED</span>
                                ) : null}
                              </div>
                            );
                          })}

                          {/* No open tasks message */}
                          {selectableTasks.length === 0 && !showAll && (
                            <div style={{ padding: '8px 14px 4px 32px', fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                              All tasks scheduled or done
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
    <div style={P.panel}>
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

// ═══════════════════════════════════════════════════════════════
// APPOINTMENT CARD
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
// CREATE APPOINTMENT MODAL
// ═══════════════════════════════════════════════════════════════

function CreateAppointmentModal({ jobId, jobName, dateKey, prefillTaskIds = [], db, employees, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dateKey);
  const [type, setType] = useState('reconstruction');
  const [timeStart, setTimeStart] = useState('07:00');
  const [timeEnd, setTimeEnd] = useState('15:30');
  const [notes, setNotes] = useState('');
  const [selectedCrew, setSelectedCrew] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([...prefillTaskIds]);
  const [taskPool, setTaskPool] = useState([]);
  const [saving, setSaving] = useState(false);
  const [poolLoading, setPoolLoading] = useState(true);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const data = await db.rpc('get_unassigned_tasks', { p_job_id: jobId });
        setTaskPool(Array.isArray(data) ? data : []);
        if (prefillTaskIds.length > 0) setSelectedTasks([...prefillTaskIds]);
      } catch (e) { console.error('Load task pool:', e); }
      finally { setPoolLoading(false); }
    })();
  }, [db, jobId]);

  // All tasks flat for lookup
  const allTasks = useMemo(() => {
    const map = {};
    for (const g of taskPool) for (const t of (g.tasks || [])) map[t.id] = { ...t, phase_name: g.phase_name, phase_color: g.phase_color };
    return map;
  }, [taskPool]);

  // Selected task objects grouped by phase
  const assignedByPhase = useMemo(() => {
    const groups = {};
    for (const id of selectedTasks) {
      const t = allTasks[id];
      if (!t) continue;
      if (!groups[t.phase_name]) groups[t.phase_name] = { phase_name: t.phase_name, phase_color: t.phase_color, tasks: [] };
      groups[t.phase_name].tasks.push(t);
    }
    return Object.values(groups);
  }, [selectedTasks, allTasks]);

  // Unselected tasks for the picker
  const availableTasks = useMemo(() => {
    const q = taskSearch.toLowerCase();
    return taskPool.map(g => ({
      ...g,
      tasks: (g.tasks || []).filter(t => !selectedTasks.includes(t.id) && (!q || t.title.toLowerCase().includes(q))),
    })).filter(g => g.tasks.length > 0);
  }, [taskPool, selectedTasks, taskSearch]);

  const toggleCrew = (empId) => {
    setSelectedCrew(prev => {
      const exists = prev.find(c => c.employee_id === empId);
      if (exists) return prev.filter(c => c.employee_id !== empId);
      return [...prev, { employee_id: empId, role: prev.length === 0 ? 'lead' : 'tech' }];
    });
  };

  const removeTask = (taskId) => {
    setSelectedTasks(prev => prev.filter(id => id !== taskId));
  };

  const addTask = (taskId) => {
    setSelectedTasks(prev => [...prev, taskId]);
  };

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
  };

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const handleSave = async () => {
    const finalTitle = title.trim() || (assignedByPhase.length > 0
      ? assignedByPhase.map(g => g.phase_name).join(' + ')
      : `Appointment ${dateLabel}`);
    setSaving(true);
    try {
      const apptResult = await db.insert('appointments', {
        job_id: jobId,
        title: finalTitle,
        date: date,
        time_start: timeStart || null,
        time_end: timeEnd || null,
        type,
        status: 'scheduled',
        notes: notes.trim() || null,
      });
      const apptId = apptResult[0]?.id;
      if (!apptId) throw new Error('Failed to create appointment');

      if (selectedCrew.length > 0) {
        for (const crew of selectedCrew) {
          await db.insert('appointment_crew', {
            appointment_id: apptId,
            employee_id: crew.employee_id,
            role: crew.role,
          });
        }
      }

      if (selectedTasks.length > 0) {
        await db.rpc('assign_tasks_to_appointment', {
          p_appointment_id: apptId,
          p_task_ids: selectedTasks,
        });
      }

      onSaved(date);
    } catch (e) {
      console.error('Save appointment:', e);
      alert('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={M.overlay}>
      <div style={M.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={M.header}>
          <div>
            <div style={M.headerTitle}>New appointment</div>
            <div style={M.headerSub}>{jobName} — {dateLabel}</div>
          </div>
          <button style={M.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={M.body}>
          {/* Title */}
          <div style={M.field}>
            <label style={M.label}>Title</label>
            <input style={M.input} value={title} onChange={e => setTitle(e.target.value)}
              placeholder={assignedByPhase.length > 0 ? assignedByPhase.map(g => g.phase_name).join(' + ') : 'e.g. Drywall — tape and mud'}
              autoFocus />
          </div>

          {/* Date + Type */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>Date</label>
              <input type="date" style={M.input} value={date}
                onChange={e => setDate(e.target.value)} />
            </div>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>Type</label>
              <select style={M.input} value={type} onChange={e => setType(e.target.value)}>
                {APPT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Start + End */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>Start</label>
              <input type="time" style={M.input} value={timeStart}
                onChange={e => setTimeStart(e.target.value)} />
            </div>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>End</label>
              <input type="time" style={M.input} value={timeEnd}
                onChange={e => setTimeEnd(e.target.value)} />
            </div>
          </div>

          {/* Notes */}
          <div style={M.field}>
            <label style={M.label}>Notes</label>
            <textarea style={{ ...M.input, minHeight: 48, resize: 'vertical' }} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Instructions for the crew..." />
          </div>

          {/* ── Crew with initials circles ── */}
          <div style={M.section}>
            <div style={M.sectionTitle}>
              Crew
              {selectedCrew.length > 0 && <span style={M.sectionBadge}>{selectedCrew.length}</span>}
            </div>
            <div style={M.crewGrid}>
              {employees.map(emp => {
                const sel = selectedCrew.find(c => c.employee_id === emp.id);
                const initials = getInitials(emp.display_name || emp.full_name);
                return (
                  <button key={emp.id} onClick={() => toggleCrew(emp.id)} style={{
                    ...M.crewChip,
                    background: sel ? 'var(--accent-light)' : 'var(--bg-primary)',
                    borderColor: sel ? 'var(--accent)' : 'var(--border-color)',
                    color: sel ? 'var(--accent)' : 'var(--text-secondary)',
                  }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 13, flexShrink: 0,
                      background: sel ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: sel ? '#fff' : 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>{initials}</span>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>
                      {emp.display_name || emp.full_name}
                    </span>
                    {sel && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 3,
                        background: sel.role === 'lead' ? '#fffbeb' : 'transparent',
                        color: sel.role === 'lead' ? '#92400e' : 'var(--text-tertiary)',
                      }}>{sel.role === 'lead' ? 'LEAD' : 'TECH'}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Assigned Tasks ── */}
          <div style={M.section}>
            <div style={M.sectionTitle}>
              Tasks
              <span style={M.sectionBadge}>{selectedTasks.length}</span>
            </div>

            {assignedByPhase.length === 0 && !showTaskPicker && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0 8px' }}>
                No tasks assigned yet
              </div>
            )}

            {assignedByPhase.map(group => (
              <div key={group.phase_name} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: group.phase_color || '#6b7280', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>{group.phase_name}</span>
                </div>
                {group.tasks.map(task => (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0 3px 14px' }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--accent)', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>
                    </span>
                    <span style={{ fontSize: 12, flex: 1, color: 'var(--text-primary)' }}>{task.title}</span>
                    <button onClick={() => removeTask(task.id)} style={{
                      fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '2px 4px',
                    }}>✕</button>
                  </div>
                ))}
              </div>
            ))}

            {/* Add more tasks toggle */}
            {!showTaskPicker ? (
              <button onClick={() => setShowTaskPicker(true)} style={{
                fontSize: 12, fontWeight: 500, color: 'var(--accent)', background: 'none', border: 'none',
                cursor: 'pointer', padding: '6px 0', fontFamily: 'var(--font-sans)',
              }}>+ Add tasks</button>
            ) : (
              <div style={{ marginTop: 6, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <input style={{ ...M.input, border: 'none', borderBottom: '1px solid var(--border-light)', borderRadius: 0 }}
                  placeholder="Search tasks..." value={taskSearch} onChange={e => setTaskSearch(e.target.value)} autoFocus />
                <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {poolLoading && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>Loading...</div>}
                  {availableTasks.map(group => (
                    <div key={group.phase_name}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'var(--bg-secondary)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: group.phase_color || '#6b7280' }} />
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>{group.phase_name}</span>
                      </div>
                      {group.tasks.map(task => (
                        <div key={task.id} onClick={() => addTask(task.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 6px 20px',
                            cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <span style={{ fontSize: 12, flex: 1, color: 'var(--text-primary)' }}>{task.title}</span>
                          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>+</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {!poolLoading && availableTasks.length === 0 && (
                    <div style={{ padding: 10, fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                      {taskSearch ? 'No matching tasks' : 'All tasks assigned'}
                    </div>
                  )}
                </div>
                <button onClick={() => { setShowTaskPicker(false); setTaskSearch(''); }}
                  style={{ width: '100%', padding: '6px', fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)',
                    border: 'none', borderTop: '1px solid var(--border-light)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={M.footer}>
          <button style={M.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...M.saveBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : `Create appointment${selectedTasks.length > 0 ? ` (${selectedTasks.length} tasks)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const M = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 1000, paddingTop: 40, overflow: 'auto',
  },
  modal: {
    background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)',
    width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 80px)',
    display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  headerTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' },
  headerSub: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  closeBtn: {
    fontSize: 16, color: 'var(--text-tertiary)', background: 'none',
    border: 'none', cursor: 'pointer', padding: 4,
  },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  field: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)',
  },
  section: {
    marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-light)',
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: 'var(--text-tertiary)', marginBottom: 10,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  sectionBadge: {
    fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
    background: 'var(--accent-light)', color: 'var(--accent)', textTransform: 'none',
    letterSpacing: 0,
  },
  crewGrid: {
    display: 'flex', flexWrap: 'wrap', gap: 6,
  },
  crewChip: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
    cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 100ms ease',
    background: 'var(--bg-primary)',
  },
  phaseHeader: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
    cursor: 'pointer', userSelect: 'none',
    borderBottom: '1px solid var(--border-light)',
  },
  taskRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0 5px 18px',
    cursor: 'pointer', borderBottom: '1px solid var(--border-light)',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0,
  },
  cancelBtn: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
  saveBtn: {
    fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
};

// ═══════════════════════════════════════════════════════════════
// CALENDAR VIEW (HouseCall Pro style — hours × days)
// ═══════════════════════════════════════════════════════════════

const CAL_START_HOUR = 7;
const CAL_END_HOUR = 18;
const CAL_HOUR_HEIGHT = 60;
const CAL_TOTAL_HOURS = CAL_END_HOUR - CAL_START_HOUR;

function timeToMinutes(t) {
  if (!t) return CAL_START_HOUR * 60 + 60; // default 7am
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function CalendarView({ days, boardData, onApptClick, onCellClick }) {
  // Flatten all appointments with job info
  const allAppts = [];
  for (const job of boardData) {
    for (const appt of (job.appointments || [])) {
      allAppts.push({ ...appt, _jobName: job.insured_name, _jobId: job.job_id, _division: job.division });
    }
  }

  // Group by date
  const byDate = {};
  for (const a of allAppts) {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push(a);
  }

  const hours = Array.from({ length: CAL_TOTAL_HOURS }, (_, i) => CAL_START_HOUR + i);

  return (
    <div style={CV.wrap}>
      <div style={CV.grid}>
        {/* Time labels column */}
        <div style={CV.timeCol}>
          <div style={CV.timeHeader} />
          {hours.map((h, i) => (
            <div key={h} style={CV.timeLabel}>
              <span style={{
                position: 'absolute', right: 6, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500,
                top: i === 0 ? 4 : -7,
              }}>{h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`}</span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map(day => {
          const appts = byDate[day.key] || [];
          return (
            <div key={day.key} style={CV.dayCol}>
              {/* Day header */}
              <div style={{ ...CV.dayHeader, ...(day.isToday ? { background: '#f0f7ff' } : {}) }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: day.isToday ? '#2563eb' : 'var(--text-secondary)' }}>{day.label}</div>
                <div style={{ fontSize: 11, color: day.isToday ? '#2563eb' : 'var(--text-tertiary)', fontWeight: day.isToday ? 600 : 400 }}>{day.shortDate}</div>
              </div>

              {/* Hour grid + appointment blocks */}
              <div style={CV.dayBody}>
                {/* Hour lines */}
                {hours.map(h => (
                  <div key={h} style={{ ...CV.hourLine, top: (h - CAL_START_HOUR) * CAL_HOUR_HEIGHT }}
                    onClick={() => {
                      // Find first job on board to create appointment
                      if (boardData.length > 0) onCellClick(boardData[0].job_id, day.key);
                    }} />
                ))}

                {/* Now line */}
                {day.isToday && (() => {
                  const now = new Date();
                  const mins = now.getHours() * 60 + now.getMinutes();
                  const top = ((mins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
                  if (top < 0 || top > CAL_TOTAL_HOURS * CAL_HOUR_HEIGHT) return null;
                  return (
                    <div style={{ position: 'absolute', top, left: 0, right: 0, height: 2, background: '#ef4444', zIndex: 5, pointerEvents: 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: '#ef4444', position: 'absolute', left: -4, top: -3 }} />
                    </div>
                  );
                })()}

                {/* Appointment blocks */}
                {appts.map(appt => {
                  const startMins = timeToMinutes(appt.time_start);
                  const endMins = appt.time_end ? timeToMinutes(appt.time_end) : startMins + 60;
                  const top = ((startMins - CAL_START_HOUR * 60) / 60) * CAL_HOUR_HEIGHT;
                  const height = Math.max(((endMins - startMins) / 60) * CAL_HOUR_HEIGHT, 28);
                  const color = appt.color || TYPE_COLORS[appt.type] || '#6b7280';
                  const dc = DIV_COLORS[appt._division] || { bg: '#f1f3f5', text: '#6b7280' };
                  const isDone = appt.status === 'completed';
                  const crew = appt.crew || [];

                  return (
                    <div key={appt.id} onClick={e => { e.stopPropagation(); onApptClick(appt); }}
                      style={{
                        position: 'absolute', top, left: 2, right: 2, height: Math.max(height - 2, 26),
                        background: dc.bg, borderLeft: `3px solid ${color}`, borderRadius: 0,
                        padding: '3px 6px', overflow: 'hidden', cursor: 'pointer', zIndex: 2,
                        opacity: isDone ? 0.5 : 1,
                      }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: dc.text, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {appt._jobName}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: dc.text, opacity: 0.8, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {appt.title}
                      </div>
                      {height > 50 && crew.length > 0 && (
                        <div style={{ fontSize: 9, color: dc.text, opacity: 0.7, marginTop: 2 }}>
                          {crew.map(c => c.display_name || c.full_name?.split(' ')[0]).join(', ')}
                        </div>
                      )}
                      {height > 70 && appt.time_start && (
                        <div style={{ fontSize: 9, color: dc.text, opacity: 0.6, marginTop: 1 }}>
                          {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CV = {
  wrap: { flex: 1, overflow: 'auto' },
  grid: { display: 'flex', minWidth: 600 },
  timeCol: { width: 52, flexShrink: 0, borderRight: '1px solid var(--border-color)' },
  timeHeader: { height: 44, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' },
  timeLabel: { height: CAL_HOUR_HEIGHT, position: 'relative' },
  dayCol: { flex: 1, minWidth: 120, borderRight: '1px solid var(--border-light)' },
  dayHeader: {
    height: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', flexShrink: 0,
  },
  dayBody: {
    position: 'relative', height: CAL_TOTAL_HOURS * CAL_HOUR_HEIGHT,
  },
  hourLine: {
    position: 'absolute', left: 0, right: 0, height: CAL_HOUR_HEIGHT,
    borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
  },
};

// ═══════════════════════════════════════════════════════════════
// MAIN: SCHEDULE PAGE
// ═══════════════════════════════════════════════════════════════

export default function Schedule() {
  const { db, employee } = useAuth();

  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [boardData, setBoardData] = useState([]);
  const [panelJobs, setPanelJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState(true);
  const [showWeekend, setShowWeekend] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('upr_schedule_view') || 'calendar'; } catch { return 'calendar'; }
  });
  const changeViewMode = (mode) => {
    setViewMode(mode);
    try { localStorage.setItem('upr_schedule_view', mode); } catch {}
  };
  const [crewFilter, setCrewFilter] = useState(null); // employee_id or null = all
  const [createModal, setCreateModal] = useState(null); // { jobId, jobName, dateKey }
  const [allEmployees, setAllEmployees] = useState([]);
  const [autoShow, setAutoShow] = useState(true); // auto-include jobs with appts this week
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);

  // ── Week days ──
  const days = useMemo(() => {
    const count = showWeekend ? 7 : 5;
    const start = showWeekend ? new Date(weekStart.getTime() - 86400000) : weekStart;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = fmtDate(d);
      return { date: d, key, label: WEEKDAYS_FULL[d.getDay()], shortDate: fmtShort(d), isToday: key === fmtDate(new Date()) };
    });
  }, [weekStart, showWeekend]);

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

  useEffect(() => { loadPanelJobs(); }, [loadPanelJobs]);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  // ── Load employees for crew assignment ──
  useEffect(() => {
    db.select('employees', 'is_active=eq.true&order=display_name.asc&select=id,display_name,full_name,role')
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
    const empMap = {};  // employee_id → { id, display_name, full_name, role }
    const cells = {};   // employeeId_date → [{ appt, jobName, division }]

    for (const job of boardData) {
      for (const appt of (job.appointments || [])) {
        for (const crew of (appt.crew || [])) {
          // Track employee
          if (!empMap[crew.employee_id]) {
            empMap[crew.employee_id] = {
              id: crew.employee_id,
              display_name: crew.display_name,
              full_name: crew.full_name,
              role: crew.role, // crew role on this appt, not employee.role
            };
          }
          // Add to cell
          const k = `${crew.employee_id}_${appt.date}`;
          if (!cells[k]) cells[k] = [];
          cells[k].push({
            ...appt,
            _jobName: job.insured_name,
            _jobNumber: job.job_number,
            _division: job.division,
            _jobId: job.job_id,
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

  const goThisWeek = () => setWeekStart(getMonday(new Date()));
  const goPrev = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const goNext = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };

  const totalAppts = filteredBoardData.reduce((s, j) => s + (j.appointments?.length || 0), 0);
  const todayKey = fmtDate(new Date());
  const todayAppts = filteredBoardData.reduce((s, j) => s + (j.appointments?.filter(a => a.date === todayKey).length || 0), 0);

  const handleApptClick = (appt) => { console.log('Appointment:', appt); };
  const handleCellClick = (jobId, dateKey) => {
    const job = boardData.find(j => j.job_id === jobId);
    setCreateModal({ jobId, dateKey, jobName: job?.insured_name || 'Unknown' });
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
        onSelectJob={(jobId) => {}}
        onRefreshPanel={() => { loadPanelJobs(); loadBoard(); }}
      />

      {/* Main board */}
      <div style={S.main}>
        {/* Header */}
        <div style={S.header}>
          <div>
            <h1 style={S.title}>Schedule</h1>
            <div style={S.subtitle}>
              {fmtShort(days[0].date)} – {fmtShort(days[days.length - 1].date)}
              <span style={S.pill}>{filteredBoardData.length} jobs</span>
              <span style={S.pill}>{totalAppts} appts</span>
              {todayAppts > 0 && <span style={{ ...S.pill, background: '#eff6ff', color: '#2563eb' }}>{todayAppts} today</span>}
            </div>
          </div>
          <div style={S.controls}>
            {/* View toggle */}
            <div style={S.viewToggle}>
              <button style={{ ...S.viewBtn, ...(viewMode === 'jobs' ? S.viewBtnActive : {}) }}
                onClick={() => changeViewMode('jobs')}>Jobs</button>
              <button style={{ ...S.viewBtn, ...(viewMode === 'crew' ? S.viewBtnActive : {}) }}
                onClick={() => changeViewMode('crew')}>Crew</button>
              <button style={{ ...S.viewBtn, ...(viewMode === 'calendar' ? S.viewBtnActive : {}) }}
                onClick={() => changeViewMode('calendar')}>Calendar</button>
            </div>
            {!panelOpen && <button style={S.btn} onClick={() => setPanelOpen(true)}>Jobs</button>}
            <button style={S.btn} onClick={goThisWeek}>This week</button>
            <button style={S.btnIcon} onClick={goPrev}>‹</button>
            <button style={S.btnIcon} onClick={goNext}>›</button>
            <label style={S.checkLabel}>
              <input type="checkbox" checked={showWeekend} onChange={e => setShowWeekend(e.target.checked)} />
              <span>Wknd</span>
            </label>
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
            <button
              onClick={() => setCrewFilter(null)}
              style={{
                ...S.crewPill,
                ...(crewFilter === null ? S.crewPillActive : {}),
              }}
            >All</button>
            {crewList.map(emp => (
              <button
                key={emp.id}
                onClick={() => setCrewFilter(crewFilter === emp.id ? null : emp.id)}
                style={{
                  ...S.crewPill,
                  ...(crewFilter === emp.id ? S.crewPillActive : {}),
                }}
              >{emp.display_name || emp.full_name}</button>
            ))}
            {crewFilter && (
              <button
                onClick={() => setCrewFilter(null)}
                style={{ ...S.crewPill, color: 'var(--text-tertiary)', fontSize: 11 }}
              >Clear</button>
            )}
          </div>
        )}

        {/* Board */}
        {loading ? (
          <div style={S.center}>Loading...</div>
        ) : viewMode === 'calendar' ? (
          <CalendarView days={days} boardData={filteredBoardData} onApptClick={handleApptClick} onCellClick={handleCellClick} />
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
                        onClick={() => handleCellClick(job.job_id, day.key)}
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
                      {/* Count total appointments this week */}
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
          db={db}
          employees={allEmployees}
          onClose={() => setCreateModal(null)}
          onSaved={(savedDate) => {
            // Navigate to the week containing the appointment
            if (savedDate) setWeekStart(getMonday(new Date(savedDate + 'T00:00:00')));
            setCreateModal(null);
            loadBoard();
            setPanelRefreshKey(k => k + 1);
          }}
        />
      )}
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
