import { useState, useEffect } from 'react';
import { APPT_TYPES } from '@/lib/scheduleUtils';
import DatePicker from '@/components/DatePicker';

const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 6; h <= 20; h++) for (let m = 0; m < 60; m += 30) {
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const hr = h % 12 || 12;
    opts.push({ val, label: `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` });
  }
  return opts;
})();

function EditAppointmentModal({ appointment, db, employees = [], onClose, onSaved, onDeleted }) {
  const [title, setTitle] = useState(appointment.title || '');
  const [date, setDate] = useState(appointment.date || '');
  const [timeStart, setTimeStart] = useState(appointment.time_start?.slice(0, 5) || '');
  const [timeEnd, setTimeEnd] = useState(appointment.time_end?.slice(0, 5) || '');
  const [type, setType] = useState(appointment.type || 'reconstruction');
  const [notes, setNotes] = useState(appointment.notes || '');
  const [status, setStatus] = useState(appointment.status || 'scheduled');
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [crewSearch, setCrewSearch] = useState('');

  // Initialize crew from appointment data
  const initialCrew = (appointment.crew || []).map(c => ({
    employee_id: c.employee_id,
    role: c.role,
    display_name: c.display_name,
    full_name: c.full_name,
    color: c.color,
  }));
  const [selectedCrew, setSelectedCrew] = useState(initialCrew);

  const toggleCrew = (emp) => {
    setSelectedCrew(prev => {
      const exists = prev.find(c => c.employee_id === emp.id);
      if (exists) return prev.filter(c => c.employee_id !== emp.id);
      return [...prev, {
        employee_id: emp.id,
        role: prev.length === 0 ? 'lead' : 'tech',
        display_name: emp.display_name,
        full_name: emp.full_name,
        color: emp.color,
      }];
    });
    setDirty(true);
  };

  // Escape to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Load tasks for this appointment
  useEffect(() => {
    if (!db || !appointment.id) return;
    (async () => {
      try {
        const data = await db.select('job_tasks',
          `appointment_id=eq.${appointment.id}&order=created_at.asc&select=id,title,is_completed,is_required,phase_name,phase_color,completed_at`
        );
        setTasks(data || []);
      } catch (e) { console.error('Load tasks:', e); }
      finally { setTasksLoading(false); }
    })();
  }, [db, appointment.id]);

  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
  };

  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h, 10);
    return `${hr % 12 || 12}:${m}${hr >= 12 ? 'p' : 'a'}`;
  };

  const fmtApptDate = (d) => {
    if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  // Toggle task completion
  const handleToggleTask = async (taskId) => {
    try {
      await db.rpc('toggle_job_task', { p_task_id: taskId, p_employee_id: null });
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, is_completed: !t.is_completed, completed_at: !t.is_completed ? new Date().toISOString() : null } : t
      ));
      setDirty(true);
    } catch (e) { console.error('Toggle task:', e); }
  };

  // Save changes
  const handleSave = async () => {
    setSaving(true);
    try {
      await db.rpc('update_appointment', {
        p_appointment_id: appointment.id,
        p_title: title.trim() || null,
        p_date: date || null,
        p_time_start: timeStart || null,
        p_time_end: timeEnd || null,
        p_type: type || null,
        p_status: status || null,
        p_notes: notes.trim() || null,
      });

      // Save crew changes — delete all and re-insert
      await db.delete('appointment_crew', `appointment_id=eq.${appointment.id}`);
      for (const c of selectedCrew) {
        await db.insert('appointment_crew', {
          appointment_id: appointment.id,
          employee_id: c.employee_id,
          role: c.role,
        });
      }

      onSaved();
    } catch (e) {
      console.error('Save appointment:', e);
      alert('Failed to save: ' + e.message);
    } finally { setSaving(false); }
  };

  // Finish appointment — complete it, release incomplete tasks
  const handleFinish = async () => {
    const incompleteTasks = tasks.filter(t => !t.is_completed);
    const msg = incompleteTasks.length > 0
      ? `${incompleteTasks.length} task${incompleteTasks.length !== 1 ? 's' : ''} incomplete — they'll be released back to the task pool. Finish appointment?`
      : 'Mark this appointment as completed?';
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      await db.rpc('finish_appointment', { p_appointment_id: appointment.id });
      onSaved();
    } catch (e) { console.error('Finish:', e); alert('Failed: ' + e.message); }
    finally { setSaving(false); }
  };

  // Delete appointment
  const handleDelete = async () => {
    setSaving(true);
    try {
      await db.rpc('delete_appointment', { p_appointment_id: appointment.id });
      onDeleted?.();
    } catch (e) { console.error('Delete:', e); alert('Failed: ' + e.message); }
    finally { setSaving(false); }
  };

  const completedCount = tasks.filter(t => t.is_completed).length;
  const totalTasks = tasks.length;
  const pct = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
  const isCompleted = status === 'completed';

  const STATUS_OPTIONS = [
    { value: 'scheduled', label: 'Scheduled', color: '#3b82f6' },
    { value: 'en_route', label: 'En Route', color: '#f59e0b' },
    { value: 'in_progress', label: 'In Progress', color: '#10b981' },
    { value: 'paused', label: 'Paused', color: '#ef4444' },
    { value: 'completed', label: 'Completed', color: '#6b7280' },
  ];

  const currentStatus = STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];

  return (
    <div style={S.overlay}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 5, background: currentStatus.color, flexShrink: 0,
              }} />
              <input style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', border: 'none',
                outline: 'none', background: 'transparent', flex: 1, padding: 0, fontFamily: 'var(--font-sans)' }}
                value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', paddingLeft: 18 }}>
              {appointment._jobName || 'Job'} · {fmtApptDate(date)}
            </div>
          </div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        <div style={S.body}>
          {/* Status bar */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {STATUS_OPTIONS.map(s => (
              <button key={s.value} onClick={() => { setStatus(s.value); setDirty(true); }}
                style={{
                  flex: 1, fontSize: 11, fontWeight: 600, padding: '6px 0', border: 'none',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  background: status === s.value ? s.color : 'var(--bg-tertiary)',
                  color: status === s.value ? '#fff' : 'var(--text-tertiary)',
                  transition: 'all 100ms ease',
                }}>{s.label}</button>
            ))}
          </div>

          {/* Date + Time */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
            <div style={{ ...S.field, flex: 1 }}>
              <label style={S.label}>Date</label>
              <DatePicker value={date} onChange={v => { setDate(v); setDirty(true); }} />
            </div>
            <div style={{ ...S.field, flex: 1 }}>
              <label style={S.label}>Start</label>
              <select style={S.input} value={timeStart}
                onChange={e => { setTimeStart(e.target.value); setDirty(true); }}>
                <option value="">—</option>
                {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ ...S.field, flex: 1 }}>
              <label style={S.label}>End</label>
              <select style={S.input} value={timeEnd}
                onChange={e => { setTimeEnd(e.target.value); setDirty(true); }}>
                <option value="">—</option>
                {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {timeStart && timeEnd && timeEnd <= timeStart && (
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 500, marginBottom: 8 }}>End time must be after start time</div>
          )}

          {/* Type */}
          <div style={{ ...S.field, marginBottom: 12 }}>
            <label style={S.label}>Type</label>
            <select style={S.input} value={type} onChange={e => { setType(e.target.value); setDirty(true); }}>
              {APPT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div style={{ ...S.field, marginBottom: 16 }}>
            <label style={S.label}>Notes</label>
            <textarea style={{ ...S.input, minHeight: 48, resize: 'vertical' }} value={notes}
              onChange={e => { setNotes(e.target.value); setDirty(true); }} placeholder="Instructions for the crew..." />
          </div>

          {/* ── Crew ── */}
          <div style={S.section}>
            <div style={S.sectionTitle}>
              Crew
              <span style={S.sectionBadge}>{selectedCrew.length}</span>
            </div>
            {employees.length > 5 && (
              <input style={{ ...S.input, marginBottom: 8, padding: '6px 10px', fontSize: 12 }}
                placeholder="Search crew..." value={crewSearch}
                onChange={e => setCrewSearch(e.target.value)} />
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {employees
                .filter(emp => {
                  if (selectedCrew.find(c => c.employee_id === emp.id)) return true;
                  if (!crewSearch.trim()) return true;
                  const q = crewSearch.toLowerCase();
                  return (emp.display_name || '').toLowerCase().includes(q) || (emp.full_name || '').toLowerCase().includes(q);
                })
                .map(emp => {
                  const sel = selectedCrew.find(c => c.employee_id === emp.id);
                  return (
                    <button key={emp.id} onClick={() => toggleCrew(emp)} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                      borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      border: sel ? `1.5px solid ${emp.color || 'var(--accent)'}` : '1px solid var(--border-color)',
                      background: sel ? `${emp.color || 'var(--accent)'}15` : 'var(--bg-primary)',
                      transition: 'all 100ms ease',
                    }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: 12, fontSize: 9, fontWeight: 700,
                        background: sel ? (emp.color || 'var(--accent)') : 'var(--bg-tertiary)',
                        color: sel ? '#fff' : 'var(--text-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{getInitials(emp.full_name || emp.display_name)}</span>
                      <span style={{ fontSize: 12, fontWeight: 600,
                        color: sel ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {emp.display_name || emp.full_name}
                      </span>
                      {sel && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 3,
                          background: sel.role === 'lead' ? '#fffbeb' : 'transparent',
                          color: sel.role === 'lead' ? '#92400e' : 'var(--text-tertiary)',
                        }}>{sel.role === 'lead' ? 'LEAD' : 'TECH'}</span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* ── Tasks ── */}
          <div style={S.section}>
            <div style={S.sectionTitle}>
              Tasks
              {totalTasks > 0 && (
                <span style={S.sectionBadge}>{completedCount}/{totalTasks}</span>
              )}
            </div>

            {/* Progress bar */}
            {totalTasks > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%',
                    background: pct === 100 ? '#10b981' : 'var(--accent)', borderRadius: 3, transition: 'width 200ms ease' }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: pct === 100 ? '#10b981' : 'var(--text-secondary)' }}>{pct}%</span>
              </div>
            )}

            {tasksLoading && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>Loading tasks...</div>}

            {!tasksLoading && tasks.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', padding: '8px 0' }}>No tasks assigned to this appointment</div>
            )}

            {tasks.map(task => (
              <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                borderBottom: '1px solid var(--border-light)' }}>
                <span onClick={() => handleToggleTask(task.id)} style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                  border: task.is_completed ? 'none' : '1.5px solid var(--border-color)',
                  background: task.is_completed ? '#10b981' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 100ms ease',
                }}
                  onMouseEnter={e => { if (!task.is_completed) e.currentTarget.style.borderColor = '#10b981'; }}
                  onMouseLeave={e => { if (!task.is_completed) e.currentTarget.style.borderColor = 'var(--border-color)'; }}>
                  {task.is_completed && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: task.is_completed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    textDecoration: task.is_completed ? 'line-through' : 'none' }}>
                    {task.title}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 1 }}>
                    {task.phase_name && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-tertiary)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: task.phase_color || '#6b7280' }} />
                        {task.phase_name}
                      </span>
                    )}
                  </div>
                </div>
                {task.is_required && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: '#ef4444', background: '#fef2f2', padding: '1px 5px', borderRadius: 3 }}>REQ</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={S.footer}>
          {/* Left: destructive actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)}
                style={{ ...S.ghostBtn, color: '#ef4444' }}>Delete</button>
            ) : (
              <>
                <button onClick={handleDelete} disabled={saving}
                  style={{ ...S.ghostBtn, color: '#fff', background: '#ef4444' }}>Confirm delete</button>
                <button onClick={() => setShowDeleteConfirm(false)}
                  style={S.ghostBtn}>Cancel</button>
              </>
            )}
          </div>

          {/* Right: save + finish */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {!isCompleted && (
              <button onClick={handleFinish} disabled={saving}
                style={{ ...S.outlineBtn, color: '#10b981', borderColor: '#10b981' }}>
                Finish
              </button>
            )}
            <button onClick={handleSave} disabled={saving || !dirty || (timeStart && timeEnd && timeEnd <= timeStart)}
              style={{ ...S.primaryBtn, opacity: (saving || !dirty || (timeStart && timeEnd && timeEnd <= timeStart)) ? 0.5 : 1 }}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const S = {
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
  closeBtn: {
    fontSize: 16, color: 'var(--text-tertiary)', background: 'none',
    border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0,
  },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  field: {},
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
  footer: {
    display: 'flex', alignItems: 'center',
    padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0,
  },
  ghostBtn: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', background: 'none',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 14px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
  outlineBtn: {
    fontSize: 13, fontWeight: 600, background: 'none',
    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
    padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
  },
  primaryBtn: {
    fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
};

export default EditAppointmentModal;
