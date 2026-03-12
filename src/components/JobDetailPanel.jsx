import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const PRIORITY_LABELS = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };
const PRIORITY_COLORS = { 1: 'var(--status-needs-response)', 2: '#f59e0b', 3: 'var(--accent)', 4: 'var(--text-tertiary)' };

export default function JobDetailPanel({ job, phases, employees, onClose, onUpdate }) {
  const { db, employee: currentUser } = useAuth();
  const [editing, setEditing] = useState(null); // which field is being edited
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (job?.id) {
      db.select('job_phase_history', `job_id=eq.${job.id}&order=changed_at.desc&limit=20`)
        .then(setHistory)
        .catch(() => setHistory([]));
    }
  }, [job?.id, db]);

  if (!job) return null;

  const handlePhaseChange = async (newPhase) => {
    if (newPhase === job.phase) return;
    setSaving(true);
    try {
      // Update job
      await db.update('jobs', `id=eq.${job.id}`, {
        phase: newPhase,
        phase_entered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Log phase change
      await db.insert('job_phase_history', {
        job_id: job.id,
        from_phase: job.phase,
        to_phase: newPhase,
        changed_by: currentUser?.id || null,
        changed_at: new Date().toISOString(),
      });

      onUpdate({ ...job, phase: newPhase, phase_entered_at: new Date().toISOString() });
    } catch (err) {
      console.error('Phase change error:', err);
      alert('Failed to update phase: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldSave = async (field, value) => {
    setSaving(true);
    try {
      const update = { [field]: value || null, updated_at: new Date().toISOString() };
      await db.update('jobs', `id=eq.${job.id}`, update);
      onUpdate({ ...job, ...update });
      setEditing(null);
    } catch (err) {
      console.error('Field save error:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (field, currentValue) => {
    setEditing(field);
    setEditValue(currentValue || '');
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValue('');
  };

  const formatCurrency = (val) => {
    if (val === null || val === undefined) return '—';
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString();
  };

  const phaseLabel = phases.find(p => p.key === job.phase)?.label || job.phase;

  const totalCosts = [
    Number(job.total_labor_cost || 0),
    Number(job.total_material_cost || 0),
    Number(job.total_equipment_cost || 0),
    Number(job.total_sub_cost || 0),
    Number(job.total_other_cost || 0),
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="job-detail-overlay" onClick={onClose}>
      <div className="job-detail-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="job-detail-header">
          <div>
            <div className="job-detail-jobnumber">{job.job_number || 'No Job #'}</div>
            <div className="job-detail-client">{job.insured_name || 'Unknown Client'}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {/* Phase Selector */}
        <div className="job-detail-section">
          <div className="job-detail-label">Phase</div>
          <select
            className="input"
            value={job.phase}
            onChange={e => handlePhaseChange(e.target.value)}
            disabled={saving}
            style={{ fontWeight: 600 }}
          >
            {phases.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
            {/* Include current phase if it doesn't match any defined phase */}
            {!phases.some(p => p.key === job.phase) && (
              <option value={job.phase}>{job.phase} (unmapped)</option>
            )}
          </select>
          {job.phase_entered_at && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
              In this phase since {formatDate(job.phase_entered_at)}
            </div>
          )}
        </div>

        {/* Priority */}
        <div className="job-detail-section">
          <div className="job-detail-label">Priority</div>
          <select
            className="input"
            value={job.priority || 3}
            onChange={e => handleFieldSave('priority', parseInt(e.target.value))}
            disabled={saving}
          >
            <option value={1}>🔴 Urgent</option>
            <option value={2}>🟡 High</option>
            <option value={3}>🔵 Normal</option>
            <option value={4}>⚪ Low</option>
          </select>
        </div>

        <div className="job-detail-divider" />

        {/* Client Info */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Client Info</div>
          <DetailRow label="Name" value={job.insured_name} />
          <DetailRow label="Phone" value={job.client_phone} href={job.client_phone ? `tel:${job.client_phone}` : null} />
          <DetailRow label="Email" value={job.client_email} href={job.client_email ? `mailto:${job.client_email}` : null} />
          <DetailRow label="Address" value={job.address} />
        </div>

        <div className="job-detail-divider" />

        {/* Job Info */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Job Details</div>
          <DetailRow label="Division" value={job.division} />
          <DetailRow label="Source" value={job.source} />
          <DetailRow label="Type of Loss" value={job.type_of_loss} />
          <DetailRow label="Date of Loss" value={formatDate(job.date_of_loss)} />
          <DetailRow label="Received" value={formatDate(job.received_date)} />
          <DetailRow label="Target Complete" value={formatDate(job.target_completion)} />
          <DetailRow label="Encircle ID" value={job.encircle_claim_id} />
        </div>

        <div className="job-detail-divider" />

        {/* Insurance */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Insurance</div>
          <DetailRow label="Company" value={job.insurance_company} />
          <DetailRow label="Claim #" value={job.claim_number} />
          <DetailRow label="Policy #" value={job.policy_number} />
          <DetailRow label="Adjuster" value={job.adjuster_name || job.adjuster} />
          <DetailRow label="Adj. Phone" value={job.adjuster_phone} href={job.adjuster_phone ? `tel:${job.adjuster_phone}` : null} />
          <DetailRow label="Adj. Email" value={job.adjuster_email} href={job.adjuster_email ? `mailto:${job.adjuster_email}` : null} />
          <DetailRow label="CAT Code" value={job.cat_code} />
        </div>

        <div className="job-detail-divider" />

        {/* Financials */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Financials</div>
          <DetailRow label="Estimated" value={formatCurrency(job.estimated_value)} />
          <DetailRow label="Approved" value={formatCurrency(job.approved_value)} />
          <DetailRow label="Invoiced" value={formatCurrency(job.invoiced_value)} />
          <DetailRow label="Collected" value={formatCurrency(job.collected_value)} />
          <DetailRow label="Deductible" value={formatCurrency(job.deductible)} />
          <DetailRow label="Depreciation Held" value={formatCurrency(job.depreciation_held)} />
          <DetailRow label="Supplement" value={formatCurrency(job.supplement_value)} />

          {totalCosts > 0 && (
            <>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
                <DetailRow label="Labor Cost" value={formatCurrency(job.total_labor_cost)} />
                <DetailRow label="Material Cost" value={formatCurrency(job.total_material_cost)} />
                <DetailRow label="Equipment Cost" value={formatCurrency(job.total_equipment_cost)} />
                <DetailRow label="Sub Cost" value={formatCurrency(job.total_sub_cost)} />
                <DetailRow label="Total Cost" value={formatCurrency(totalCosts)} bold />
              </div>
            </>
          )}
        </div>

        <div className="job-detail-divider" />

        {/* Team */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Team</div>
          <div className="job-detail-label" style={{ marginTop: 4 }}>Project Manager</div>
          <select
            className="input"
            value={job.project_manager_id || ''}
            onChange={e => handleFieldSave('project_manager_id', e.target.value || null)}
            disabled={saving}
          >
            <option value="">Unassigned</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>

          <div className="job-detail-label" style={{ marginTop: 8 }}>Lead Tech</div>
          <select
            className="input"
            value={job.lead_tech_id || ''}
            onChange={e => handleFieldSave('lead_tech_id', e.target.value || null)}
            disabled={saving}
          >
            <option value="">Unassigned</option>
            {employees.filter(e => e.role === 'field_tech').map(emp => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
          {job.project_manager && (
            <DetailRow label="PM (Encircle)" value={job.project_manager} />
          )}
        </div>

        <div className="job-detail-divider" />

        {/* Flags */}
        {(job.is_cat_loss || job.has_asbestos || job.has_lead || job.requires_permit) && (
          <>
            <div className="job-detail-section">
              <div className="job-detail-section-title">Flags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {job.is_cat_loss && <span className="job-flag flag-red">CAT Loss</span>}
                {job.has_asbestos && <span className="job-flag flag-red">Asbestos</span>}
                {job.has_lead && <span className="job-flag flag-red">Lead</span>}
                {job.requires_permit && <span className="job-flag flag-yellow">Permit Req.</span>}
              </div>
            </div>
            <div className="job-detail-divider" />
          </>
        )}

        {/* Internal Notes */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Internal Notes</div>
          {editing === 'internal_notes' ? (
            <div>
              <textarea
                className="input textarea"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                rows={4}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={() => handleFieldSave('internal_notes', editValue)} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            <div
              style={{ fontSize: 'var(--text-sm)', color: job.internal_notes ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer', minHeight: 32, whiteSpace: 'pre-wrap' }}
              onClick={() => startEdit('internal_notes', job.internal_notes)}
            >
              {job.internal_notes || 'Click to add notes...'}
            </div>
          )}
        </div>

        <div className="job-detail-divider" />

        {/* Phase History */}
        <div className="job-detail-section">
          <div className="job-detail-section-title">Phase History</div>
          {history.length === 0 ? (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>No phase changes recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {history.map(h => (
                <div key={h.id} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{h.from_phase}</span>
                    {' → '}
                    <span style={{ fontWeight: 600 }}>{h.to_phase}</span>
                  </span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{formatDate(h.changed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="job-detail-section" style={{ paddingBottom: 32 }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Created {formatDate(job.created_at)} · Updated {formatDate(job.updated_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, href, bold }) {
  const displayValue = value || '—';
  const isEmpty = !value || value === '—' || value === '$0.00';

  return (
    <div className="job-detail-row">
      <span className="job-detail-row-label">{label}</span>
      {href ? (
        <a href={href} style={{ fontWeight: bold ? 600 : 400 }}>{displayValue}</a>
      ) : (
        <span className="job-detail-row-value" style={{
          fontWeight: bold ? 600 : 400,
          color: isEmpty ? 'var(--text-tertiary)' : 'var(--text-primary)',
        }}>
          {displayValue}
        </span>
      )}
    </div>
  );
}
