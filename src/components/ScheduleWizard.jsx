import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ═══════════════════════════════════════════════════════════════
// SCHEDULE WIZARD
// PM picks template + start date → preview → generate entire schedule
// ═══════════════════════════════════════════════════════════════

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtRange(start, end) {
  if (start === end) return fmtDate(start);
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

export default function ScheduleWizard({ jobId, jobName, onClose, onGenerated }) {
  const { db, employee } = useAuth();

  const [step, setStep] = useState('pick'); // 'pick' | 'preview' | 'generating' | 'done'
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [startDate, setStartDate] = useState(() => {
    // Default to next Monday
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day));
    return d.toISOString().split('T')[0];
  });
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Load templates
  useEffect(() => {
    db.rpc('get_schedule_templates')
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setTemplates(list);
        if (list.length === 1) setSelectedTemplate(list[0].id);
      })
      .catch(() => {});
  }, [db]);

  // Load preview when template + date are set
  const loadPreview = async () => {
    if (!selectedTemplate || !startDate) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const data = await db.rpc('preview_schedule', {
        p_template_id: selectedTemplate,
        p_start_date: startDate,
        p_skip_weekends: skipWeekends,
      });
      setPreview(data);
      setStep('preview');
    } catch (e) {
      setError('Failed to generate preview: ' + e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Generate the full schedule
  const generateSchedule = async () => {
    setStep('generating');
    setError(null);
    try {
      const data = await db.rpc('generate_full_schedule', {
        p_job_id: jobId,
        p_template_id: selectedTemplate,
        p_start_date: startDate,
        p_skip_weekends: skipWeekends,
        p_phase_overrides: [],
        p_created_by: employee?.id || null,
      });
      setResult(data);
      setStep('done');
    } catch (e) {
      setError('Failed to generate schedule: ' + e.message);
      setStep('preview');
    }
  };

  const totalTasks = preview?.phases?.reduce((s, p) => s + (p.task_count || 0), 0) || 0;
  const nonMilestonePhases = preview?.phases?.filter(p => !p.is_milestone) || [];
  const milestonePhases = preview?.phases?.filter(p => p.is_milestone) || [];

  return (
    <div style={W.overlay} onClick={onClose}>
      <div style={W.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={W.header}>
          <div>
            <div style={W.title}>
              {step === 'done' ? 'Schedule created' : 'Generate schedule'}
            </div>
            <div style={W.subtitle}>{jobName}</div>
          </div>
          <button style={W.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={W.body}>
          {error && (
            <div style={W.error}>{error}</div>
          )}

          {/* ═══ STEP 1: Pick template + date ═══ */}
          {step === 'pick' && (
            <>
              <div style={W.field}>
                <label style={W.label}>Template</label>
                <select style={W.input} value={selectedTemplate || ''}
                  onChange={e => setSelectedTemplate(e.target.value || null)}>
                  <option value="">Select a template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ ...W.field, flex: 1 }}>
                  <label style={W.label}>Start date</label>
                  <input type="date" style={W.input} value={startDate}
                    onChange={e => setStartDate(e.target.value)} />
                </div>
                <div style={{ ...W.field, flex: 1 }}>
                  <label style={W.label}>&nbsp;</label>
                  <label style={W.checkLabel}>
                    <input type="checkbox" checked={skipWeekends}
                      onChange={e => setSkipWeekends(e.target.checked)} />
                    Skip weekends
                  </label>
                </div>
              </div>

              {selectedTemplate && (
                <div style={W.hint}>
                  The system will calculate dates for every phase based on the template's
                  durations and dependency chain. You'll review everything before confirming.
                </div>
              )}
            </>
          )}

          {/* ═══ STEP 2: Preview ═══ */}
          {step === 'preview' && preview && (
            <>
              {/* Summary bar */}
              <div style={W.summaryBar}>
                <div style={W.summaryItem}>
                  <div style={W.summaryValue}>{preview.project_start} to {preview.project_end}</div>
                  <div style={W.summaryLabel}>Project span</div>
                </div>
                <div style={W.summaryItem}>
                  <div style={W.summaryValue}>{nonMilestonePhases.length} phases</div>
                  <div style={W.summaryLabel}>{totalTasks} tasks</div>
                </div>
                <div style={W.summaryItem}>
                  <div style={W.summaryValue}>{milestonePhases.length} milestones</div>
                  <div style={W.summaryLabel}>Inspections + walkthrough</div>
                </div>
              </div>

              <div style={W.sectionTitle}>Schedule preview</div>

              {/* Phase list */}
              {preview.phases.map((phase, i) => (
                <div key={phase.phase_id} style={{
                  ...W.phaseRow,
                  opacity: phase.is_milestone ? 0.7 : 1,
                }}>
                  <div style={{
                    width: 4, borderRadius: 2, background: phase.color || '#6b7280',
                    alignSelf: 'stretch', flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={W.phaseName}>{phase.name}</span>
                      {phase.is_milestone && (
                        <span style={W.milestoneBadge}>Milestone</span>
                      )}
                      {phase.task_count > 0 && (
                        <span style={W.taskBadge}>{phase.task_count} tasks</span>
                      )}
                    </div>
                    <div style={W.phaseDate}>
                      {fmtRange(phase.start_date, phase.end_date)}
                      {!phase.is_milestone && phase.duration_days > 1 && (
                        <span style={{ color: 'var(--text-tertiary)' }}> ({phase.duration_days} days)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <div style={W.hint}>
                Crew can be assigned after generating — either on individual appointments
                on the dispatch board, or in the job detail page.
              </div>
            </>
          )}

          {/* ═══ STEP 3: Generating ═══ */}
          {step === 'generating' && (
            <div style={W.center}>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                Creating {nonMilestonePhases.length} appointments and {totalTasks} tasks...
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Done ═══ */}
          {step === 'done' && result && (
            <div style={{ padding: '20px 0' }}>
              <div style={W.successBox}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#065f46', marginBottom: 8 }}>
                  Schedule generated successfully
                </div>
                <div style={{ fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                  {result.appointments_created} appointments created from {result.project_start} to {result.project_end}.
                  {result.tasks_created} tasks assigned across all phases.
                </div>
              </div>

              <div style={W.hint}>
                Open the dispatch board to see this job's full schedule. You can assign crew,
                adjust dates, and split appointments as needed.
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
                {previewLoading ? 'Calculating...' : 'Preview schedule'}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button style={W.cancelBtn} onClick={() => setStep('pick')}>Back</button>
              <button style={W.primaryBtn} onClick={generateSchedule}>
                Generate {nonMilestonePhases.length} appointments
              </button>
            </>
          )}
          {step === 'done' && (
            <button style={W.primaryBtn} onClick={() => { onGenerated?.(); onClose(); }}>
              Done — go to dispatch board
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
  closeBtn: {
    fontSize: 16, color: 'var(--text-tertiary)', background: 'none',
    border: 'none', cursor: 'pointer', padding: 4,
  },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)',
  },
  checkLabel: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
    color: 'var(--text-secondary)', cursor: 'pointer', height: 38,
  },
  hint: {
    fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5,
    marginTop: 12, padding: '10px 12px', background: 'var(--bg-tertiary)',
    borderRadius: 'var(--radius-md)',
  },
  error: {
    fontSize: 12, color: '#991b1b', background: '#fef2f2', padding: '8px 12px',
    borderRadius: 'var(--radius-md)', marginBottom: 12,
  },
  summaryBar: {
    display: 'flex', gap: 12, marginBottom: 16,
  },
  summaryItem: {
    flex: 1, padding: '10px 12px', background: 'var(--bg-tertiary)',
    borderRadius: 'var(--radius-md)', textAlign: 'center',
  },
  summaryValue: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  summaryLabel: { fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: 'var(--text-tertiary)', marginBottom: 8,
  },
  phaseRow: {
    display: 'flex', gap: 10, padding: '8px 0',
    borderBottom: '1px solid var(--border-light)',
  },
  phaseName: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  phaseDate: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  milestoneBadge: {
    fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
    background: '#fffbeb', color: '#92400e', border: '1px solid #f59e0b30',
  },
  taskBadge: {
    fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
    background: 'var(--accent-light)', color: 'var(--accent)',
  },
  successBox: {
    padding: '16px', background: '#ecfdf5', borderRadius: 'var(--radius-md)',
    border: '1px solid #a7f3d0',
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '40px 0',
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
  primaryBtn: {
    fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
};
