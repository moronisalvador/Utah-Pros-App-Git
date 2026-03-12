import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import JobDetailPanel from '@/components/JobDetailPanel';

// ── Macro group definitions ──
// Phase keys can appear in multiple groups (estimate_pending, on_hold)
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

// Terminal phases hidden from macro view
const TERMINAL_PHASES = ['completed', 'closed', 'cancelled'];

export default function Production() {
  const { db } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('pipeline'); // pipeline | list

  // Which macro group is expanded (null = show macro cards)
  const [activeGroup, setActiveGroup] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterDivision, setFilterDivision] = useState('all');
  const [filterPhase, setFilterPhase] = useState('all');

  // Detail panel
  const [selectedJob, setSelectedJob] = useState(null);

  // Drag and drop
  const [dragJob, setDragJob] = useState(null);
  const [dragOverPhase, setDragOverPhase] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [jobsData, phasesData, empsData] = await Promise.all([
        db.select('jobs', 'order=created_at.desc&select=id,job_number,insured_name,phase,division,source,status,address,city,state,zip,client_email,client_phone,insurance_company,claim_number,adjuster_name,adjuster_phone,adjuster_email,policy_number,cat_code,loss_date,date_of_loss,received_date,target_completion,actual_completion,type_of_loss,adjuster,project_manager,broker_agent,encircle_claim_id,encircle_summary,project_manager_id,lead_tech_id,estimated_value,approved_value,invoiced_value,collected_value,deductible,depreciation_held,depreciation_released,supplement_value,priority,internal_notes,tags,is_cat_loss,has_asbestos,has_lead,requires_permit,phase_entered_at,total_labor_cost,total_material_cost,total_equipment_cost,total_sub_cost,total_other_cost,lead_source,created_at,updated_at'),
        db.select('job_phases', 'is_active=eq.true&order=display_order.asc'),
        db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,role'),
      ]);
      setJobs(jobsData);
      setPhases(phasesData);
      setEmployees(empsData);
    } catch (err) {
      console.error('Jobs load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Phase lookup
  const phaseMap = useMemo(() => {
    const m = {};
    for (const p of phases) m[p.key] = p;
    return m;
  }, [phases]);

  // Unique divisions
  const divisions = useMemo(() =>
    [...new Set(jobs.map(j => j.division).filter(Boolean))].sort()
  , [jobs]);

  // Apply search + division filter (not phase filter — that's per-view)
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

  // Jobs for list view (also applies phase filter)
  const listFilteredJobs = useMemo(() => {
    if (filterPhase === 'all') return baseFilteredJobs;
    return baseFilteredJobs.filter(j => j.phase === filterPhase);
  }, [baseFilteredJobs, filterPhase]);

  // Count jobs per phase (from base filtered, so search/division apply)
  const jobCountByPhase = useMemo(() => {
    const counts = {};
    for (const j of baseFilteredJobs) {
      counts[j.phase] = (counts[j.phase] || 0) + 1;
    }
    return counts;
  }, [baseFilteredJobs]);

  // Count jobs per macro group
  const groupCounts = useMemo(() => {
    const counts = {};
    for (const g of MACRO_GROUPS) {
      const phaseSet = new Set(g.phases);
      counts[g.key] = baseFilteredJobs.filter(j => phaseSet.has(j.phase)).length;
    }
    return counts;
  }, [baseFilteredJobs]);

  // Terminal phase counts
  const terminalCount = useMemo(() =>
    baseFilteredJobs.filter(j => TERMINAL_PHASES.includes(j.phase)).length
  , [baseFilteredJobs]);

  // Get phases for the active group
  const activeGroupPhases = useMemo(() => {
    if (!activeGroup) return [];
    const group = MACRO_GROUPS.find(g => g.key === activeGroup);
    if (!group) return [];
    // Return phase objects in the order defined by the group, filtering to existing phases
    return group.phases
      .map(key => phaseMap[key])
      .filter(Boolean);
  }, [activeGroup, phaseMap]);

  // Jobs grouped by phase within active group
  const activeGroupJobsByPhase = useMemo(() => {
    const grouped = {};
    for (const phase of activeGroupPhases) {
      grouped[phase.key] = baseFilteredJobs.filter(j => j.phase === phase.key);
    }
    return grouped;
  }, [activeGroupPhases, baseFilteredJobs]);

  // ── Phase change ──
  const changeJobPhase = useCallback(async (job, newPhase) => {
    if (newPhase === job.phase) return;
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
        changed_at: new Date().toISOString(),
      });
      const updated = { ...job, phase: newPhase, phase_entered_at: new Date().toISOString() };
      setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
      if (selectedJob?.id === job.id) setSelectedJob(updated);
    } catch (err) {
      console.error('Phase change error:', err);
      alert('Failed: ' + err.message);
    }
  }, [db, selectedJob]);

  // ── Drag and Drop ──
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

  const handleJobUpdate = useCallback((updatedJob) => {
    setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
    setSelectedJob(updatedJob);
  }, []);

  const getPhaseLabel = (key) => phaseMap[key]?.label || key;

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

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
          /* ── Expanded Group View: sub-phase columns ── */
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
          /* ── Macro Group View: 4 big cards ── */
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

            {/* Terminal phases summary */}
            {terminalCount > 0 && (
              <div className="hidden-phases-banner" style={{ gridColumn: '1 / -1' }}>
                <span>
                  {TERMINAL_PHASES.map(pk => `${getPhaseLabel(pk)}: ${jobCountByPhase[pk] || 0}`).join(' · ')}
                  {' '}({terminalCount} total)
                </span>
              </div>
            )}
          </div>
        )
      ) : (
        /* ══ List View ══ */
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
    </div>
  );
}

/* ── Reusable Pipeline Card ── */
function JobCard({ job, isDragging, onDragStart, onDragEnd, onClick }) {
  return (
    <div
      className={`pipeline-card${isDragging ? ' dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
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
        {(job.has_asbestos || job.has_lead || job.is_cat_loss) && (
          <div style={{ display: 'flex', gap: 3 }}>
            {job.is_cat_loss && <span className="job-flag flag-red" style={{ fontSize: 9 }}>CAT</span>}
            {job.has_asbestos && <span className="job-flag flag-red" style={{ fontSize: 9 }}>ASB</span>}
            {job.has_lead && <span className="job-flag flag-red" style={{ fontSize: 9 }}>LEAD</span>}
          </div>
        )}
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
