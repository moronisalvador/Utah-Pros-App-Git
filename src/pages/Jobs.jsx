import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import JobDetailPanel from '@/components/JobDetailPanel';

export default function Jobs() {
  const { db } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('pipeline');

  // Filters
  const [search, setSearch] = useState('');
  const [filterDivision, setFilterDivision] = useState('all');
  const [filterPhase, setFilterPhase] = useState('all');

  // Detail panel
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

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

  // Get unique divisions from data
  const divisions = useMemo(() => {
    const divs = [...new Set(jobs.map(j => j.division).filter(Boolean))];
    return divs.sort();
  }, [jobs]);

  // Filter jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (filterDivision !== 'all' && j.division !== filterDivision) return false;
      if (filterPhase !== 'all' && j.phase !== filterPhase) return false;
      if (search) {
        const q = search.toLowerCase();
        const searchable = [j.insured_name, j.job_number, j.address, j.claim_number, j.insurance_company]
          .filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, filterDivision, filterPhase, search]);

  // Group filtered jobs by phase
  const jobsByPhase = useMemo(() => {
    const grouped = {};
    for (const phase of phases) {
      grouped[phase.key] = filteredJobs.filter(j => j.phase === phase.key);
    }
    return grouped;
  }, [filteredJobs, phases]);

  // Unmatched jobs
  const knownKeys = useMemo(() => new Set(phases.map(p => p.key)), [phases]);
  const unmatchedJobs = useMemo(() => filteredJobs.filter(j => !knownKeys.has(j.phase)), [filteredJobs, knownKeys]);

  // Handle job update from detail panel
  const handleJobUpdate = useCallback((updatedJob) => {
    setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
    setSelectedJob(updatedJob);
  }, []);

  // Quick phase change from pipeline card
  const handleQuickPhaseChange = async (job, newPhase) => {
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
      console.error('Quick phase change error:', err);
      alert('Failed: ' + err.message);
    }
  };

  const getPhaseLabel = (key) => phases.find(p => p.key === key)?.label || key;

  if (loading) {
    return <div className="loading-page"><div className="spinner" /></div>;
  }

  return (
    <div className="jobs-page">
      {/* ── Header ── */}
      <div className="jobs-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">{filteredJobs.length} of {jobs.length} jobs</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`btn ${view === 'pipeline' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('pipeline')}>Pipeline</button>
          <button className={`btn ${view === 'list' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setView('list')}>List</button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="jobs-filters">
        <div className="jobs-search-wrap">
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input
            className="input jobs-search"
            placeholder="Search by name, job #, address..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="input jobs-filter-select" value={filterDivision} onChange={e => setFilterDivision(e.target.value)}>
          <option value="all">All Divisions</option>
          {divisions.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
        </select>
        <select className="input jobs-filter-select" value={filterPhase} onChange={e => setFilterPhase(e.target.value)}>
          <option value="all">All Phases</option>
          {phases.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {(search || filterDivision !== 'all' || filterPhase !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterDivision('all'); setFilterPhase('all'); }}>
            Clear
          </button>
        )}
      </div>

      {/* ── Pipeline View ── */}
      {view === 'pipeline' ? (
        <div className="pipeline">
          {phases.map(phase => {
            const phaseJobs = jobsByPhase[phase.key] || [];
            const isTerminal = phase.is_terminal;

            return (
              <div className="pipeline-column" key={phase.key}>
                <div className="pipeline-column-header" style={phase.color ? { borderBottomColor: phase.color } : undefined}>
                  <span>{phase.label}</span>
                  <span className="pipeline-column-count">{phaseJobs.length}</span>
                </div>
                <div className="pipeline-cards">
                  {phaseJobs.map(job => (
                    <PipelineCard
                      key={job.id}
                      job={job}
                      phases={phases}
                      onClick={() => setSelectedJob(job)}
                      onPhaseChange={handleQuickPhaseChange}
                    />
                  ))}
                  {phaseJobs.length === 0 && (
                    <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
                      No jobs
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {unmatchedJobs.length > 0 && (
            <div className="pipeline-column">
              <div className="pipeline-column-header" style={{ borderBottomColor: '#ef4444' }}>
                <span>Uncategorized</span>
                <span className="pipeline-column-count">{unmatchedJobs.length}</span>
              </div>
              <div className="pipeline-cards">
                {unmatchedJobs.map(job => (
                  <PipelineCard
                    key={job.id}
                    job={job}
                    phases={phases}
                    onClick={() => setSelectedJob(job)}
                    onPhaseChange={handleQuickPhaseChange}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── List View ── */
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
                {filteredJobs.map(job => (
                  <tr key={job.id} onClick={() => setSelectedJob(job)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{job.job_number || '—'}</td>
                    <td>{job.insured_name || '—'}</td>
                    <td>
                      <span className="division-badge" data-division={job.division}>
                        {job.division}
                      </span>
                    </td>
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
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
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

      {/* ── Detail Panel ── */}
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

/* ── Pipeline Card Component ── */
function PipelineCard({ job, phases, onClick, onPhaseChange }) {
  const [showPhaseMenu, setShowPhaseMenu] = useState(false);

  const handlePhaseSelect = (e) => {
    e.stopPropagation();
    const newPhase = e.target.value;
    if (newPhase && newPhase !== job.phase) {
      onPhaseChange(job, newPhase);
    }
    setShowPhaseMenu(false);
  };

  return (
    <div className="pipeline-card" onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div className="pipeline-card-title">
          {job.job_number ? `${job.job_number}` : job.insured_name || `#${job.id.slice(0, 6)}`}
        </div>
        {job.priority && job.priority <= 2 && (
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
            background: job.priority <= 1 ? 'var(--status-needs-response-bg)' : 'var(--status-waiting-bg)',
            color: job.priority <= 1 ? 'var(--status-needs-response)' : '#b45309',
          }}>
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
        <span className="division-badge" data-division={job.division}>
          {job.division}
        </span>

        {/* Phase change dropdown */}
        <select
          className="pipeline-phase-select"
          value=""
          onChange={handlePhaseSelect}
          onClick={e => e.stopPropagation()}
          title="Move to phase..."
        >
          <option value="" disabled>Move →</option>
          {phases.filter(p => p.key !== job.phase).map(p => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>
      {(job.has_asbestos || job.has_lead || job.is_cat_loss) && (
        <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
          {job.is_cat_loss && <span className="job-flag flag-red" style={{ fontSize: 9 }}>CAT</span>}
          {job.has_asbestos && <span className="job-flag flag-red" style={{ fontSize: 9 }}>ASB</span>}
          {job.has_lead && <span className="job-flag flag-red" style={{ fontSize: 9 }}>LEAD</span>}
        </div>
      )}
    </div>
  );
}

function phaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled'].includes(phase)) return 'waiting';
  if (['lead', 'emergency'].includes(phase)) return 'needs-response';
  return 'active';
}
