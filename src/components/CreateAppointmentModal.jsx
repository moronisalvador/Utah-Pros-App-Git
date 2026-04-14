import { useState, useEffect, useMemo } from 'react';
import DatePicker from '@/components/DatePicker';

// Auto-derive appointment type from job division
function divisionToType(div) {
  if (!div) return 'other';
  if (['water', 'mold', 'contents', 'fire'].includes(div)) return 'mitigation';
  if (div === 'reconstruction') return 'reconstruction';
  return 'other';
}

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 6; h <= 20; h++) for (let m = 0; m < 60; m += 30) {
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const hr = h % 12 || 12;
    opts.push({ val, label: `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` });
  }
  return opts;
})();

function CreateAppointmentModal({ jobId, jobName, jobDivision, dateKey, prefillTaskIds = [], prefillTimeStart, prefillTimeEnd, db, employees, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dateKey);
  const type = divisionToType(jobDivision);
  const [timeStart, setTimeStart] = useState(prefillTimeStart || '07:00');
  const [timeEnd, setTimeEnd] = useState(prefillTimeEnd || '15:30');
  const [notes, setNotes] = useState('');
  const [selectedCrew, setSelectedCrew] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([...prefillTaskIds]);
  const [taskPool, setTaskPool] = useState([]);
  const [saving, setSaving] = useState(false);
  const [poolLoading, setPoolLoading] = useState(true);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [crewSearch, setCrewSearch] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPhase, setNewTaskPhase] = useState('');

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

  // Create an ad-hoc task and auto-select it
  const createNewTask = async () => {
    if (!newTaskTitle.trim() || !newTaskPhase) return;
    const phase = taskPool.find(g => g.phase_name === newTaskPhase) || taskPool[0];
    try {
      const result = await db.rpc('add_adhoc_job_task', {
        p_job_id: jobId,
        p_title: newTaskTitle.trim(),
        p_phase_name: phase?.phase_name || newTaskPhase,
        p_phase_color: phase?.phase_color || '#6b7280',
      });
      // Reload pool and auto-select the new task
      const data = await db.rpc('get_unassigned_tasks', { p_job_id: jobId });
      const newPool = Array.isArray(data) ? data : [];
      setTaskPool(newPool);
      // Find the newly created task (last one in the matching phase)
      const matchPhase = newPool.find(g => g.phase_name === (phase?.phase_name || newTaskPhase));
      if (matchPhase) {
        const newTask = matchPhase.tasks.find(t => t.title === newTaskTitle.trim() && !selectedTasks.includes(t.id));
        if (newTask) setSelectedTasks(prev => [...prev, newTask.id]);
      }
      setNewTaskTitle('');
      setCreatingTask(false);
    } catch (e) { console.error('Create task:', e); errToast('Failed: ' + e.message); }
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
      errToast('Failed to save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={M.overlay} className="appt-modal-overlay">
      <div style={M.modal} className="appt-modal" onClick={e => e.stopPropagation()}>
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

          {/* Date */}
          <div style={M.field}>
            <label style={M.label}>Date</label>
            <DatePicker value={date} onChange={v => setDate(v)} />
          </div>

          {/* Start + End */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>Start</label>
              <select style={M.input} value={timeStart} onChange={e => setTimeStart(e.target.value)}>
                {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>End</label>
              <select style={M.input} value={timeEnd} onChange={e => setTimeEnd(e.target.value)}>
                {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {timeStart && timeEnd && timeEnd <= timeStart && (
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 500, marginTop: -4, marginBottom: 4 }}>End time must be after start time</div>
          )}

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
            <input style={{ ...M.input, marginBottom: 8, padding: '6px 10px', fontSize: 12 }}
              placeholder="Search crew..." value={crewSearch}
              onChange={e => setCrewSearch(e.target.value)} />
            <div style={M.crewGrid}>
              {employees
                .filter(emp => {
                  // Always show selected crew even if they don't match search
                  if (selectedCrew.find(c => c.employee_id === emp.id)) return true;
                  if (!crewSearch.trim()) return true;
                  const q = crewSearch.toLowerCase();
                  return (emp.display_name || '').toLowerCase().includes(q) || (emp.full_name || '').toLowerCase().includes(q);
                })
                .map(emp => {
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
                      background: sel ? (emp.color || 'var(--accent)') : 'var(--bg-tertiary)',
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
                  {!poolLoading && availableTasks.length === 0 && !creatingTask && (
                    <div style={{ padding: 10, fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                      {taskSearch ? 'No matching tasks' : 'All tasks assigned'}
                    </div>
                  )}
                </div>

                {/* Create new task inline */}
                {creatingTask ? (
                  <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase' }}>Create new task</div>
                    <input style={{ ...M.input, marginBottom: 6, padding: '6px 8px', fontSize: 12, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}
                      placeholder="Task name..." value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createNewTask(); if (e.key === 'Escape') setCreatingTask(false); }}
                      autoFocus />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select style={{ ...M.input, flex: 1, padding: '5px 6px', fontSize: 11 }}
                        value={newTaskPhase} onChange={e => setNewTaskPhase(e.target.value)}>
                        <option value="">Select phase...</option>
                        {taskPool.map(g => <option key={g.phase_name} value={g.phase_name}>{g.phase_name}</option>)}
                      </select>
                      <button onClick={createNewTask} disabled={!newTaskTitle.trim() || !newTaskPhase}
                        style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', background: 'var(--accent)', color: '#fff',
                          border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                          opacity: (!newTaskTitle.trim() || !newTaskPhase) ? 0.5 : 1, flexShrink: 0 }}>Add</button>
                      <button onClick={() => { setCreatingTask(false); setNewTaskTitle(''); }}
                        style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', borderTop: '1px solid var(--border-light)' }}>
                    <button onClick={() => { setCreatingTask(true); setNewTaskPhase(taskPool[0]?.phase_name || ''); }}
                      style={{ flex: 1, padding: '6px', fontSize: 11, color: 'var(--accent)', fontWeight: 500, background: 'var(--bg-secondary)',
                        border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', borderRight: '1px solid var(--border-light)' }}>
                      + Create task
                    </button>
                    <button onClick={() => { setShowTaskPicker(false); setTaskSearch(''); }}
                      style={{ flex: 1, padding: '6px', fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)',
                        border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                      Done
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={M.footer} className="appt-modal-footer">
          <button style={M.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...M.saveBtn, opacity: (saving || (timeStart && timeEnd && timeEnd <= timeStart)) ? 0.6 : 1 }} onClick={handleSave} disabled={saving || (timeStart && timeEnd && timeEnd <= timeStart)}>
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

export default CreateAppointmentModal;
