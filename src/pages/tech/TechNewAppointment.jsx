import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import DatePicker from '@/components/DatePicker';
import { inputStyle, labelStyle, TIME_OPTIONS, MOBILE_TYPES, getInitials } from './techFormConstants';

export default function TechNewAppointment() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { db, employee } = useAuth();
  const searchTimer = useRef(null);

  /* ── Job search ── */
  const [job, setJob] = useState(null);
  const [jobSearch, setJobSearch] = useState('');
  const [jobResults, setJobResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showJobDrop, setShowJobDrop] = useState(false);
  const jobSearchRef = useRef(null);

  /* ── Form ── */
  const [date, setDate] = useState(searchParams.get('date') || new Date().toISOString().split('T')[0]);
  const [timeStart, setTimeStart] = useState('07:00');
  const [timeEnd, setTimeEnd] = useState('15:30');
  const [type, setType] = useState('reconstruction');
  const [notes, setNotes] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const canTogglePrivate = ['admin', 'project_manager'].includes(employee?.role);

  /* ── Crew ── */
  const [employees, setEmployees] = useState([]);
  const [selectedCrew, setSelectedCrew] = useState(() => {
    return employee?.id ? [{ employee_id: employee.id, role: 'lead' }] : [];
  });
  const [showCrew, setShowCrew] = useState(false);

  /* ── Tasks ── */
  const [taskPool, setTaskPool] = useState([]);
  const [selectedTasks, setSelectedTasks] = useState([]);
  const [showTasks, setShowTasks] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');

  /* ── Load employees ── */
  useEffect(() => {
    db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role')
      .then(e => setEmployees(e || []))
      .catch(() => {});
  }, [db]);

  /* ── Cleanup ── */
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  /* ── Close dropdown on outside click ── */
  useEffect(() => {
    const h = e => { if (jobSearchRef.current && !jobSearchRef.current.contains(e.target)) setShowJobDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* ── Job search ── */
  const doJobSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setJobResults([]); setShowJobDrop(false); return; }
    setSearching(true);
    try {
      const eq = encodeURIComponent(q.trim());
      const r = await db.select('jobs',
        `or=(job_number.ilike.*${eq}*,insured_name.ilike.*${eq}*)&status=eq.active&select=id,job_number,insured_name,division,address,city&order=created_at.desc&limit=10`
      );
      setJobResults(Array.isArray(r) ? r : []);
      setShowJobDrop(true);
    } catch { setJobResults([]); } finally { setSearching(false); }
  }, [db]);

  const onJobSearch = e => {
    const v = e.target.value;
    setJobSearch(v);
    clearTimeout(searchTimer.current);
    if (v.trim().length >= 2) searchTimer.current = setTimeout(() => doJobSearch(v), 400);
    else { setJobResults([]); setShowJobDrop(false); }
  };

  const selectJob = (j) => {
    setJob(j);
    setJobSearch('');
    setShowJobDrop(false);
    setTaskPool([]);
    setSelectedTasks([]);
    // Load unassigned tasks for this job
    db.rpc('get_unassigned_tasks', { p_job_id: j.id })
      .then(data => setTaskPool(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  /* ── Task helpers ── */
  const allTasks = useMemo(() => {
    const map = {};
    for (const g of taskPool) for (const t of (g.tasks || [])) map[t.id] = { ...t, phase_name: g.phase_name, phase_color: g.phase_color };
    return map;
  }, [taskPool]);

  const toggleTask = (taskId) => {
    setSelectedTasks(prev => prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]);
  };

  const createTask = async () => {
    if (!newTaskTitle.trim() || !job) return;
    const phase = taskPool[0];
    try {
      await db.rpc('add_adhoc_job_task', {
        p_job_id: job.id,
        p_title: newTaskTitle.trim(),
        p_phase_name: phase?.phase_name || 'general',
        p_phase_color: phase?.phase_color || '#6b7280',
      });
      const data = await db.rpc('get_unassigned_tasks', { p_job_id: job.id });
      const newPool = Array.isArray(data) ? data : [];
      setTaskPool(newPool);
      // Auto-select new task
      for (const g of newPool) {
        const t = g.tasks?.find(t => t.title === newTaskTitle.trim() && !selectedTasks.includes(t.id));
        if (t) { setSelectedTasks(prev => [...prev, t.id]); break; }
      }
      setNewTaskTitle('');
    } catch (err) { toast('Failed to create task', 'error'); }
  };

  /* ── Crew helpers ── */
  const toggleCrew = (empId) => {
    setSelectedCrew(prev => {
      const exists = prev.find(c => c.employee_id === empId);
      if (exists) return prev.filter(c => c.employee_id !== empId);
      return [...prev, { employee_id: empId, role: prev.length === 0 ? 'lead' : 'tech' }];
    });
  };

  /* ── Submit ── */
  const canSubmit = job && date;

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      // Auto-generate title from selected tasks
      const assignedPhases = [...new Set(selectedTasks.map(id => allTasks[id]?.phase_name).filter(Boolean))];
      const title = assignedPhases.length > 0
        ? assignedPhases.join(' + ')
        : `Appointment ${new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

      const apptResult = await db.insert('appointments', {
        job_id: job.id,
        title,
        date,
        time_start: timeStart || null,
        time_end: timeEnd || null,
        type,
        status: 'scheduled',
        notes: notes.trim() || null,
        ...(canTogglePrivate && isPrivate ? { is_private: true } : {}),
      });
      const apptId = apptResult?.[0]?.id;
      if (!apptId) throw new Error('Failed to create appointment');

      // Add crew
      for (const crew of selectedCrew) {
        await db.insert('appointment_crew', {
          appointment_id: apptId,
          employee_id: crew.employee_id,
          role: crew.role,
        });
      }

      // Assign tasks
      if (selectedTasks.length > 0) {
        await db.rpc('assign_tasks_to_appointment', {
          p_appointment_id: apptId,
          p_task_ids: selectedTasks,
        });
      }

      toast('Appointment created');
      navigate(-1);
    } catch (err) {
      toast('Failed to create appointment: ' + (err.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

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
          New Appointment
        </span>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 100 }}>

        {/* ═══ JOB SEARCH ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Job <span style={{ color: '#ef4444' }}>*</span></div>

          {!job ? (
            <div ref={jobSearchRef} style={{ position: 'relative' }}>
              <div style={{ position: 'relative' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"
                  style={{ position: 'absolute', left: 14, top: 15, pointerEvents: 'none' }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={jobSearch}
                  onChange={onJobSearch}
                  placeholder="Search by job # or client name..."
                  autoFocus
                  style={{ ...inputStyle, paddingLeft: 40 }}
                />
                {searching && (
                  <div style={{ position: 'absolute', right: 14, top: 15 }}>
                    <div className="spinner" style={{ width: 16, height: 16 }} />
                  </div>
                )}
              </div>

              {showJobDrop && (
                <div style={{
                  position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
                  background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)',
                  zIndex: 50, maxHeight: '50vh', overflowY: 'auto',
                }}>
                  {jobResults.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', fontSize: 14, color: 'var(--text-tertiary)' }}>
                      No jobs found
                    </div>
                  ) : (
                    jobResults.map(j => (
                      <button
                        key={j.id}
                        onClick={() => selectJob(j)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--border-light)',
                          background: 'transparent', cursor: 'pointer', textAlign: 'left',
                          minHeight: 'var(--tech-min-tap)',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {j.insured_name || 'Unknown'} <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>#{j.job_number}</span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {[j.address, j.city].filter(Boolean).join(', ') || 'No address'}
                          </div>
                        </div>
                        {j.division && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 'var(--radius-full)',
                            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                          }}>
                            {j.division}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
              borderRadius: 'var(--tech-radius-card)', border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {job.insured_name || 'Unknown'} <span style={{ fontWeight: 500, color: 'var(--text-tertiary)' }}>#{job.job_number}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {[job.address, job.city].filter(Boolean).join(', ')}
                </div>
              </div>
              <button
                onClick={() => { setJob(null); setTaskPool([]); setSelectedTasks([]); }}
                style={{
                  width: 36, height: 36, borderRadius: 'var(--radius-full)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ═══ DATE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Date <span style={{ color: '#ef4444' }}>*</span></div>
          <DatePicker value={date} onChange={setDate} />
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

        {/* ═══ TYPE ═══ */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Type</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MOBILE_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                style={{
                  height: 48, padding: '0 14px', borderRadius: 'var(--tech-radius-button)',
                  border: type === t.value ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                  background: type === t.value ? 'var(--accent-light)' : 'var(--bg-primary)',
                  fontSize: 13, fontWeight: 600,
                  color: type === t.value ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                {t.label}
              </button>
            ))}
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

          {/* Selected crew badges */}
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

          {/* Crew picker */}
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
                    {/* Checkbox */}
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

        {/* ═══ TASKS ═══ */}
        {job && (
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={() => setShowTasks(prev => !prev)}
              style={{
                ...labelStyle, cursor: 'pointer', background: 'none', border: 'none',
                padding: 0, display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              }}
            >
              Tasks ({selectedTasks.length})
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                style={{ transform: showTasks ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Selected tasks */}
            {selectedTasks.length > 0 && !showTasks && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {selectedTasks.map(id => {
                  const t = allTasks[id];
                  return t ? (
                    <span key={id} style={{
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

            {/* Task picker */}
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
                          const isSelected = selectedTasks.includes(task.id);
                          return (
                            <button
                              key={task.id}
                              onClick={() => toggleTask(task.id)}
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
        )}

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

        {/* ═══ PRIVATE ═══ admin/PM only */}
        {canTogglePrivate && (
          <div style={{ marginBottom: 20, padding: '12px 14px', background: isPrivate ? '#fef3c7' : 'var(--bg-secondary)', border: `1px solid ${isPrivate ? '#fde68a' : 'var(--border-light)'}`, borderRadius: 'var(--tech-radius-button)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 'var(--tech-min-tap)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)}
                style={{ marginTop: 4, width: 20, height: 20, cursor: 'pointer', accentColor: '#d97706', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Private
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
                  Only admins, project managers, and assigned crew will see this.
                </div>
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Sticky submit */}
      <div style={{
        position: 'fixed', bottom: 'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))',
        left: 0, right: 0, padding: '12px 16px',
        background: 'linear-gradient(transparent, var(--bg-primary) 8px)',
        zIndex: 10,
      }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          style={{
            width: '100%', height: 52, borderRadius: 'var(--tech-radius-button)',
            background: canSubmit && !saving ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: canSubmit && !saving ? '#fff' : 'var(--text-tertiary)',
            border: 'none', fontSize: 16, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {saving ? 'Creating...' : 'Create Appointment'}
        </button>
      </div>
    </div>
  );
}
