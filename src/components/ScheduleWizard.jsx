import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PHASE_COLORS = ['#6b7280','#1D9E75','#378ADD','#f59e0b','#92400e','#D85A30','#10b981','#059669','#8b5cf6','#E24B4A'];

function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtRange(s, e) { return s === e ? fmtDate(s) : `${fmtDate(s)} – ${fmtDate(e)}`; }

export default function ScheduleWizard({ jobId, jobName, onClose, onGenerated }) {
  const { db, employee } = useAuth();

  const [step, setStep] = useState('pick');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day));
    return d.toISOString().split('T')[0];
  });
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Phase/task editing state
  const [templateTasks, setTemplateTasks] = useState({}); // phase_id → [tasks]
  const [enabledPhases, setEnabledPhases] = useState(new Set());
  const [enabledTasks, setEnabledTasks] = useState(new Set());
  const [expandedPhase, setExpandedPhase] = useState(null);
  const [customTasks, setCustomTasks] = useState({}); // phase_id → [{title}]
  const [customPhases, setCustomPhases] = useState([]); // [{name, duration, color, tasks:[{title}]}]
  const [durationOverrides, setDurationOverrides] = useState({}); // phase_id → days
  const [addingTaskIn, setAddingTaskIn] = useState(null); // phase_id currently adding to
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddPhase, setShowAddPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [newPhaseDuration, setNewPhaseDuration] = useState(1);

  // Load templates
  useEffect(() => {
    db.rpc('get_schedule_templates')
      .then(data => { const l = Array.isArray(data) ? data : []; setTemplates(l); if (l.length === 1) setSelectedTemplate(l[0].id); })
      .catch(() => {});
  }, [db]);

  // Load preview + template tasks
  const loadPreview = async () => {
    if (!selectedTemplate || !startDate) return;
    setPreviewLoading(true); setError(null);
    try {
      const prev = await db.rpc('preview_schedule', {
        p_template_id: selectedTemplate,
        p_start_date: startDate,
        p_skip_weekends: skipWeekends,
        p_duration_overrides: durationOverrides,
      });
      setPreview(prev);

      // Load tasks for each phase
      const tasks = {};
      const allTaskIds = new Set();
      const allPhaseIds = new Set();
      for (const phase of (prev?.phases || [])) {
        allPhaseIds.add(phase.phase_id);
        const phaseTasks = await db.select(
          'template_tasks',
          `template_phase_id=eq.${phase.phase_id}&order=display_order.asc&select=id,title,is_required,display_order`
        );
        tasks[phase.phase_id] = phaseTasks || [];
        for (const t of (phaseTasks || [])) allTaskIds.add(t.id);
      }
      setTemplateTasks(tasks);
      setEnabledPhases(allPhaseIds);
      setEnabledTasks(allTaskIds);
      setStep('preview');
    } catch (e) { setError('Failed to preview: ' + e.message); }
    finally { setPreviewLoading(false); }
  };

  // Re-preview when dates/durations change
  const rePreview = async (newStart, newOverrides) => {
    const sd = newStart || startDate;
    const ov = newOverrides || durationOverrides;
    try {
      const prev = await db.rpc('preview_schedule', {
        p_template_id: selectedTemplate,
        p_start_date: sd,
        p_skip_weekends: skipWeekends,
        p_duration_overrides: ov,
      });
      setPreview(prev);
    } catch (e) { console.error('Re-preview:', e); }
  };

  const changeDuration = (phaseId, days) => {
    const d = Math.max(1, Math.min(30, parseInt(days) || 1));
    const next = { ...durationOverrides, [phaseId]: d };
    setDurationOverrides(next);
    rePreview(null, next);
  };

  const changeStartDate = (newDate) => {
    setStartDate(newDate);
    rePreview(newDate, null);
  };

  // Toggle phase
  const togglePhase = (phaseId) => {
    setEnabledPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
        const phaseTasks = templateTasks[phaseId] || [];
        setEnabledTasks(et => { const n = new Set(et); phaseTasks.forEach(t => n.delete(t.id)); return n; });
      } else {
        next.add(phaseId);
        const phaseTasks = templateTasks[phaseId] || [];
        setEnabledTasks(et => { const n = new Set(et); phaseTasks.forEach(t => n.add(t.id)); return n; });
      }
      return next;
    });
  };

  // Toggle individual task
  const toggleTask = (taskId) => {
    setEnabledTasks(prev => { const n = new Set(prev); n.has(taskId) ? n.delete(taskId) : n.add(taskId); return n; });
  };

  // Add custom task to a phase
  const addCustomTask = (phaseId) => {
    if (!newTaskTitle.trim()) return;
    setCustomTasks(prev => ({
      ...prev,
      [phaseId]: [...(prev[phaseId] || []), { title: newTaskTitle.trim(), id: `custom-${Date.now()}` }],
    }));
    setNewTaskTitle('');
    setAddingTaskIn(null);
  };

  // Remove custom task
  const removeCustomTask = (phaseId, customId) => {
    setCustomTasks(prev => ({
      ...prev,
      [phaseId]: (prev[phaseId] || []).filter(t => t.id !== customId),
    }));
  };

  // Add custom phase
  const addCustomPhase = () => {
    if (!newPhaseName.trim()) return;
    setCustomPhases(prev => [...prev, {
      id: `custom-phase-${Date.now()}`,
      name: newPhaseName.trim(),
      duration: newPhaseDuration,
      color: PHASE_COLORS[prev.length % PHASE_COLORS.length],
      tasks: [],
    }]);
    setNewPhaseName('');
    setNewPhaseDuration(1);
    setShowAddPhase(false);
  };

  // Add task to custom phase
  const addTaskToCustomPhase = (phaseIdx) => {
    if (!newTaskTitle.trim()) return;
    setCustomPhases(prev => prev.map((p, i) =>
      i === phaseIdx ? { ...p, tasks: [...p.tasks, { title: newTaskTitle.trim(), id: `ct-${Date.now()}` }] } : p
    ));
    setNewTaskTitle('');
    setAddingTaskIn(null);
  };

  // Remove custom phase
  const removeCustomPhase = (idx) => {
    setCustomPhases(prev => prev.filter((_, i) => i !== idx));
  };

  // Count what will be generated
  const enabledPhaseCount = (preview?.phases || []).filter(p => enabledPhases.has(p.phase_id) && !p.is_milestone).length + customPhases.length;
  const enabledTaskCount = [...enabledTasks].length
    + Object.values(customTasks).reduce((s, arr) => s + arr.length, 0)
    + customPhases.reduce((s, p) => s + p.tasks.length, 0);

  // ═══════════════════════════════════════════════════════════════
  // APPLY PLAN — creates task pool + target dates, NO appointments
  // ═══════════════════════════════════════════════════════════════
  const applyPlan = async () => {
    setStep('generating'); setError(null);
    try {
      // Build skip overrides
      const overrides = [];
      for (const p of (preview?.phases || [])) {
        if (!enabledPhases.has(p.phase_id)) {
          overrides.push({ phase_id: p.phase_id, skip: true });
        }
      }

      // 1. Apply the schedule plan (creates phases + task pool with dates, NO appointments)
      const data = await db.rpc('apply_schedule_plan', {
        p_job_id: jobId,
        p_template_id: selectedTemplate,
        p_start_date: startDate,
        p_skip_weekends: skipWeekends,
        p_phase_overrides: overrides,
        p_duration_overrides: durationOverrides,
        p_created_by: employee?.id || null,
      });

      // 2. Delete excluded tasks (tasks from enabled phases that were individually unchecked)
      const excludedTaskIds = [];
      for (const [phaseId, tasks] of Object.entries(templateTasks)) {
        if (!enabledPhases.has(phaseId)) continue;
        for (const t of tasks) {
          if (!enabledTasks.has(t.id)) excludedTaskIds.push(t.id);
        }
      }

      if (excludedTaskIds.length > 0) {
        for (const ttId of excludedTaskIds) {
          await db.delete('job_tasks', `job_id=eq.${jobId}&template_task_id=eq.${ttId}`);
        }
      }

      // 3. Add custom tasks to existing phases
      for (const [phaseId, tasks] of Object.entries(customTasks)) {
        if (!enabledPhases.has(phaseId)) continue;
        const phase = preview.phases.find(p => p.phase_id === phaseId);
        for (const t of tasks) {
          await db.rpc('add_adhoc_job_task', {
            p_job_id: jobId,
            p_title: t.title,
            p_phase_name: phase?.name || 'General',
            p_phase_color: phase?.color || '#6b7280',
            p_target_date: phase?.start_date || null,
          });
        }
      }

      // 4. Create custom phases (as schedule phases + tasks, NO appointments)
      for (const cp of customPhases) {
        // Calculate target dates for custom phase (append after last phase)
        const lastPhase = preview?.phases?.filter(p => enabledPhases.has(p.phase_id)).slice(-1)[0];
        const cpStart = lastPhase?.end_date || startDate;
        // Simple: start day after last phase end
        const startD = new Date(cpStart + 'T00:00:00');
        startD.setDate(startD.getDate() + 1);
        // Skip weekends
        if (skipWeekends) {
          while (startD.getDay() === 0 || startD.getDay() === 6) startD.setDate(startD.getDate() + 1);
        }
        const cpStartStr = startD.toISOString().split('T')[0];
        const endD = new Date(startD);
        let remaining = cp.duration - 1;
        while (remaining > 0) {
          endD.setDate(endD.getDate() + 1);
          if (skipWeekends && (endD.getDay() === 0 || endD.getDay() === 6)) continue;
          remaining--;
        }
        const cpEndStr = endD.toISOString().split('T')[0];

        // Create the phase record
        const phaseId = await db.rpc('add_custom_schedule_phase', {
          p_job_id: jobId,
          p_phase_name: cp.name,
          p_phase_color: cp.color,
          p_target_start: cpStartStr,
          p_target_end: cpEndStr,
          p_duration_days: cp.duration,
          p_sort_order: 900 + customPhases.indexOf(cp),
        });

        // Create tasks for this custom phase
        for (const t of cp.tasks) {
          await db.rpc('add_adhoc_job_task', {
            p_job_id: jobId,
            p_title: t.title,
            p_phase_name: cp.name,
            p_phase_color: cp.color,
            p_target_date: cpStartStr,
            p_job_schedule_phase_id: phaseId || null,
          });
        }
      }

      setResult({
        ...data,
        custom_phases: customPhases.length,
        excluded_tasks: excludedTaskIds.length,
      });
      setStep('done');
    } catch (e) {
      setError('Failed to generate schedule: ' + e.message);
      setStep('preview');
    }
  };

  return (
    <div style={W.overlay}>
      <div style={W.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={W.header}>
          <div>
            <div style={W.title}>{step === 'done' ? 'Schedule generated' : 'Generate schedule'}</div>
            <div style={W.subtitle}>{jobName}</div>
          </div>
          <button style={W.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={W.body}>
          {error && <div style={W.error}>{error}</div>}

          {/* ═══ STEP 1: Pick template + date ═══ */}
          {step === 'pick' && (
            <>
              <div style={W.field}>
                <label style={W.label}>Template</label>
                <select style={W.input} value={selectedTemplate || ''} onChange={e => setSelectedTemplate(e.target.value || null)}>
                  <option value="">Select a template...</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ ...W.field, flex: 1 }}>
                  <label style={W.label}>Start date</label>
                  <input type="date" style={W.input} value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div style={{ ...W.field, flex: 1 }}>
                  <label style={W.label}>&nbsp;</label>
                  <label style={W.checkLabel}>
                    <input type="checkbox" checked={skipWeekends} onChange={e => setSkipWeekends(e.target.checked)} />
                    Skip weekends
                  </label>
                </div>
              </div>
              {selectedTemplate && (
                <div style={W.hint}>Preview the timeline first, then customize phases and tasks before applying.</div>
              )}
            </>
          )}

          {/* ═══ STEP 2: Preview with editable phases/tasks ═══ */}
          {step === 'preview' && preview && (
            <>
              {/* Summary bar with editable start date */}
              <div style={W.summaryBar}>
                <div style={W.summaryItem} onClick={() => document.getElementById('wiz-start-date')?.showPicker?.()}>
                  <input type="date" id="wiz-start-date" value={startDate} onChange={e => changeStartDate(e.target.value)}
                    style={{ border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                      fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
                      borderRadius: 'var(--radius-md)', padding: '4px 8px',
                      cursor: 'pointer', outline: 'none', width: '100%' }} />
                  <div style={W.summaryLabel}>Start date</div>
                </div>
                <div style={W.summaryItem}>
                  <div style={W.summaryValue}>{enabledPhaseCount} phases</div>
                  <div style={W.summaryLabel}>{enabledTaskCount} tasks</div>
                </div>
                <div style={W.summaryItem}>
                  <div style={W.summaryValue}>{fmtDate(preview.project_end).split(',').pop().trim()}</div>
                  <div style={W.summaryLabel}>Target end</div>
                </div>
              </div>

              <div style={W.sectionTitle}>Phases and tasks — click to expand</div>

              {/* Template phases */}
              {preview.phases.map(phase => {
                const enabled = enabledPhases.has(phase.phase_id);
                const expanded = expandedPhase === phase.phase_id;
                const tasks = templateTasks[phase.phase_id] || [];
                const customs = customTasks[phase.phase_id] || [];
                const enabledCount = tasks.filter(t => enabledTasks.has(t.id)).length + customs.length;

                return (
                  <div key={phase.phase_id} style={{ opacity: enabled ? 1 : 0.45, marginBottom: 2 }}>
                    {/* Phase row */}
                    <div style={W.phaseRow}>
                      {/* Checkbox */}
                      <div onClick={e => { e.stopPropagation(); togglePhase(phase.phase_id); }}
                        style={{ ...W.checkbox, background: enabled ? 'var(--accent)' : 'transparent',
                          borderColor: enabled ? 'var(--accent)' : 'var(--border-color)' }}>
                        {enabled && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                      </div>
                      {/* Color bar */}
                      <div style={{ width: 4, borderRadius: 2, background: phase.color || '#6b7280', alignSelf: 'stretch', flexShrink: 0 }} />
                      {/* Content — click to expand */}
                      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                        onClick={() => setExpandedPhase(expanded ? null : phase.phase_id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={W.phaseName}>{phase.name}</span>
                          {phase.is_milestone && <span style={W.milestoneBadge}>Milestone</span>}
                          {tasks.length > 0 && (
                            <span style={W.taskBadge}>{enabledCount}/{tasks.length + customs.length}</span>
                          )}
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)',
                            transform: expanded ? 'rotate(180deg)' : 'none', transition: '150ms' }}>▾</span>
                        </div>
                        <div style={{ ...W.phaseDate, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{fmtRange(phase.start_date, phase.end_date)}</span>
                          {!phase.is_milestone && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--text-tertiary)' }}>
                              <input type="number" min="1" max="30"
                                value={durationOverrides[phase.phase_id] || phase.duration_days}
                                onClick={e => e.stopPropagation()}
                                onChange={e => changeDuration(phase.phase_id, e.target.value)}
                                style={{ width: 36, padding: '1px 4px', border: '1px solid var(--border-color)',
                                  borderRadius: 3, fontSize: 11, textAlign: 'center', fontFamily: 'var(--font-sans)',
                                  color: 'var(--text-primary)', background: 'var(--bg-primary)', outline: 'none' }} />
                              <span style={{ fontSize: 11 }}>days</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded: show tasks */}
                    {expanded && enabled && (
                      <div style={W.taskList}>
                        {tasks.map(task => {
                          const tEnabled = enabledTasks.has(task.id);
                          return (
                            <div key={task.id} style={W.taskRow} onClick={() => toggleTask(task.id)}>
                              <div style={{ ...W.checkboxSm,
                                background: tEnabled ? 'var(--accent)' : 'transparent',
                                borderColor: tEnabled ? 'var(--accent)' : 'var(--border-color)' }}>
                                {tEnabled && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>}
                              </div>
                              <span style={{ fontSize: 12, color: tEnabled ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                textDecoration: tEnabled ? 'none' : 'line-through', flex: 1 }}>
                                {task.title}
                              </span>
                              {task.is_required && <span style={W.reqBadge}>REQ</span>}
                            </div>
                          );
                        })}

                        {/* Custom tasks */}
                        {customs.map(ct => (
                          <div key={ct.id} style={W.taskRow}>
                            <div style={{ ...W.checkboxSm, background: 'var(--accent)', borderColor: 'var(--accent)' }}>
                              <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>{ct.title}</span>
                            <span style={W.customBadge}>Custom</span>
                            <button style={W.removeBtn} onClick={() => removeCustomTask(phase.phase_id, ct.id)}>✕</button>
                          </div>
                        ))}

                        {/* Add task input */}
                        {addingTaskIn === phase.phase_id ? (
                          <div style={{ display: 'flex', gap: 6, padding: '4px 0 4px 26px' }}>
                            <input style={{ ...W.input, flex: 1, padding: '5px 8px', fontSize: 12 }}
                              placeholder="Task name..."
                              value={newTaskTitle}
                              onChange={e => setNewTaskTitle(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') addCustomTask(phase.phase_id); if (e.key === 'Escape') { setAddingTaskIn(null); setNewTaskTitle(''); } }}
                              autoFocus />
                            <button style={W.smallBtn} onClick={() => addCustomTask(phase.phase_id)}>Add</button>
                            <button style={{ ...W.smallBtn, background: 'transparent', color: 'var(--text-tertiary)' }}
                              onClick={() => { setAddingTaskIn(null); setNewTaskTitle(''); }}>Cancel</button>
                          </div>
                        ) : (
                          <button style={W.addTaskBtn}
                            onClick={() => { setAddingTaskIn(phase.phase_id); setNewTaskTitle(''); }}>
                            + Add task
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Custom phases */}
              {customPhases.map((cp, idx) => {
                const expanded2 = expandedPhase === cp.id;
                return (
                  <div key={cp.id} style={{ marginBottom: 2 }}>
                    <div style={W.phaseRow}>
                      <div style={{ ...W.checkbox, background: 'var(--accent)', borderColor: 'var(--accent)' }}>
                        <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>
                      </div>
                      <div style={{ width: 4, borderRadius: 2, background: cp.color, alignSelf: 'stretch', flexShrink: 0 }} />
                      <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setExpandedPhase(expanded2 ? null : cp.id)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={W.phaseName}>{cp.name}</span>
                          <span style={W.customBadge}>Custom</span>
                          {cp.tasks.length > 0 && <span style={W.taskBadge}>{cp.tasks.length}</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-tertiary)',
                            transform: expanded2 ? 'rotate(180deg)' : 'none', transition: '150ms' }}>▾</span>
                        </div>
                        <div style={W.phaseDate}>{cp.duration} day{cp.duration !== 1 ? 's' : ''}</div>
                      </div>
                      <button style={W.removeBtn} onClick={() => removeCustomPhase(idx)}>✕</button>
                    </div>

                    {expanded2 && (
                      <div style={W.taskList}>
                        {cp.tasks.map(t => (
                          <div key={t.id} style={W.taskRow}>
                            <div style={{ ...W.checkboxSm, background: 'var(--accent)', borderColor: 'var(--accent)' }}>
                              <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1 }}>{t.title}</span>
                          </div>
                        ))}
                        {addingTaskIn === cp.id ? (
                          <div style={{ display: 'flex', gap: 6, padding: '4px 0 4px 26px' }}>
                            <input style={{ ...W.input, flex: 1, padding: '5px 8px', fontSize: 12 }}
                              placeholder="Task name..." value={newTaskTitle}
                              onChange={e => setNewTaskTitle(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') addTaskToCustomPhase(idx); if (e.key === 'Escape') { setAddingTaskIn(null); setNewTaskTitle(''); } }}
                              autoFocus />
                            <button style={W.smallBtn} onClick={() => addTaskToCustomPhase(idx)}>Add</button>
                          </div>
                        ) : (
                          <button style={W.addTaskBtn} onClick={() => { setAddingTaskIn(cp.id); setNewTaskTitle(''); }}>+ Add task</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add custom phase */}
              {showAddPhase ? (
                <div style={{ padding: '10px 0', borderTop: '1px solid var(--border-light)', marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={{ ...W.input, flex: 1, fontSize: 12 }} placeholder="Phase name..."
                      value={newPhaseName} onChange={e => setNewPhaseName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addCustomPhase(); }}
                      autoFocus />
                    <select style={{ ...W.input, width: 80, fontSize: 12 }} value={newPhaseDuration}
                      onChange={e => setNewPhaseDuration(parseInt(e.target.value))}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} day{n > 1 ? 's' : ''}</option>)}
                    </select>
                    <button style={W.smallBtn} onClick={addCustomPhase}>Add</button>
                    <button style={{ ...W.smallBtn, background: 'transparent', color: 'var(--text-tertiary)' }}
                      onClick={() => { setShowAddPhase(false); setNewPhaseName(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button style={W.addPhaseBtn} onClick={() => setShowAddPhase(true)}>+ Add custom phase</button>
              )}

              <div style={W.hint}>
                This generates phases with target dates and tasks for the crew to complete.
                Marcelo will then create appointments on the dispatch board and assign tasks manually.
              </div>
            </>
          )}

          {/* ═══ STEP 3: Generating ═══ */}
          {step === 'generating' && (
            <div style={W.center}>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                Creating {enabledPhaseCount} phases and {enabledTaskCount} tasks...
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Done ═══ */}
          {step === 'done' && result && (
            <div style={{ padding: '20px 0' }}>
              <div style={W.successBox}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#065f46', marginBottom: 8 }}>
                  Schedule generated
                </div>
                <div style={{ fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                  {result.phases_created} phases with target dates.
                  {' '}{result.tasks_created - (result.excluded_tasks || 0)} tasks in the pool.
                  {result.excluded_tasks > 0 && ` ${result.excluded_tasks} excluded.`}
                  {result.custom_phases > 0 && ` ${result.custom_phases} custom phases added.`}
                </div>
              </div>
              <div style={W.hint}>
                Open the dispatch board to see phases with target dates.
                Create appointments on the dispatch board and assign tasks to them.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={W.footer}>
          {step === 'pick' && (
            <>
              <button style={W.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={W.primaryBtn} onClick={loadPreview}
                disabled={!selectedTemplate || !startDate || previewLoading}>
                {previewLoading ? 'Calculating...' : 'Preview timeline'}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button style={W.cancelBtn} onClick={() => setStep('pick')}>Back</button>
              <button style={W.primaryBtn} onClick={applyPlan} disabled={enabledPhaseCount === 0}>
                Generate — {enabledPhaseCount} phase{enabledPhaseCount !== 1 ? 's' : ''}, {enabledTaskCount} task{enabledTaskCount !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {step === 'done' && (
            <button style={W.primaryBtn} onClick={() => { onGenerated?.(); onClose(); }}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const W = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 1000, paddingTop: 40, overflow: 'auto',
  },
  modal: {
    background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)',
    width: '100%', maxWidth: 580, maxHeight: 'calc(100vh - 80px)',
    display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' },
  subtitle: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  closeBtn: { fontSize: 16, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)',
  },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', height: 38 },
  hint: { fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 12, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' },
  error: { fontSize: 12, color: '#991b1b', background: '#fef2f2', padding: '8px 12px', borderRadius: 'var(--radius-md)', marginBottom: 12 },
  summaryBar: { display: 'flex', gap: 12, marginBottom: 16 },
  summaryItem: { flex: 1, padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', textAlign: 'center' },
  summaryValue: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  summaryLabel: { fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', marginBottom: 8 },
  phaseRow: {
    display: 'flex', gap: 8, padding: '8px 0', alignItems: 'center',
    borderBottom: '1px solid var(--border-light)',
  },
  phaseName: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  phaseDate: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  milestoneBadge: { fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#fffbeb', color: '#92400e', border: '1px solid #f59e0b30' },
  taskBadge: { fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: 'var(--accent-light)', color: 'var(--accent)' },
  customBadge: { fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: '#eff6ff', color: '#2563eb' },
  reqBadge: { fontSize: 9, fontWeight: 600, color: '#ef4444', background: '#fef2f2', padding: '1px 5px', borderRadius: 3 },
  checkbox: {
    width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
    border: '1.5px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  checkboxSm: {
    width: 16, height: 16, borderRadius: 3, flexShrink: 0, cursor: 'pointer',
    border: '1.5px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  taskList: { padding: '2px 0 6px 0', borderBottom: '1px solid var(--border-light)' },
  taskRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 26px', cursor: 'pointer' },
  addTaskBtn: {
    fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer',
    padding: '6px 0 4px 26px', fontFamily: 'var(--font-sans)', fontWeight: 500, textAlign: 'left',
  },
  addPhaseBtn: {
    fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer',
    padding: '10px 0', fontFamily: 'var(--font-sans)', fontWeight: 600, textAlign: 'left',
    borderTop: '1px solid var(--border-light)', marginTop: 8, width: '100%',
  },
  removeBtn: {
    fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none',
    cursor: 'pointer', padding: '2px 4px', flexShrink: 0,
  },
  smallBtn: {
    fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius-md)',
    border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer',
    fontFamily: 'var(--font-sans)', flexShrink: 0,
  },
  successBox: { padding: '16px', background: '#ecfdf5', borderRadius: 'var(--radius-md)', border: '1px solid #a7f3d0' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0,
  },
  cancelBtn: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
  },
  primaryBtn: {
    fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
  },
};
