import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DivisionIcon, DIVISION_COLORS } from '@/components/DivisionIcons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch, IconOpenPage } from '@/components/Icons';
import JobDetailPanel from '@/components/JobDetailPanel';
import PullToRefresh from '@/components/PullToRefresh';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

// ── Macro group definitions ──
const MACRO_GROUPS = [
  {
    key: 'leads',
    label: 'Leads',
    color: '#8b5cf6',
    emoji: '🎯',
    description: 'New jobs and incoming leads',
    phases: ['job_received', 'lead'],
  },
  {
    key: 'mitigation',
    label: 'Mitigation',
    color: '#2563eb',
    emoji: '💧',
    description: 'Active mitigation work',
    phases: ['emergency', 'inspection', 'waiting_on_approval', 'mitigation', 'demolition', 'drying', 'mitigation_complete', 'on_hold'],
  },
  {
    key: 'reconstruction',
    label: 'Reconstruction',
    color: '#d97706',
    emoji: '🏗️',
    description: 'Rebuild and restoration',
    phases: ['estimate_pending', 'awaiting_payment', 'ready_to_start', 'drywall', 'carpentry', 'painting', 'floors', 'cabinetry', 'other_recon', 'final_walk_through', 'closeout', 'on_hold'],
  },
  {
    key: 'billing',
    label: 'Billing',
    color: '#059669',
    emoji: '💰',
    description: 'Estimates, negotiation, and payment',
    phases: ['estimate_pending', 'waiting_for_deductible', 'insurance_negotiation', 'awaiting_payment', 'paid'],
  },
];

const TERMINAL_PHASES = ['completed', 'closed', 'cancelled'];

// Touch detection
const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export default function Production() {
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState('pipeline');

  const [activeGroup, setActiveGroup] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterDivision, setFilterDivision] = useState('all');
  const [filterPhase, setFilterPhase] = useState('all');

  // Detail panel
  const [selectedJob, setSelectedJob] = useState(null);

  // Desktop drag and drop
  const [dragJob, setDragJob] = useState(null);
  const [dragOverPhase, setDragOverPhase] = useState(null);

  // Mobile long-press phase picker
  const [phasePickerJob, setPhasePickerJob] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoadError(null);
    try {
      const [jobsData, phasesData, empsData] = await Promise.all([
        db.select('jobs', 'status=neq.deleted&order=created_at.desc&select=id,job_number,insured_name,phase,division,source,status,address,city,state,zip,client_email,client_phone,insurance_company,claim_number,adjuster_name,adjuster_phone,adjuster_email,policy_number,cat_code,date_of_loss,received_date,target_completion,actual_completion,type_of_loss,adjuster,project_manager,broker_agent,encircle_claim_id,encircle_summary,project_manager_id,lead_tech_id,estimated_value,approved_value,invoiced_value,collected_value,deductible,depreciation_held,depreciation_released,supplement_value,priority,internal_notes,tags,is_cat_loss,has_asbestos,has_lead,requires_permit,phase_entered_at,total_labor_cost,total_material_cost,total_equipment_cost,total_sub_cost,total_other_cost,lead_source,created_at,updated_at'),
        db.select('job_phases', 'is_active=eq.true&order=display_order.asc'),
        db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
      ]);
      setJobs(jobsData);
      setPhases(phasesData);
      setEmployees(empsData);
    } catch (err) {
      console.error('Production load error:', err);
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const phaseMap = useMemo(() => {
    const m = {};
    for (const p of phases) m[p.key] = p;
    return m;
  }, [phases]);

  const divisions = useMemo(() =>
    [...new Set(jobs.map(j => j.division).filter(Boolean))].sort()
  , [jobs]);

  const baseFilteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (filterDivision !== 'all' && j.division !== filterDivision) return false;
      if (search) {
        const q = search.toLowerCase();
        const s = [j.insured_name, j.job_number, j.address, j.claim_number, j.insurance_company]
          .filter(Boolean).join(' ').toLowerCase();
        if (!s.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, filterDivision, search]);

  const listFilteredJobs = useMemo(() => {
    if (filterPhase === 'all') return baseFilteredJobs;
    return baseFilteredJobs.filter(j => j.phase === filterPhase);
  }, [baseFilteredJobs, filterPhase]);

  const jobCountByPhase = useMemo(() => {
    const counts = {};
    for (const j of baseFilteredJobs) {
      counts[j.phase] = (counts[j.phase] || 0) + 1;
    }
    return counts;
  }, [baseFilteredJobs]);

  const groupCounts = useMemo(() => {
    const counts = {};
    for (const g of MACRO_GROUPS) {
      const phaseSet = new Set(g.phases);
      counts[g.key] = baseFilteredJobs.filter(j => phaseSet.has(j.phase)).length;
    }
    return counts;
  }, [baseFilteredJobs]);

  const terminalCount = useMemo(() =>
    baseFilteredJobs.filter(j => TERMINAL_PHASES.includes(j.phase)).length
  , [baseFilteredJobs]);

  const activeGroupPhases = useMemo(() => {
    if (!activeGroup) return [];
    const group = MACRO_GROUPS.find(g => g.key === activeGroup);
    if (!group) return [];
    return group.phases.map(key => phaseMap[key]).filter(Boolean);
  }, [activeGroup, phaseMap]);

  const activeGroupJobsByPhase = useMemo(() => {
    const grouped = {};
    for (const phase of activeGroupPhases) {
      grouped[phase.key] = baseFilteredJobs.filter(j => j.phase === phase.key);
    }
    return grouped;
  }, [activeGroupPhases, baseFilteredJobs]);

  // ── Phase change — optimistic update ──
  const changeJobPhase = useCallback(async (job, newPhase) => {
    if (newPhase === job.phase) return;
    // Move the card immediately — don't wait for the DB
    const updated = { ...job, phase: newPhase, phase_entered_at: new Date().toISOString() };
    setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
    if (selectedJob?.id === job.id) setSelectedJob(updated);
    try {
      await db.update('jobs', `id=eq.${job.id}`, {
        phase: newPhase,
        phase_entered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await db.insert('job_phase_history', {
        job_id: job.id,
        from_phase: job.phase,
        to_phase: newPhase,
        changed_by: employee?.id || null,
        changed_at: new Date().toISOString(),
      });
    } catch (err) {
      // Roll back to original phase on failure
      console.error('Phase change error:', err);
      setJobs(prev => prev.map(j => j.id === job.id ? job : j));
      if (selectedJob?.id === job.id) setSelectedJob(job);
      errToast('Failed to move job — reverted. Check your connection.');
    }
  }, [db, selectedJob]);

  // ── Desktop Drag and Drop ──
  const handleDragStart = (e, job) => {
    setDragJob(job);
    e.dataTransfer.effectAllowed = 'move';
    if (e.target) {
      e.target.style.opacity = '0.4';
      setTimeout(() => { if (e.target) e.target.style.opacity = '1'; }, 0);
    }
  };
  const handleDragEnd = () => { setDragJob(null); setDragOverPhase(null); };
  const handleDragOver = (e, phaseKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPhase(phaseKey);
  };
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverPhase(null);
  };
  const handleDrop = (e, phaseKey) => {
    e.preventDefault();
    setDragOverPhase(null);
    if (dragJob && dragJob.phase !== phaseKey) changeJobPhase(dragJob, phaseKey);
    setDragJob(null);
  };

  // ── Mobile: phase picker selection ──
  const handlePhasePickerSelect = (newPhase) => {
    if (phasePickerJob) {
      changeJobPhase(phasePickerJob, newPhase);
    }
    setPhasePickerJob(null);
  };

  const handleJobUpdate = useCallback((updatedJob) => {
    setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
    setSelectedJob(updatedJob);
  }, []);

  const getPhaseLabel = (key) => phaseMap[key]?.label || key;

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  if (loadError) return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Production</h1></div>
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Failed to load production board</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>{loadError}</div>
        <button className="btn btn-primary btn-sm" onClick={loadData}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className="jobs-page">
      {/* ══ Header ══ */}
      <div className="jobs-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {activeGroup && (
            <button className="btn btn-ghost btn-sm" onClick={() => setActiveGroup(null)} style={{ fontSize: 16, padding: '4px 8px' }}>
              ←
            </button>
          )}
          <div>
            <h1 className="page-title">
              {activeGroup ? MACRO_GROUPS.find(g => g.key === activeGroup)?.label : 'Production'}
            </h1>
            <p className="page-subtitle">
              {activeGroup
                ? `${Object.values(activeGroupJobsByPhase).flat().length} jobs in ${activeGroupPhases.length} phases`
                : `${baseFilteredJobs.length} total jobs`
              }
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`btn ${view === 'pipeline' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('pipeline')}>Pipeline</button>
          <button className={`btn ${view === 'list' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      {/* ══ Filters ══ */}
      <div className="jobs-filters">
        <div className="jobs-search-wrap">
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input jobs-search" placeholder="Search by name, job #, address..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input jobs-filter-select" value={filterDivision} onChange={e => setFilterDivision(e.target.value)}>
          <option value="all">All Divisions</option>
          {divisions.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
        </select>
        {view === 'list' && (
          <select className="input jobs-filter-select" value={filterPhase} onChange={e => setFilterPhase(e.target.value)}>
            <option value="all">All Phases</option>
            {phases.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        )}
        {(search || filterDivision !== 'all' || filterPhase !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterDivision('all'); setFilterPhase('all'); }}>Clear</button>
        )}
      </div>

      {/* ══ Pipeline View ══ */}
      {view === 'pipeline' ? (
        activeGroup ? (
          <div className="pipeline">
            {activeGroupPhases.map(phase => {
              const phaseJobs = activeGroupJobsByPhase[phase.key] || [];
              const isDragTarget = dragOverPhase === phase.key && dragJob?.phase !== phase.key;

              return (
                <div
                  className={`pipeline-column${isDragTarget ? ' drag-over' : ''}`}
                  key={phase.key}
                  onDragOver={e => handleDragOver(e, phase.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, phase.key)}
                >
                  <div className="pipeline-column-header">
                    <span>{phase.label}</span>
                    <span className="pipeline-column-count">{phaseJobs.length}</span>
                  </div>
                  <div className="pipeline-cards">
                    {phaseJobs.map(job => (
                      <JobCard
                        key={job.id}
                        job={job}
                        isDragging={dragJob?.id === job.id}
                        onDragStart={e => handleDragStart(e, job)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedJob(job)}
                        onLongPress={() => setPhasePickerJob(job)}
                        onOpenPage={() => navigate(`/jobs/${job.id}`)}
                      />
                    ))}
                    {phaseJobs.length === 0 && !dragJob && (
                      <div className="pipeline-empty">No jobs</div>
                    )}
                    {dragJob && isDragTarget && phaseJobs.length === 0 && (
                      <div className="pipeline-drop-hint">Drop here</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <PullToRefresh onRefresh={loadData} style={{ flex: 1, overflow: 'auto' }}>
            <div className="macro-grid">
            {MACRO_GROUPS.map(group => (
              <button
                key={group.key}
                className="macro-card"
                style={{ '--macro-color': group.color }}
                onClick={() => setActiveGroup(group.key)}
              >
                <div className="macro-card-emoji">{group.emoji}</div>
                <div className="macro-card-count">{groupCounts[group.key] || 0}</div>
                <div className="macro-card-label">{group.label}</div>
                <div className="macro-card-desc">{group.description}</div>
                <div className="macro-card-phases">
                  {group.phases.map(pk => {
                    const count = jobCountByPhase[pk] || 0;
                    if (!phaseMap[pk]) return null;
                    return (
                      <span key={pk} className={`macro-phase-pill${count > 0 ? ' has-jobs' : ''}`}>
                        {phaseMap[pk]?.label}: {count}
                      </span>
                    );
                  })}
                </div>
              </button>
            ))}
            {terminalCount > 0 && (
              <div className="hidden-phases-banner" style={{ gridColumn: '1 / -1' }}>
                <span>
                  {TERMINAL_PHASES.map(pk => `${getPhaseLabel(pk)}: ${jobCountByPhase[pk] || 0}`).join(' · ')}
                  {' '}({terminalCount} total)
                </span>
              </div>
            )}
            </div>
        </PullToRefresh>
        )
      ) : (
        <div className="card" style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Job #</th>
                  <th>Client</th>
                  <th>Division</th>
                  <th>Phase</th>
                  <th>Source</th>
                  <th>Address</th>
                  <th>Date of Loss</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {listFilteredJobs.length === 0 && (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)', fontSize: 13 }}>No jobs match the current filters</td></tr>
                )}
                {listFilteredJobs.map(job => (
                  <tr key={job.id} onClick={() => setSelectedJob(job)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{job.job_number || '—'}</td>
                    <td>{job.insured_name || '—'}</td>
                    <td><span className="division-badge" data-division={job.division}>{job.division}</span></td>
                    <td>
                      <span className={`status-badge status-${phaseClass(job.phase)}`}>
                        {getPhaseLabel(job.phase)}
                      </span>
                    </td>
                    <td>{job.source || '—'}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                      {job.address || '—'}
                    </td>
                    <td style={{ color: 'var(--text-tertiary)' }}>
                      {job.date_of_loss ? new Date(job.date_of_loss).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      {job.priority && (
                        <span style={{
                          fontSize: 'var(--text-xs)', fontWeight: 600,
                          color: job.priority <= 1 ? 'var(--status-needs-response)' : job.priority <= 2 ? '#f59e0b' : 'var(--text-tertiary)',
                        }}>
                          {job.priority <= 1 ? 'Urgent' : job.priority <= 2 ? 'High' : job.priority <= 3 ? 'Normal' : 'Low'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Detail Panel ══ */}
      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          phases={phases}
          employees={employees}
          onClose={() => setSelectedJob(null)}
          onUpdate={handleJobUpdate}
        />
      )}

      {/* ══ Mobile Phase Picker Modal ══ */}
      {phasePickerJob && (
        <PhasePickerModal
          job={phasePickerJob}
          phases={activeGroupPhases}
          onSelect={handlePhasePickerSelect}
          onClose={() => setPhasePickerJob(null)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   JobCard — desktop drag + mobile long-press
   ═══════════════════════════════════════════════════ */
function JobCard({ job, isDragging, onDragStart, onDragEnd, onClick, onLongPress, onOpenPage }) {
  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const longPressFired = useRef(false);

  const handleTouchStart = () => {
    touchMoved.current = false;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (navigator.vibrate) navigator.vibrate(30);
      onLongPress();
    }, 500);
  };

  const handleTouchMove = () => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = (e) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // If long press fired, prevent tap-through
    if (longPressFired.current) {
      e.preventDefault();
      return;
    }
    // Normal tap (didn't move, didn't long-press) → open detail panel
    if (!touchMoved.current) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`pipeline-card${isDragging ? ' dragging' : ''}`}
      draggable={!isTouchDevice()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        // Desktop click — touch devices handle via touchEnd
        if (!isTouchDevice()) onClick();
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div className="pipeline-card-title">
          {job.job_number || job.insured_name || `#${job.id.slice(0, 6)}`}
        </div>
        {job.priority && job.priority <= 2 && (
          <span className={`priority-tag priority-${job.priority <= 1 ? 'urgent' : 'high'}`}>
            {job.priority <= 1 ? 'URGENT' : 'HIGH'}
          </span>
        )}
      </div>
      <div className="pipeline-card-meta">{job.insured_name || 'No client'}</div>
      {job.address && (
        <div className="pipeline-card-meta" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.address}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span className="division-badge" data-division={job.division}>{job.division}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {(job.has_asbestos || job.has_lead || job.is_cat_loss) && (
            <div style={{ display: 'flex', gap: 3 }}>
              {job.is_cat_loss && <span className="job-flag flag-red" style={{ fontSize: 9 }}>CAT</span>}
              {job.has_asbestos && <span className="job-flag flag-red" style={{ fontSize: 9 }}>ASB</span>}
              {job.has_lead && <span className="job-flag flag-red" style={{ fontSize: 9 }}>LEAD</span>}
            </div>
          )}
          <button
            className="job-card-open-btn"
            onClick={e => { e.stopPropagation(); onOpenPage(); }}
            onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onOpenPage(); }}
            title="Open job page"
          >
            <IconOpenPage style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>
      <div className="mobile-longpress-hint">Hold to move phase</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PhasePickerModal — iOS-style bottom sheet
   ═══════════════════════════════════════════════════ */
function PhasePickerModal({ job, phases, onSelect, onClose }) {
  const [saving, setSaving] = useState(false);

  const handleSelect = async (phaseKey) => {
    if (phaseKey === job.phase || saving) return;
    setSaving(true);
    await onSelect(phaseKey);
    setSaving(false);
  };

  return (
    <div className="phase-picker-overlay" onClick={onClose}>
      <div className="phase-picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="phase-picker-handle" />

        <div className="phase-picker-header">
          <div className="phase-picker-title">Move to Phase</div>
          <div className="phase-picker-subtitle">
            {job.job_number || job.insured_name || 'Job'}
          </div>
        </div>

        <div className="phase-picker-options">
          {phases.map(phase => {
            const isCurrent = phase.key === job.phase;
            return (
              <button
                key={phase.key}
                className={`phase-picker-option${isCurrent ? ' current' : ''}`}
                onClick={() => handleSelect(phase.key)}
                disabled={isCurrent || saving}
              >
                <span className="phase-picker-option-label">{phase.label}</span>
                {isCurrent && <span className="phase-picker-current-badge">Current</span>}
                {!isCurrent && <span className="phase-picker-arrow">→</span>}
              </button>
            );
          })}
        </div>

        <button className="phase-picker-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function phaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed', 'paid'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled', 'waiting_on_approval', 'waiting_for_deductible', 'awaiting_payment'].includes(phase)) return 'waiting';
  if (['lead', 'emergency', 'job_received'].includes(phase)) return 'needs-response';
  if (['drywall', 'carpentry', 'painting', 'floors', 'cabinetry', 'other_recon', 'reconstruction', 'demolition', 'drying', 'mitigation'].includes(phase)) return 'active';
  return 'active';
}
