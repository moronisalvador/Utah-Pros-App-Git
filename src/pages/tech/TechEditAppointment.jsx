import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import DatePicker from '@/components/DatePicker';
import { inputStyle, labelStyle, TIME_OPTIONS, MOBILE_TYPES, getInitials } from './techFormConstants';

export default function TechEditAppointment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { db, employee } = useAuth();
  const taskSectionRef = useRef(null);

  /* ── Loading state ── */
  const [loading, setLoading] = useState(true);
  const [appt, setAppt] = useState(null);

  /* ── Form ── */
  const [date, setDate] = useState('');
  const [timeStart, setTimeStart] = useState('07:00');
  const [timeEnd, setTimeEnd] = useState('15:30');
  const [type, setType] = useState('reconstruction');
  const [dayAppts, setDayAppts] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  /* ── Crew ── */
  const [employees, setEmployees] = useState([]);
  const [selectedCrew, setSelectedCrew] = useState([]);
  const [showCrew, setShowCrew] = useState(false);

  /* ── Current tasks (already assigned) ── */
  const [currentTasks, setCurrentTasks] = useState([]);

  /* ── Task pool (unassigned, available to add) ── */
  const [taskPool, setTaskPool] = useState([]);
  const [selectedNewTasks, setSelectedNewTasks] = useState([]);
  const [showTasks, setShowTasks] = useState(() => searchParams.get('section') === 'tasks');
  const [newTaskTitle, setNewTaskTitle] = useState('');

  /* ── Delete ── */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteTimer = useRef(null);

  /* ── Load appointment data ── */
  const load = useCallback(async () => {
    try {
      const [detail, taskList, empList] = await Promise.all([
        db.rpc('get_appointment_detail', { p_appointment_id: id }),
        db.rpc('get_appointment_tasks', { p_appointment_id: id }),
        db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
      ]);
      if (!detail) { toast('Appointment not found', 'error'); navigate(-1); return; }

      setAppt(detail);
      setEmployees(empList || []);
      setCurrentTasks(taskList || []);

      // Pre-fill form from loaded data
      setDate(detail.date || '');
      setTimeStart(detail.time_start?.slice(0, 5) || '07:00');
      setTimeEnd(detail.time_end?.slice(0, 5) || '15:30');
      setType(detail.type || 'reconstruction');
      setNotes(detail.notes || '');
      setSelectedCrew(
        (detail.appointment_crew || []).map(c => ({
          employee_id: c.employee_id || c.employees?.id,
          role: c.role || 'tech',
        }))
      );

      // Load unassigned task pool
      const jobId = detail.jobs?.id || detail.job_id;
      if (jobId) {
        const pool = await db.rpc('get_unassigned_tasks', { p_job_id: jobId });
        setTaskPool(Array.isArray(pool) ? pool : []);
      }
    } catch (e) {
      toast('Failed to load appointment', 'error');
      navigate(-1);
    }
    setLoading(false);
  }, [db, id, navigate]);

  useEffect(() => { load(); }, [load]);

  // Scroll to tasks section if ?section=tasks
  useEffect(() => {
    if (!loading && searchParams.get('section') === 'tasks' && taskSectionRef.current) {
      setTimeout(() => taskSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }, [loading, searchParams]);

  // Cleanup delete timer
  useEffect(() => () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); }, []);

  // Fetch that day's appointments when date changes (for schedule preview)
  useEffect(() => {
    if (!date) return;
    (async () => {
      try {
        const result = await db.rpc('get_appointments_range', { p_start_date: date, p_end_date: date });
        // Exclude current appointment from preview
        setDayAppts((result || []).filter(a => a.id !== id));
      } catch { setDayAppts([]); }
    })();
  }, [db, date, id]);

  /* ── Task pool helpers ── */
  const allPoolTasks = useMemo(() => {
    const map = {};
    for (const g of taskPool) for (const t of (g.tasks || [])) map[t.id] = { ...t, phase_name: g.phase_name, phase_color: g.phase_color };
    return map;
  }, [taskPool]);

  const toggleNewTask = (taskId) => {
    setSelectedNewTasks(prev => prev.includes(taskId) ? prev.filter(i => i !== taskId) : [...prev, taskId]);
  };

  const createTask = async () => {
    if (!newTaskTitle.trim() || !appt?.jobs) return;
    const phase = taskPool[0];
    try {
      await db.rpc('add_adhoc_job_task', {
        p_job_id: appt.jobs.id,
        p_title: newTaskTitle.trim(),
        p_phase_name: phase?.phase_name || 'general',
        p_phase_color: phase?.phase_color || '#6b7280',
      });
      const data = await db.rpc('get_unassigned_tasks', { p_job_id: appt.jobs.id });
      const newPool = Array.isArray(data) ? data : [];
      setTaskPool(newPool);
      // Auto-select new task
      for (const g of newPool) {
        const t = g.tasks?.find(t => t.title === newTaskTitle.trim() && !selectedNewTasks.includes(t.id));
        if (t) { setSelectedNewTasks(prev => [...prev, t.id]); break; }
      }
      setNewTaskTitle('');
    } catch { toast('Failed to create task', 'error'); }
  };

  /* ── Toggle current task completion ── */
  const toggleCurrentTask = async (task) => {
    setCurrentTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    try {
      await db.rpc('toggle_appointment_task', { p_task_id: task.id, p_employee_id: employee.id });
    } catch {
      toast('Failed to toggle task', 'error');
      setCurrentTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_completed: !t.is_completed } : t));
    }
  };

  /* ── Crew helpers ── */
  const toggleCrew = (empId) => {
    setSelectedCrew(prev => {
      const exists = prev.find(c => c.employee_id === empId);
      if (exists) return prev.filter(c => c.employee_id !== empId);
      return [...prev, { employee_id: empId, role: prev.length === 0 ? 'lead' : 'tech' }];
    });
  };

  /* ── Save ── */
  const handleSave = async () => {
    if (!date || saving) return;
    setSaving(true);
    try {
      // 1. Update core appointment fields
      await db.rpc('update_appointment', {
        p_appointment_id: id,
        p_title: appt.title || null,
        p_date: date,
        p_time_start: timeStart || null,
        p_time_end: timeEnd || null,
        p_type: type || null,
        p_status: appt.status || 'scheduled',
        p_notes: notes.trim() || null,
      });

      // 2. Sync crew — delete all + re-insert
      await db.delete('appointment_crew', `appointment_id=eq.${id}`);
      for (const c of selectedCrew) {
        await db.insert('appointment_crew', {
          appointment_id: id,
          employee_id: c.employee_id,
          role: c.role,
        });
      }

      // 3. Assign new tasks (if any selected from pool)
      if (selectedNewTasks.length > 0) {
        await db.rpc('assign_tasks_to_appointment', {
          p_appointment_id: id,
          p_task_ids: selectedNewTasks,
        });
      }

      toast('Appointment updated');
      navigate(-1);
    } catch (err) {
      toast('Failed to save: ' + (err.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      deleteTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setConfirmDelete(false);
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setDeleting(true);
    try {
      await db.rpc('delete_appointment', { p_appointment_id: id });
      toast('Appointment deleted');
      navigate('/tech/schedule', { replace: true });
    } catch (err) {
      toast('Failed to delete: ' + (err.message || ''), 'error');
    }
    setDeleting(false);
  };

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  const job = appt?.jobs;
  const doneCount = currentTasks.filter(t => t.is_completed).length;
  const totalCount = currentTasks.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 48, height: 48, borderRadius: 'var(--tech-radius-button)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
          Edit Appointment
        </span>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 100 }}>

        {/* ═══ JOB (read-only) ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Job</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                {job?.insured_name || 'Unknown'} <span style={{ fontWeight: 500, color: 'var(--text-tertiary)' }}>#{job?.job_number}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {[job?.address, job?.city].filter(Boolean).join(', ') || 'No address'}
              </div>
            </div>
          </div>
        </div>

        {/* ═══ DATE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Date <span style={{ color: '#ef4444' }}>*</span></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - 1); setDate(d.toISOString().split('T')[0]); }}
              style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 'var(--tech-radius-button)', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ flex: 1 }}><DatePicker value={date} onChange={setDate} /></div>
            <button onClick={() => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + 1); setDate(d.toISOString().split('T')[0]); }}
              style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 'var(--tech-radius-button)', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18"/></svg>
            </button>
          </div>
          {/* Day schedule preview */}
          {dayAppts.length > 0 && (
            <div style={{ marginTop: 10, borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)' }}>
                {dayAppts.length} other appointment{dayAppts.length !== 1 ? 's' : ''} this day
              </div>
              {dayAppts.map(a => {
                const t = a.time_start ? (() => { const [h, m] = a.time_start.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; })() : '';
                const te = a.time_end ? (() => { const [h, m] = a.time_end.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; })() : '';
                const crew = (a.appointment_crew || []).map(c => c.employees?.display_name || c.employees?.full_name || '').filter(Boolean).join(', ');
                return (
                  <div key={a.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 58, flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                      {t}{te ? <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)' }}>– {te}</div> : null}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.jobs?.insured_name || a.title || 'Appointment'}
                      </div>
                      {crew && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{crew}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══ TIME ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Time</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={timeStart}
              onChange={e => setTimeStart(e.target.value)}
              style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
            >
              {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
            <div style={{ alignSelf: 'center', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600 }}>to</div>
            <select
              value={timeEnd}
              onChange={e => setTimeEnd(e.target.value)}
              style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
            >
              {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* ═══ CREW ═══ */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setShowCrew(prev => !prev)}
            style={{
              ...labelStyle, cursor: 'pointer', background: 'none', border: 'none',
              padding: 0, display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}
          >
            Crew ({selectedCrew.length})
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: showCrew ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {selectedCrew.length > 0 && !showCrew && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {selectedCrew.map(c => {
                const emp = employees.find(e => e.id === c.employee_id);
                return (
                  <span key={c.employee_id} style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: c.role === 'lead' ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                    color: c.role === 'lead' ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${c.role === 'lead' ? 'var(--accent)' : 'var(--border-color)'}`,
                  }}>
                    {emp?.full_name || 'Unknown'} {c.role === 'lead' ? '(Lead)' : ''}
                  </span>
                );
              })}
            </div>
          )}

          {showCrew && (
            <div style={{ marginTop: 8, borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              {employees.map(emp => {
                const crewEntry = selectedCrew.find(c => c.employee_id === emp.id);
                const isSelected = !!crewEntry;
                return (
                  <button
                    key={emp.id}
                    onClick={() => toggleCrew(emp.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', border: 'none',
                      borderBottom: '1px solid var(--border-light)',
                      background: isSelected ? 'var(--accent-light)' : 'var(--bg-primary)',
                      cursor: 'pointer', textAlign: 'left',
                      minHeight: 'var(--tech-min-tap)',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 16,
                      background: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: isSelected ? '#fff' : 'var(--text-tertiary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, flexShrink: 0,
                    }}>
                      {getInitials(emp.full_name)}
                    </div>
                    <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {emp.full_name}
                    </div>
                    {crewEntry && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: crewEntry.role === 'lead' ? 'var(--accent)' : 'var(--bg-tertiary)',
                        color: crewEntry.role === 'lead' ? '#fff' : 'var(--text-secondary)',
                      }}>
                        {crewEntry.role}
                      </span>
                    )}
                    <div style={{
                      width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}`,
                      background: isSelected ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══ CURRENT TASKS (assigned to this appointment) ═══ */}
        {totalCount > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Assigned Tasks</span>
              <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', color: 'var(--text-secondary)' }}>{doneCount}/{totalCount}</span>
            </div>
            <div className="tech-task-progress-bar" style={{ marginBottom: 8 }}>
              <div className="tech-task-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div style={{ borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              {currentTasks.map(task => (
                <div key={task.id} className="tech-task-row" onClick={() => toggleCurrentTask(task)}
                  style={{ minHeight: 'var(--tech-row-height)', padding: '10px 14px' }}>
                  <div className={`tech-task-check${task.is_completed ? ' done' : ''}`}>
                    {task.is_completed && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </div>
                  <span className={`tech-task-name${task.is_completed ? ' done' : ''}`}>{task.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ ADD TASKS FROM POOL ═══ */}
        <div style={{ marginBottom: 20 }} ref={taskSectionRef}>
          <button
            onClick={() => setShowTasks(prev => !prev)}
            style={{
              ...labelStyle, cursor: 'pointer', background: 'none', border: 'none',
              padding: 0, display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}
          >
            Add Tasks ({selectedNewTasks.length})
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ transform: showTasks ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {selectedNewTasks.length > 0 && !showTasks && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {selectedNewTasks.map(tid => {
                const t = allPoolTasks[tid];
                return t ? (
                  <span key={tid} style={{
                    fontSize: 12, fontWeight: 600, padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: t.phase_color ? `${t.phase_color}18` : 'var(--bg-tertiary)',
                    color: t.phase_color || 'var(--text-secondary)',
                    border: `1px solid ${t.phase_color || 'var(--border-color)'}`,
                  }}>
                    {t.title}
                  </span>
                ) : null;
              })}
            </div>
          )}

          {showTasks && (
            <div style={{ marginTop: 8 }}>
              {taskPool.length === 0 ? (
                <div style={{ padding: 12, fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  No unassigned tasks for this job
                </div>
              ) : (
                <div style={{ borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  {taskPool.map(group => (
                    <div key={group.phase_name}>
                      <div style={{
                        padding: '6px 14px', fontSize: 11, fontWeight: 700,
                        background: group.phase_color ? `${group.phase_color}15` : 'var(--bg-secondary)',
                        color: group.phase_color || 'var(--text-tertiary)',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        borderBottom: '1px solid var(--border-light)',
                      }}>
                        {group.phase_name?.replace(/_/g, ' ')}
                      </div>
                      {(group.tasks || []).map(task => {
                        const isSelected = selectedNewTasks.includes(task.id);
                        return (
                          <button
                            key={task.id}
                            onClick={() => toggleNewTask(task.id)}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 14px', border: 'none',
                              borderBottom: '1px solid var(--border-light)',
                              background: isSelected ? 'var(--accent-light)' : 'var(--bg-primary)',
                              cursor: 'pointer', textAlign: 'left',
                              minHeight: 'var(--tech-min-tap)',
                            }}
                          >
                            <div style={{
                              width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                              border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}`,
                              background: isSelected ? 'var(--accent)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {isSelected && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                            <div style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>
                              {task.title}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {/* Inline add task */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder="Add a task..."
                  style={{ ...inputStyle, flex: 1, height: 48 }}
                />
                <button
                  onClick={createTask}
                  disabled={!newTaskTitle.trim()}
                  style={{
                    height: 48, padding: '0 14px', borderRadius: 'var(--tech-radius-button)',
                    background: newTaskTitle.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: newTaskTitle.trim() ? '#fff' : 'var(--text-tertiary)',
                    border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ═══ NOTES ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Notes</div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={3}
            style={{
              ...inputStyle, height: 'auto', padding: '12px 14px',
              resize: 'vertical', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* ═══ DANGER ZONE ═══ */}
        <div style={{ marginBottom: 20, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
          <button
            onClick={handleDelete}
            onBlur={() => { setConfirmDelete(false); if (deleteTimer.current) clearTimeout(deleteTimer.current); }}
            disabled={deleting}
            style={{
              width: '100%', height: 52, borderRadius: 'var(--tech-radius-button)',
              background: confirmDelete ? '#fef2f2' : 'transparent',
              color: confirmDelete ? '#dc2626' : 'var(--text-tertiary)',
              border: `1.5px solid ${confirmDelete ? '#fecaca' : 'var(--border-color)'}`,
              fontSize: 15, fontWeight: confirmDelete ? 700 : 600,
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
              touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
          >
            {deleting ? 'Deleting...' : confirmDelete ? 'Tap Again to Delete' : 'Delete Appointment'}
          </button>
        </div>
      </div>

      {/* Sticky save button */}
      <div style={{
        position: 'fixed', bottom: 'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))',
        left: 0, right: 0, padding: '12px 16px',
        background: 'linear-gradient(transparent, var(--bg-primary) 8px)',
        zIndex: 10,
      }}>
        <button
          onClick={handleSave}
          disabled={!date || saving}
          style={{
            width: '100%', height: 52, borderRadius: 'var(--tech-radius-button)',
            background: date && !saving ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: date && !saving ? '#fff' : 'var(--text-tertiary)',
            border: 'none', fontSize: 16, fontWeight: 700, cursor: date ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
