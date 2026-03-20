import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import ScheduleWizard from '@/components/ScheduleWizard';

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Urgent', color: '#ef4444' },
  { value: 2, label: 'High', color: '#f59e0b' },
  { value: 3, label: 'Normal', color: '#2563eb' },
  { value: 4, label: 'Low', color: '#8b929e' },
];

const DIVISION_OPTIONS = [
  { value: 'water', label: 'Water' },
  { value: 'mold', label: 'Mold' },
  { value: 'reconstruction', label: 'Reconstruction' },
];

const FILE_CATEGORIES = [
  { key: 'photo', label: 'Photos' },
  { key: 'estimate', label: 'Estimates' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'moisture_log', label: 'Moisture Logs' },
  { key: 'receipt', label: 'Receipts' },
  { key: 'contract', label: 'Contracts' },
  { key: 'other', label: 'Other' },
];

const DIVISION_EMOJI = { water: '💧', mold: '🦠', reconstruction: '🏗️' };

export default function JobPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { db, employee: currentUser } = useAuth();

  const [job, setJob] = useState(null);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const [documents, setDocuments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [history, setHistory] = useState([]);

  // Schedule
  const [scheduleData, setScheduleData] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  // Inline editing
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadJob(); }, [jobId]);

  const loadJob = async () => {
    setLoading(true);
    try {
      const [jobsData, phasesData, empsData, docsData, notesData, histData] = await Promise.all([
        db.select('jobs', `id=eq.${jobId}`),
        db.select('job_phases', 'is_active=eq.true&order=display_order.asc'),
        db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
        db.select('job_documents', `job_id=eq.${jobId}&order=created_at.desc`).catch(() => []),
        db.select('job_notes', `job_id=eq.${jobId}&order=created_at.desc`).catch(() => []),
        db.select('job_phase_history', `job_id=eq.${jobId}&order=changed_at.desc&limit=50`).catch(() => []),
      ]);
      if (jobsData.length === 0) { navigate('/jobs', { replace: true }); return; }
      setJob(jobsData[0]);
      setPhases(phasesData);
      setEmployees(empsData);
      setDocuments(docsData);
      setNotes(notesData);
      setHistory(histData);
    } catch (err) {
      console.error('Job load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const phaseMap = useMemo(() => {
    const m = {};
    for (const p of phases) m[p.key] = p;
    return m;
  }, [phases]);

  // ── Load schedule data ──
  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const data = await db.rpc('get_job_task_pool', { p_job_id: jobId });
      setScheduleData(Array.isArray(data) ? data : (data ? [data] : []));
    } catch { setScheduleData([]); }
    finally { setScheduleLoading(false); }
  }, [db, jobId]);

  useEffect(() => { if (activeTab === 'schedule') loadSchedule(); }, [activeTab, loadSchedule]);

  // ── Save a single field ──
  const saveField = async (field, value) => {
    setSaving(true);
    try {
      const update = { [field]: value === '' ? null : value, updated_at: new Date().toISOString() };
      await db.update('jobs', `id=eq.${job.id}`, update);
      setJob(prev => ({ ...prev, ...update }));
      setEditingField(null);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Save immediately (for selects/dropdowns) ──
  const saveFieldDirect = async (field, value) => {
    setSaving(true);
    try {
      const parsed = value === '' ? null : value;
      const update = { [field]: parsed, updated_at: new Date().toISOString() };
      await db.update('jobs', `id=eq.${job.id}`, update);
      setJob(prev => ({ ...prev, ...update }));
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Phase change ──
  const handlePhaseChange = async (newPhase) => {
    if (newPhase === job.phase) return;
    setSaving(true);
    try {
      await db.update('jobs', `id=eq.${job.id}`, {
        phase: newPhase, phase_entered_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      await db.insert('job_phase_history', {
        job_id: job.id, from_phase: job.phase, to_phase: newPhase,
        changed_by: currentUser?.id || null, changed_at: new Date().toISOString(),
      });
      setJob(prev => ({ ...prev, phase: newPhase, phase_entered_at: new Date().toISOString() }));
      const histData = await db.select('job_phase_history', `job_id=eq.${job.id}&order=changed_at.desc&limit=50`).catch(() => []);
      setHistory(histData);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (field, currentValue) => {
    setEditingField(field);
    setEditValue(currentValue ?? '');
  };

  const cancelEdit = () => { setEditingField(null); setEditValue(''); };

  const handleEditKeyDown = (e, field) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveField(field, editValue); }
    if (e.key === 'Escape') cancelEdit();
  };

  const fmt = (val) => {
    if (val === null || val === undefined) return '—';
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtDate = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const fmtDateTime = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;
  if (!job) return null;

  const phaseLabel = phaseMap[job.phase]?.label || job.phase;
  const divEmoji = DIVISION_EMOJI[job.division] || '📁';
  const priorityObj = PRIORITY_OPTIONS.find(p => p.value === job.priority) || PRIORITY_OPTIONS[2];

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'files', label: 'Files', count: documents.length },
    { key: 'financial', label: 'Financial' },
    { key: 'activity', label: 'Activity', count: notes.length + history.length },
  ];

  // Shared editable row props
  const editProps = { editingField, editValue, saving, startEdit, cancelEdit, saveField, setEditValue: setEditValue, handleEditKeyDown };

  return (
    <div className="job-page">
      {/* ══ Top Bar ══ */}
      <div className="job-page-topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ gap: 4 }}>← Back</button>
        <div className="job-page-topbar-actions">
          <select className="input" value={job.phase} onChange={e => handlePhaseChange(e.target.value)} disabled={saving}
            style={{ width: 'auto', minWidth: 160, fontWeight: 600, height: 32 }}>
            {phases.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {/* ══ Header ══ */}
      <div className="job-page-header">
        <div className="job-page-header-left">
          <div className="job-page-division-icon">{divEmoji}</div>
          <div>
            <div className="job-page-jobnumber">{job.job_number || 'No Job #'}</div>
            <div className="job-page-client">{job.insured_name || 'Unknown Client'}</div>
            {job.address && (
              <div className="job-page-address">{job.address}{job.city ? `, ${job.city}` : ''}{job.state ? ` ${job.state}` : ''}</div>
            )}
          </div>
        </div>
        <div className="job-page-header-right">
          <span className={`status-badge status-${phaseClass(job.phase)}`}>{phaseLabel}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: priorityObj.color }}>{priorityObj.label}</span>
          {(job.is_cat_loss || job.has_asbestos || job.has_lead) && (
            <div style={{ display: 'flex', gap: 4 }}>
              {job.is_cat_loss && <span className="job-flag flag-red">CAT</span>}
              {job.has_asbestos && <span className="job-flag flag-red">ASB</span>}
              {job.has_lead && <span className="job-flag flag-red">LEAD</span>}
            </div>
          )}
        </div>
      </div>

      {/* ══ Tabs ══ */}
      <div className="job-page-tabs">
        {TABS.map(tab => (
          <button key={tab.key} className={`job-page-tab${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            {tab.count > 0 && <span className="job-page-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* ══ Tab Content ══ */}
      <PullToRefresh onRefresh={loadJob} className="job-page-content">
        {activeTab === 'overview' && (
          <OverviewTab job={job} employees={employees} phases={phases} editProps={editProps} saveFieldDirect={saveFieldDirect} fmtDate={fmtDate} />
        )}
        {activeTab === 'schedule' && (
          <ScheduleTab
            scheduleData={scheduleData}
            loading={scheduleLoading}
            onOpenWizard={() => setShowWizard(true)}
            onNavigateSchedule={() => navigate('/schedule')}
            fmtDate={fmtDate}
            db={db}
            jobId={jobId}
            onRefresh={loadSchedule}
          />
        )}
        {activeTab === 'files' && (
          <FilesTab job={job} documents={documents} setDocuments={setDocuments} db={db} currentUser={currentUser} />
        )}
        {activeTab === 'financial' && (
          <FinancialTab job={job} fmt={fmt} editProps={editProps} saveFieldDirect={saveFieldDirect} />
        )}
        {activeTab === 'activity' && (
          <ActivityTab job={job} notes={notes} setNotes={setNotes} history={history} employees={employees}
            phaseMap={phaseMap} db={db} currentUser={currentUser} fmtDateTime={fmtDateTime} />
        )}
      </PullToRefresh>

      {/* Schedule Wizard Modal */}
      {showWizard && (
        <ScheduleWizard
          jobId={job.id}
          jobName={job.insured_name || 'Job'}
          onClose={() => setShowWizard(false)}
          onGenerated={() => { loadSchedule(); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SCHEDULE TAB — task pool with phase progress + target dates
   ═══════════════════════════════════════════════════ */
function ScheduleTab({ scheduleData, loading, onOpenWizard, onNavigateSchedule, fmtDate, db, jobId, onRefresh }) {
  const [expandedPhase, setExpandedPhase] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [apptsLoading, setApptsLoading] = useState(true);
  const [editingPhase, setEditingPhase] = useState(null); // { phase_name, field, value }
  const [saving, setSaving] = useState(false);

  // Load appointments for this job
  useEffect(() => {
    if (!jobId || !db) return;
    (async () => {
      setApptsLoading(true);
      try {
        const data = await db.select('appointments',
          `job_id=eq.${jobId}&status=neq.cancelled&order=date.asc,time_start.asc&select=id,title,date,time_start,time_end,type,status,notes,appointment_crew(id,role,employee_id,employees(display_name,full_name))`
        );
        setAppointments(data || []);
      } catch (e) { console.error('Load appointments:', e); setAppointments([]); }
      finally { setApptsLoading(false); }
    })();
  }, [db, jobId, scheduleData]);

  // Save phase date edit
  const savePhaseDate = async (phaseName, field, value) => {
    if (!value) return;
    setSaving(true);
    try {
      // Get the schedule ID first
      const schedules = await db.select('job_schedules', `job_id=eq.${jobId}&limit=1`);
      if (schedules.length === 0) return;
      const scheduleId = schedules[0].id;
      // Find the phase
      const phases = await db.select('job_schedule_phases',
        `job_schedule_id=eq.${scheduleId}&phase_name=eq.${encodeURIComponent(phaseName)}&limit=1`
      );
      if (phases.length > 0) {
        const update = { [field]: value };
        if (field === 'target_start' && phases[0].target_end < value) {
          update.target_end = value;
        }
        await db.update('job_schedule_phases', `id=eq.${phases[0].id}`, update);
        setEditingPhase(null);
        onRefresh?.();
      }
    } catch (e) { console.error('Save phase date:', e); alert('Failed to save: ' + e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 13 }}>Loading schedule...</div>;

  // No schedule applied
  if (!scheduleData || scheduleData.length === 0) {
    return (
      <div className="job-page-section" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>📋</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>No schedule plan yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16, maxWidth: 320, margin: '0 auto 16px' }}>
          Apply a schedule template to create a task pool with target dates for each phase.
        </div>
        <button className="btn btn-primary" onClick={onOpenWizard} style={{ fontWeight: 600 }}>
          Apply schedule plan
        </button>
      </div>
    );
  }

  // Calculate totals
  const totalTasks = scheduleData.reduce((s, p) => s + (p.total || 0), 0);
  const completedTasks = scheduleData.reduce((s, p) => s + (p.completed || 0), 0);
  const assignedTasks = scheduleData.reduce((s, p) => s + (p.assigned || 0), 0);
  const unassignedTasks = totalTasks - assignedTasks;
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const allStarts = scheduleData.filter(p => p.target_start).map(p => p.target_start);
  const allEnds = scheduleData.filter(p => p.target_end).map(p => p.target_end);
  const projectStart = allStarts.length > 0 ? allStarts.sort()[0] : null;
  const projectEnd = allEnds.length > 0 ? allEnds.sort().reverse()[0] : null;

  const fmtTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h, 10);
    return `${hr % 12 || 12}:${m}${hr >= 12 ? 'p' : 'a'}`;
  };

  const fmtApptDate = (d) => {
    if (!d) return '';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const STATUS_COLORS = {
    scheduled: '#3b82f6', en_route: '#f59e0b', in_progress: '#10b981',
    paused: '#ef4444', completed: '#6b7280', cancelled: '#9ca3af',
  };

  return (
    <>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div className="job-page-section" style={{ padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Complete</div>
        </div>
        <div className="job-page-section" style={{ padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{completedTasks}/{totalTasks}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Tasks done</div>
        </div>
        <div className="job-page-section" style={{ padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: assignedTasks > 0 ? '#2563eb' : 'var(--text-tertiary)' }}>{assignedTasks}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Scheduled</div>
        </div>
        <div className="job-page-section" style={{ padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: unassignedTasks > 0 ? '#f59e0b' : '#10b981' }}>{unassignedTasks}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Unscheduled</div>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="job-page-section" style={{ padding: '12px 14px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Overall progress</span>
          {projectStart && projectEnd && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {fmtDate(projectStart)} – {fmtDate(projectEnd)}
            </span>
          )}
        </div>
        <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#10b981' : 'var(--accent)',
            borderRadius: 4, transition: 'width 300ms ease' }} />
        </div>
      </div>

      {/* ═══ Appointments ═══ */}
      <div className="job-page-section" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Appointments</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {apptsLoading ? '...' : `${appointments.length} scheduled`}
          </span>
        </div>
        {!apptsLoading && appointments.length === 0 && (
          <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
            No appointments yet — create them from the dispatch board
          </div>
        )}
        {appointments.map(appt => {
          const crew = appt.appointment_crew || [];
          const statusColor = STATUS_COLORS[appt.status] || '#6b7280';
          return (
            <div key={appt.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: statusColor, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{appt.title}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: statusColor, textTransform: 'capitalize' }}>{appt.status?.replace('_', ' ')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, paddingLeft: 16 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmtApptDate(appt.date)}</span>
                {appt.time_start && (
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {fmtTime(appt.time_start)}{appt.time_end ? ` – ${fmtTime(appt.time_end)}` : ''}
                  </span>
                )}
              </div>
              {crew.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4, paddingLeft: 16, flexWrap: 'wrap' }}>
                  {crew.map(c => (
                    <span key={c.id} style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
                      background: c.role === 'lead' ? '#fffbeb' : 'var(--bg-tertiary)',
                      color: c.role === 'lead' ? '#92400e' : 'var(--text-secondary)',
                      border: c.role === 'lead' ? '1px solid #f59e0b40' : 'none',
                    }}>{c.employees?.display_name || c.employees?.full_name || '?'}</span>
                  ))}
                </div>
              )}
              {appt.notes && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, paddingLeft: 16,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appt.notes}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ Phase breakdown ═══ */}
      <div className="job-page-section" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Phases</span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{scheduleData.length} phases</span>
        </div>
        {scheduleData.map(phase => {
          const total = phase.total || 0;
          const completed = phase.completed || 0;
          const assigned = phase.assigned || 0;
          const unassigned = total - assigned;
          const isDone = completed === total && total > 0;
          const isExpanded = expandedPhase === phase.phase_name;
          const tasks = phase.tasks || [];
          const phasePct = total > 0 ? Math.round((completed / total) * 100) : 0;
          const isEditingStart = editingPhase?.phase_name === phase.phase_name && editingPhase?.field === 'target_start';
          const isEditingEnd = editingPhase?.phase_name === phase.phase_name && editingPhase?.field === 'target_end';

          return (
            <div key={phase.phase_name}>
              <div
                onClick={() => tasks.length > 0 && setExpandedPhase(isExpanded ? null : phase.phase_name)}
                style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--border-light)',
                  cursor: tasks.length > 0 ? 'pointer' : 'default',
                  background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: phase.phase_color || '#6b7280', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: isDone ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    textDecoration: isDone ? 'line-through' : 'none' }}>
                    {phase.phase_name}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isDone ? '#10b981' : 'var(--text-secondary)' }}>{phasePct}%</span>
                  {tasks.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)',
                      transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '150ms' }}>▾</span>
                  )}
                </div>
                {/* Editable target dates */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, paddingLeft: 16 }}>
                  {phase.target_start && (
                    isEditingStart ? (
                      <input type="date" autoFocus value={editingPhase.value}
                        onClick={e => e.stopPropagation()}
                        onChange={e => setEditingPhase(prev => ({ ...prev, value: e.target.value }))}
                        onBlur={() => savePhaseDate(phase.phase_name, 'target_start', editingPhase.value)}
                        onKeyDown={e => { if (e.key === 'Enter') savePhaseDate(phase.phase_name, 'target_start', editingPhase.value); if (e.key === 'Escape') setEditingPhase(null); }}
                        style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--accent)', borderRadius: 3, fontFamily: 'var(--font-sans)', outline: 'none', width: 120 }} />
                    ) : (
                      <span onClick={e => { e.stopPropagation(); setEditingPhase({ phase_name: phase.phase_name, field: 'target_start', value: phase.target_start }); }}
                        style={{ fontSize: 11, color: 'var(--text-tertiary)', cursor: 'pointer', padding: '1px 3px', borderRadius: 3 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        title="Click to edit start date">
                        {fmtDate(phase.target_start)}
                      </span>
                    )
                  )}
                  {phase.target_end && phase.target_end !== phase.target_start && (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>–</span>
                      {isEditingEnd ? (
                        <input type="date" autoFocus value={editingPhase.value}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setEditingPhase(prev => ({ ...prev, value: e.target.value }))}
                          onBlur={() => savePhaseDate(phase.phase_name, 'target_end', editingPhase.value)}
                          onKeyDown={e => { if (e.key === 'Enter') savePhaseDate(phase.phase_name, 'target_end', editingPhase.value); if (e.key === 'Escape') setEditingPhase(null); }}
                          style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--accent)', borderRadius: 3, fontFamily: 'var(--font-sans)', outline: 'none', width: 120 }} />
                      ) : (
                        <span onClick={e => { e.stopPropagation(); setEditingPhase({ phase_name: phase.phase_name, field: 'target_end', value: phase.target_end }); }}
                          style={{ fontSize: 11, color: 'var(--text-tertiary)', cursor: 'pointer', padding: '1px 3px', borderRadius: 3 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          title="Click to edit end date">
                          {fmtDate(phase.target_end)}
                        </span>
                      )}
                    </>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    {completed}/{total} done
                  </span>
                  {unassigned > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                      background: '#fef3c7', color: '#92400e' }}>
                      {unassigned} unscheduled
                    </span>
                  )}
                </div>
                {/* Phase progress bar */}
                <div style={{ height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden', marginTop: 6, marginLeft: 16 }}>
                  <div style={{ width: `${phasePct}%`, height: '100%',
                    background: isDone ? '#10b981' : (phase.phase_color || 'var(--accent)'), borderRadius: 2 }} />
                </div>
              </div>

              {/* Expanded task list */}
              {isExpanded && tasks.length > 0 && (
                <div style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)' }}>
                  {tasks.map(task => (
                    <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 6px 38px',
                      borderBottom: '1px solid var(--border-light)' }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: task.is_completed ? 'none' : '1.5px solid var(--border-color)',
                        background: task.is_completed ? '#10b981' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {task.is_completed && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                      </span>
                      <span style={{ fontSize: 12, flex: 1, color: task.is_completed ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        textDecoration: task.is_completed ? 'line-through' : 'none' }}>
                        {task.title}
                      </span>
                      {task.is_required && <span style={{ fontSize: 9, fontWeight: 600, color: '#ef4444', background: '#fef2f2', padding: '1px 4px', borderRadius: 3 }}>REQ</span>}
                      {task.appointment_id ? (
                        <span style={{ fontSize: 10, color: '#2563eb', background: '#eff6ff', padding: '1px 5px', borderRadius: 3, fontWeight: 500 }}>Scheduled</span>
                      ) : (
                        <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', padding: '1px 5px', borderRadius: 3, fontWeight: 500 }}>Unscheduled</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn btn-outline" onClick={onNavigateSchedule} style={{ flex: 1 }}>
          Open dispatch board
        </button>
        <button className="btn btn-ghost" onClick={onOpenWizard} style={{ fontSize: 12 }}>
          Re-apply template
        </button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════
   EDITABLE ROW — click to edit any text/date/number field
   ═══════════════════════════════════════════════════ */
function EditableRow({ label, field, value, displayValue, type = 'text', editProps, href }) {
  const { editingField, editValue, saving, startEdit, cancelEdit, saveField, setEditValue, handleEditKeyDown } = editProps;
  const isEditing = editingField === field;
  const display = displayValue || value || '—';
  const isEmpty = !value && !displayValue;

  if (isEditing) {
    return (
      <div className="job-page-info-row editing">
        <span className="job-page-info-label">{label}</span>
        <div className="job-page-edit-wrap">
          <input
            className="input job-page-edit-input"
            type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
            step={type === 'number' ? '0.01' : undefined}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => handleEditKeyDown(e, field)}
            autoFocus
          />
          <div className="job-page-edit-actions">
            <button className="btn btn-primary btn-sm" onClick={() => saveField(field, type === 'number' ? (editValue === '' ? null : parseFloat(editValue)) : editValue)} disabled={saving}>
              {saving ? '...' : '✓'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>✕</button>
          </div>
        </div>
      </div>
    );
  }

  const rawValue = type === 'date' ? (value ? value.split('T')[0] : '') : (value ?? '');

  return (
    <div className="job-page-info-row clickable" onClick={() => startEdit(field, rawValue)}>
      <span className="job-page-info-label">{label}</span>
      {href && value ? (
        <a href={href} className="job-page-info-value" onClick={e => e.stopPropagation()}>{display}</a>
      ) : (
        <span className="job-page-info-value" style={{ color: isEmpty ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
          {display}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SELECT ROW — dropdown that saves immediately
   ═══════════════════════════════════════════════════ */
function SelectRow({ label, field, value, options, saveFieldDirect, saving, valueKey = 'value', labelKey = 'label' }) {
  return (
    <div className="job-page-info-row">
      <span className="job-page-info-label">{label}</span>
      <select
        className="input job-page-inline-select"
        value={value || ''}
        onChange={e => saveFieldDirect(field, e.target.value)}
        disabled={saving}
      >
        <option value="">—</option>
        {options.map(o => <option key={o[valueKey]} value={o[valueKey]}>{o[labelKey]}</option>)}
      </select>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════ */
function OverviewTab({ job, employees, phases, editProps, saveFieldDirect, fmtDate }) {
  const { editingField, editValue, saving, startEdit, cancelEdit, saveField, setEditValue, handleEditKeyDown } = editProps;

  return (
    <div className="job-page-grid">
      {/* Client Info */}
      <div className="job-page-section">
        <div className="job-page-section-title">Client Information</div>
        <EditableRow label="Name" field="insured_name" value={job.insured_name} editProps={editProps} />
        <EditableRow label="Phone" field="client_phone" value={job.client_phone} editProps={editProps} href={job.client_phone ? `tel:${job.client_phone}` : null} />
        <EditableRow label="Email" field="client_email" value={job.client_email} editProps={editProps} href={job.client_email ? `mailto:${job.client_email}` : null} />
        <EditableRow label="Address" field="address" value={job.address} editProps={editProps} />
        <EditableRow label="City" field="city" value={job.city} editProps={editProps} />
        <EditableRow label="State" field="state" value={job.state} editProps={editProps} />
        <EditableRow label="Zip" field="zip" value={job.zip} editProps={editProps} />
      </div>

      {/* Insurance */}
      <div className="job-page-section">
        <div className="job-page-section-title">Insurance</div>
        <EditableRow label="Company" field="insurance_company" value={job.insurance_company} editProps={editProps} />
        <EditableRow label="Claim #" field="claim_number" value={job.claim_number} editProps={editProps} />
        <EditableRow label="Policy #" field="policy_number" value={job.policy_number} editProps={editProps} />
        <EditableRow label="Adjuster" field="adjuster_name" value={job.adjuster_name || job.adjuster} editProps={editProps} />
        <EditableRow label="Adj. Phone" field="adjuster_phone" value={job.adjuster_phone} editProps={editProps} href={job.adjuster_phone ? `tel:${job.adjuster_phone}` : null} />
        <EditableRow label="Adj. Email" field="adjuster_email" value={job.adjuster_email} editProps={editProps} href={job.adjuster_email ? `mailto:${job.adjuster_email}` : null} />
        <EditableRow label="CAT Code" field="cat_code" value={job.cat_code} editProps={editProps} />
      </div>

      {/* Job Details */}
      <div className="job-page-section">
        <div className="job-page-section-title">Job Details</div>
        <EditableRow label="Job #" field="job_number" value={job.job_number} editProps={editProps} />
        <SelectRow label="Division" field="division" value={job.division} options={DIVISION_OPTIONS} saveFieldDirect={saveFieldDirect} saving={saving} />
        <SelectRow label="Priority" field="priority" value={job.priority} options={PRIORITY_OPTIONS} saveFieldDirect={(f, v) => saveFieldDirect(f, v ? parseInt(v) : null)} saving={saving} />
        <EditableRow label="Source" field="source" value={job.source} editProps={editProps} />
        <EditableRow label="Type of Loss" field="type_of_loss" value={job.type_of_loss} editProps={editProps} />
        <EditableRow label="Date of Loss" field="date_of_loss" value={job.date_of_loss} displayValue={fmtDate(job.date_of_loss)} type="date" editProps={editProps} />
        <EditableRow label="Received" field="received_date" value={job.received_date} displayValue={fmtDate(job.received_date)} type="date" editProps={editProps} />
        <EditableRow label="Target Complete" field="target_completion" value={job.target_completion} displayValue={fmtDate(job.target_completion)} type="date" editProps={editProps} />
        <EditableRow label="Encircle ID" field="encircle_claim_id" value={job.encircle_claim_id} editProps={editProps} />
      </div>

      {/* Team */}
      <div className="job-page-section">
        <div className="job-page-section-title">Team</div>
        <SelectRow label="Project Manager" field="project_manager_id" value={job.project_manager_id}
          options={employees.map(e => ({ value: e.id, label: e.full_name }))} saveFieldDirect={saveFieldDirect} saving={saving} />
        <SelectRow label="Lead Tech" field="lead_tech_id" value={job.lead_tech_id}
          options={employees.filter(e => e.role === 'field_tech').map(e => ({ value: e.id, label: e.full_name }))} saveFieldDirect={saveFieldDirect} saving={saving} />
        <EditableRow label="Broker/Agent" field="broker_agent" value={job.broker_agent} editProps={editProps} />

        {/* Flags */}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <FlagToggle label="CAT Loss" field="is_cat_loss" value={job.is_cat_loss} saveFieldDirect={saveFieldDirect} />
          <FlagToggle label="Asbestos" field="has_asbestos" value={job.has_asbestos} saveFieldDirect={saveFieldDirect} />
          <FlagToggle label="Lead" field="has_lead" value={job.has_lead} saveFieldDirect={saveFieldDirect} />
          <FlagToggle label="Permit Req." field="requires_permit" value={job.requires_permit} saveFieldDirect={saveFieldDirect} />
        </div>
      </div>

      {/* Internal Notes — full width */}
      <div className="job-page-section job-page-section-full">
        <div className="job-page-section-title">Internal Notes</div>
        {editingField === 'internal_notes' ? (
          <div>
            <textarea className="input textarea" value={editValue} onChange={e => setEditValue(e.target.value)} rows={5} autoFocus />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => saveField('internal_notes', editValue)} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="job-page-notes-content" onClick={() => startEdit('internal_notes', job.internal_notes)}>
            {job.internal_notes || 'Click to add notes...'}
          </div>
        )}
      </div>

      {/* Encircle Summary */}
      {job.encircle_summary && (
        <div className="job-page-section job-page-section-full">
          <div className="job-page-section-title">Encircle Summary</div>
          <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
            {job.encircle_summary}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Flag Toggle ── */
function FlagToggle({ label, field, value, saveFieldDirect }) {
  return (
    <button
      className={`job-page-flag-toggle${value ? ' active' : ''}`}
      onClick={() => saveFieldDirect(field, !value)}
    >
      {value ? '✓ ' : ''}{label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════
   FILES TAB (unchanged from previous version)
   ═══════════════════════════════════════════════════ */
function FilesTab({ job, documents, setDocuments, db, currentUser }) {
  const [uploading, setUploading] = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [uploadCategory, setUploadCategory] = useState('photo');
  const fileInputRef = useRef(null);

  const filtered = filterCat === 'all' ? documents : documents.filter(d => d.category === filterCat);

  const catCounts = useMemo(() => {
    const c = { all: documents.length };
    for (const d of documents) c[d.category] = (c[d.category] || 0) + 1;
    return c;
  }, [documents]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const storagePath = `${job.id}/${Date.now()}-${file.name}`;
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${storagePath}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${db.apiKey}`, 'apikey': db.apiKey },
          body: formData,
        });
        if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);
        const doc = {
          job_id: job.id, name: file.name, file_path: storagePath, file_size: file.size,
          mime_type: file.type, category: uploadCategory, uploaded_by: currentUser?.id || null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        const inserted = await db.insert('job_documents', doc);
        if (inserted?.length > 0) setDocuments(prev => [inserted[0], ...prev]);
        else { const d = await db.select('job_documents', `job_id=eq.${job.id}&order=created_at.desc`); setDocuments(d); }
      }
    } catch (err) { alert('Upload failed: ' + err.message); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleDelete = async (doc) => {
    if (!confirm(`Delete "${doc.name}"?`)) return;
    try {
      await fetch(`${db.baseUrl}/storage/v1/object/job-files/${doc.file_path}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${db.apiKey}`, 'apikey': db.apiKey },
      });
      await db.delete('job_documents', `id=eq.${doc.id}`);
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    } catch (err) { alert('Delete failed: ' + err.message); }
  };

  const getFileUrl = (doc) => `${db.baseUrl}/storage/v1/object/public/job-files/${doc.file_path}`;
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };
  const isImage = (doc) => doc.mime_type?.startsWith('image/');

  return (
    <div className="job-page-files">
      <div className="job-page-files-toolbar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          <select className="input" value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} style={{ width: 'auto', minWidth: 130, height: 32 }}>
            {FILE_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
          <input ref={fileInputRef} type="file" multiple onChange={handleUpload} style={{ display: 'none' }} accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv" />
        </div>
      </div>
      <div className="job-page-files-cats">
        <button className={`job-page-files-cat${filterCat === 'all' ? ' active' : ''}`} onClick={() => setFilterCat('all')}>All ({catCounts.all || 0})</button>
        {FILE_CATEGORIES.map(c => {
          const count = catCounts[c.key] || 0;
          if (count === 0 && filterCat !== c.key) return null;
          return <button key={c.key} className={`job-page-files-cat${filterCat === c.key ? ' active' : ''}`} onClick={() => setFilterCat(c.key)}>{c.label} ({count})</button>;
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-state-icon">📁</div><div className="empty-state-text">No files yet</div><div className="empty-state-sub">Upload photos, estimates, invoices, and more</div></div>
      ) : (
        <div className="job-page-files-grid">
          {filtered.map(doc => (
            <div key={doc.id} className="job-page-file-card">
              {isImage(doc) ? (
                <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview"><img src={getFileUrl(doc)} alt={doc.name} loading="lazy" /></a>
              ) : (
                <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-preview job-page-file-icon-preview">{doc.mime_type?.includes('pdf') ? '📄' : '📎'}</a>
              )}
              <div className="job-page-file-info">
                <a href={getFileUrl(doc)} target="_blank" rel="noopener noreferrer" className="job-page-file-name">{doc.name}</a>
                <div className="job-page-file-meta"><span className="job-page-file-cat-badge">{doc.category}</span>{doc.file_size && <span>{formatSize(doc.file_size)}</span>}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(doc)} title="Delete" style={{ flexShrink: 0, padding: '2px 6px', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   FINANCIAL TAB — editable
   ═══════════════════════════════════════════════════ */
function FinancialTab({ job, fmt, editProps, saveFieldDirect }) {
  const estimated = Number(job.estimated_value || 0);
  const approved = Number(job.approved_value || 0);
  const invoiced = Number(job.invoiced_value || 0);
  const collected = Number(job.collected_value || 0);
  const deductible = Number(job.deductible || 0);
  const deprecHeld = Number(job.depreciation_held || 0);
  const deprecReleased = Number(job.depreciation_released || 0);
  const supplement = Number(job.supplement_value || 0);

  const laborCost = Number(job.total_labor_cost || 0);
  const materialCost = Number(job.total_material_cost || 0);
  const equipCost = Number(job.total_equipment_cost || 0);
  const subCost = Number(job.total_sub_cost || 0);
  const otherCost = Number(job.total_other_cost || 0);
  const totalCost = laborCost + materialCost + equipCost + subCost + otherCost;

  const revenueBase = approved > 0 ? approved : estimated;
  const grossProfit = revenueBase - totalCost;
  const margin = revenueBase > 0 ? ((grossProfit / revenueBase) * 100).toFixed(1) : '0.0';
  const outstanding = invoiced - collected;

  return (
    <div className="job-page-financial">
      {/* Revenue — editable */}
      <div className="job-page-section">
        <div className="job-page-section-title">Revenue</div>
        <EditableRow label="Estimated" field="estimated_value" value={job.estimated_value} displayValue={fmt(estimated)} type="number" editProps={editProps} />
        <EditableRow label="Approved" field="approved_value" value={job.approved_value} displayValue={fmt(approved)} type="number" editProps={editProps} />
        <EditableRow label="Invoiced" field="invoiced_value" value={job.invoiced_value} displayValue={fmt(invoiced)} type="number" editProps={editProps} />
        <EditableRow label="Collected" field="collected_value" value={job.collected_value} displayValue={fmt(collected)} type="number" editProps={editProps} />
      </div>

      {/* Insurance Details — editable */}
      <div className="job-page-section">
        <div className="job-page-section-title">Insurance Financials</div>
        <EditableRow label="Deductible" field="deductible" value={job.deductible} displayValue={fmt(deductible)} type="number" editProps={editProps} />
        <EditableRow label="Depreciation Held" field="depreciation_held" value={job.depreciation_held} displayValue={fmt(deprecHeld)} type="number" editProps={editProps} />
        <EditableRow label="Depreciation Released" field="depreciation_released" value={job.depreciation_released} displayValue={fmt(deprecReleased)} type="number" editProps={editProps} />
        <EditableRow label="Supplement" field="supplement_value" value={job.supplement_value} displayValue={fmt(supplement)} type="number" editProps={editProps} />
      </div>

      {/* Costs — editable */}
      <div className="job-page-section">
        <div className="job-page-section-title">Cost Breakdown</div>
        <EditableRow label="Labor" field="total_labor_cost" value={job.total_labor_cost} displayValue={fmt(laborCost)} type="number" editProps={editProps} />
        <EditableRow label="Materials" field="total_material_cost" value={job.total_material_cost} displayValue={fmt(materialCost)} type="number" editProps={editProps} />
        <EditableRow label="Equipment" field="total_equipment_cost" value={job.total_equipment_cost} displayValue={fmt(equipCost)} type="number" editProps={editProps} />
        <EditableRow label="Subcontractors" field="total_sub_cost" value={job.total_sub_cost} displayValue={fmt(subCost)} type="number" editProps={editProps} />
        <EditableRow label="Other" field="total_other_cost" value={job.total_other_cost} displayValue={fmt(otherCost)} type="number" editProps={editProps} />
        <div className="job-page-fin-divider" />
        <div className="job-page-info-row"><span className="job-page-info-label" style={{ fontWeight: 600 }}>Total Cost</span><span className="job-page-info-value" style={{ fontWeight: 700 }}>{fmt(totalCost)}</span></div>
      </div>

      {/* Profitability — calculated, read-only */}
      <div className="job-page-section">
        <div className="job-page-section-title">Profitability</div>
        <div className="job-page-info-row"><span className="job-page-info-label">{approved > 0 ? 'Approved Rev.' : 'Estimated Rev.'}</span><span className="job-page-info-value">{fmt(revenueBase)}</span></div>
        <div className="job-page-info-row"><span className="job-page-info-label">Total Cost</span><span className="job-page-info-value">{fmt(totalCost)}</span></div>
        <div className="job-page-fin-divider" />
        <div className="job-page-info-row"><span className="job-page-info-label" style={{ fontWeight: 600 }}>Gross Profit</span>
          <span className="job-page-info-value" style={{ fontWeight: 700, color: grossProfit >= 0 ? 'var(--status-resolved)' : 'var(--status-needs-response)' }}>{fmt(grossProfit)}</span></div>
        <div className="job-page-info-row"><span className="job-page-info-label" style={{ fontWeight: 600 }}>Margin</span>
          <span className="job-page-info-value" style={{ fontWeight: 700, color: grossProfit >= 0 ? 'var(--status-resolved)' : 'var(--status-needs-response)' }}>{margin}%</span></div>
        {outstanding > 0 && (
          <div className="job-page-info-row"><span className="job-page-info-label">Outstanding</span><span className="job-page-info-value" style={{ color: '#d97706', fontWeight: 600 }}>{fmt(outstanding)}</span></div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ACTIVITY TAB (unchanged)
   ═══════════════════════════════════════════════════ */
function ActivityTab({ job, notes, setNotes, history, employees, phaseMap, db, currentUser, fmtDateTime }) {
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const empMap = useMemo(() => { const m = {}; for (const e of employees) m[e.id] = e; return m; }, [employees]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const note = { job_id: job.id, author_id: currentUser?.id || null, content: newNote.trim(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const inserted = await db.insert('job_notes', note);
      if (inserted?.length > 0) setNotes(prev => [inserted[0], ...prev]);
      else { const d = await db.select('job_notes', `job_id=eq.${job.id}&order=created_at.desc`); setNotes(d); }
      setNewNote('');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setSavingNote(false); }
  };

  const handleDeleteNote = async (noteId) => {
    if (!confirm('Delete this note?')) return;
    try { await db.delete('job_notes', `id=eq.${noteId}`); setNotes(prev => prev.filter(n => n.id !== noteId)); }
    catch (err) { alert('Failed: ' + err.message); }
  };

  const timeline = useMemo(() => {
    const items = [];
    for (const note of notes) {
      items.push({ type: 'note', id: note.id, date: note.created_at, content: note.content, author: empMap[note.author_id]?.full_name || 'Unknown', raw: note });
    }
    for (const h of history) {
      const fromLabel = phaseMap[h.from_phase]?.label || h.from_phase;
      const toLabel = phaseMap[h.to_phase]?.label || h.to_phase;
      items.push({ type: 'phase_change', id: h.id, date: h.changed_at, content: `Phase changed: ${fromLabel} → ${toLabel}`, author: empMap[h.changed_by]?.full_name || 'System' });
    }
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    return items;
  }, [notes, history, empMap, phaseMap]);

  return (
    <div className="job-page-activity">
      <div className="job-page-note-compose">
        <textarea className="input textarea" placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={3} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
            {savingNote ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>
      {timeline.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 32 }}><div className="empty-state-icon">📝</div><div className="empty-state-text">No activity yet</div></div>
      ) : (
        <div className="job-page-timeline">
          {timeline.map(item => (
            <div key={`${item.type}-${item.id}`} className={`job-page-timeline-item timeline-${item.type}`}>
              <div className="job-page-timeline-dot" />
              <div className="job-page-timeline-content">
                <div className="job-page-timeline-header">
                  <span className="job-page-timeline-author">{item.author}</span>
                  <span className="job-page-timeline-time">{fmtDateTime(item.date)}</span>
                </div>
                <div className="job-page-timeline-text">{item.content}</div>
                {item.type === 'note' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteNote(item.id)} style={{ padding: '0 4px', fontSize: 11, marginTop: 4, height: 20 }}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */
function phaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed', 'paid'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled', 'waiting_on_approval', 'waiting_for_deductible', 'awaiting_payment'].includes(phase)) return 'waiting';
  if (['lead', 'emergency', 'job_received'].includes(phase)) return 'needs-response';
  return 'active';
}
