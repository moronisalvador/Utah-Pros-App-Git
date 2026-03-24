import { useState } from 'react';
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';

/* ═══ ICONS ═══ */
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}

const DIVISION_OPTIONS = [
  { value: 'water', label: '💧 Water Mitigation', emoji: '💧' },
  { value: 'mold', label: '🦠 Mold Remediation', emoji: '🦠' },
  { value: 'reconstruction', label: '🏗️ Reconstruction', emoji: '🏗️' },
  { value: 'fire', label: '🔥 Fire', emoji: '🔥' },
  { value: 'contents', label: '📦 Contents', emoji: '📦' },
];

const PRIORITY_OPTIONS = [
  { value: 1, label: 'Urgent' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Low' },
];

/**
 * AddRelatedJobModal
 * Creates a sibling job under the same claim.
 * Pre-fills from the source job's claim data — user only picks division + priority.
 *
 * Props:
 *   sourceJob   - the job we're branching from (needs id, insured_name, address, claim_id)
 *   claimData   - { claim_number, insurance_carrier, date_of_loss, loss_address }
 *   siblingJobs - array of existing jobs under this claim (to show what exists)
 *   employees   - for PM/lead tech selects
 *   onClose     - close modal
 *   onCreated   - callback after job created: (newJob) => {}
 *   db          - supabase REST client
 */
export default function AddRelatedJobModal({ sourceJob, claimData, siblingJobs, employees, onClose, onCreated, db }) {
  const [division, setDivision] = useState('reconstruction');
  const [priority, setPriority] = useState(3);
  const [pmId, setPmId] = useState(sourceJob?.project_manager_id || '');
  const [leadTechId, setLeadTechId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Figure out which divisions already exist under this claim
  const existingDivisions = (siblingJobs || []).map(j => j.division);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await db.rpc('add_related_job', {
        p_source_job_id: sourceJob.id,
        p_division: division,
        p_priority: priority,
        p_internal_notes: notes || null,
        p_project_manager_id: pmId || null,
        p_lead_tech_id: leadTechId || null,
      });
      onCreated?.(result);
    } catch (err) {
      console.error('Add related job:', err);
      setError('Failed to create job: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="conv-modal-backdrop" onClick={onClose}>
      <div className="conv-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        {/* Header */}
        <div className="conv-modal-header">
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Add Related Job</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0 }}>
            <IconX style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-4)', overflowY: 'auto' }}>
          {/* Claim context */}
          <div style={{ padding: 'var(--space-3)', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)', marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase',
              letterSpacing: '0.05em', marginBottom: 'var(--space-2)' }}>
              Same Claim / Occurrence
            </div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {sourceJob.insured_name || 'Client'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {claimData?.claim_number}
              {claimData?.insurance_carrier && <> · {claimData.insurance_carrier}</>}
            </div>
            {(sourceJob.address || claimData?.loss_address) && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                📍 {sourceJob.address || claimData?.loss_address}
              </div>
            )}
            {/* Existing jobs under this claim */}
            {siblingJobs && siblingJobs.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                {siblingJobs.map(sj => {
                  const div = DIVISION_OPTIONS.find(d => d.value === sj.division);
                  return (
                    <span key={sj.id} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 99, background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)' }}>
                      {div?.emoji || '📁'} {sj.job_number || sj.division}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {error && <div className="create-job-error" style={{ marginBottom: 'var(--space-3)' }}>{error}</div>}

          {/* Division picker — card grid */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className="label" style={{ marginBottom: 'var(--space-2)' }}>Division *</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--space-2)' }}>
              {DIVISION_OPTIONS.map(opt => {
                const exists = existingDivisions.includes(opt.value);
                const selected = division === opt.value;
                return (
                  <button key={opt.value} onClick={() => setDivision(opt.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 12px', borderRadius: 'var(--radius-md)',
                      border: selected ? '2px solid var(--brand-primary)' : '1px solid var(--border-color)',
                      background: selected ? 'var(--brand-primary-light)' : 'var(--bg-primary)',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
                      transition: 'border-color 0.15s',
                    }}>
                    <span style={{ fontSize: 18 }}>{opt.emoji}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: selected ? 'var(--brand-primary)' : 'var(--text-primary)' }}>
                        {opt.label.replace(/^[^\s]+\s/, '')}
                      </div>
                      {exists && (
                        <div style={{ fontSize: 10, color: 'var(--status-waiting)', fontWeight: 500 }}>Already exists</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
            <label className="label">Priority</label>
            <select className="input" value={priority} onChange={e => setPriority(parseInt(e.target.value))}>
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Team (optional) */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label">Project Manager</label>
              <select className="input" value={pmId} onChange={e => setPmId(e.target.value)}>
                <option value="">Same as current</option>
                {(employees || []).map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label">Lead Tech</label>
              <select className="input" value={leadTechId} onChange={e => setLeadTechId(e.target.value)}>
                <option value="">Unassigned</option>
                {(employees || []).filter(e => e.role === 'field_tech').map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Notes (optional)</label>
            <textarea className="input textarea" value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="Initial notes for this job..." />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border-color)' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
