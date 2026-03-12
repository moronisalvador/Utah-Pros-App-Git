import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import JobDetailPanel from '@/components/JobDetailPanel';

const DIVISION_TABS = [
  { key: 'all', label: 'All', emoji: '' },
  { key: 'water', label: 'Water', emoji: '💧' },
  { key: 'mold', label: 'Mold', emoji: '🦠' },
  { key: 'reconstruction', label: 'Recon', emoji: '🏗️' },
];

const DIVISION_ICON = {
  water: '💧',
  mold: '🦠',
  reconstruction: '🏗️',
};

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'loss_date', label: 'Date of Loss' },
  { key: 'priority', label: 'Priority' },
];

export default function Jobs() {
  const { db } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [divisionTab, setDivisionTab] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // Detail panel
  const [selectedJob, setSelectedJob] = useState(null);

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

  const getPhaseLabel = (key) => phaseMap[key]?.label || key;

  // Filter + sort
  const filteredJobs = useMemo(() => {
    let result = jobs;

    // Division filter
    if (divisionTab !== 'all') {
      result = result.filter(j => j.division === divisionTab);
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j => {
        const s = [j.insured_name, j.job_number, j.address, j.claim_number, j.insurance_company]
          .filter(Boolean).join(' ').toLowerCase();
        return s.includes(q);
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.created_at) - new Date(a.created_at);
        case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
        case 'name_asc': return (a.insured_name || '').localeCompare(b.insured_name || '');
        case 'loss_date': {
          const da = a.date_of_loss ? new Date(a.date_of_loss) : new Date(0);
          const db2 = b.date_of_loss ? new Date(b.date_of_loss) : new Date(0);
          return db2 - da;
        }
        case 'priority': return (a.priority || 3) - (b.priority || 3);
        default: return 0;
      }
    });

    return result;
  }, [jobs, divisionTab, search, sortBy]);

  // Division counts
  const divisionCounts = useMemo(() => {
    const counts = { all: jobs.length, water: 0, mold: 0, reconstruction: 0 };
    for (const j of jobs) {
      if (j.division && counts[j.division] !== undefined) {
        counts[j.division]++;
      }
    }
    return counts;
  }, [jobs]);

  const handleJobUpdate = useCallback((updatedJob) => {
    setJobs(prev => prev.map(j => j.id === updatedJob.id ? updatedJob : j));
    setSelectedJob(updatedJob);
  }, []);

  const formatDate = (val) => {
    if (!val) return null;
    return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatCurrency = (val) => {
    if (val === null || val === undefined || val === 0) return null;
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="jobs-page">
      {/* ══ Header ══ */}
      <div className="jobs-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">{filteredJobs.length} of {jobs.length} jobs</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="input jobs-filter-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{ minWidth: 130 }}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ══ Division Tabs ══ */}
      <div className="division-tabs">
        {DIVISION_TABS.map(tab => (
          <button
            key={tab.key}
            className={`division-tab${divisionTab === tab.key ? ' active' : ''}`}
            onClick={() => setDivisionTab(tab.key)}
          >
            {tab.emoji && <span className="division-tab-emoji">{tab.emoji}</span>}
            <span>{tab.label}</span>
            <span className="division-tab-count">{divisionCounts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* ══ Search ══ */}
      <div className="jobs-filters">
        <div className="jobs-search-wrap" style={{ maxWidth: 'none', width: '100%' }}>
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input
            className="input jobs-search"
            placeholder="Search name, job #, address, claim #..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>
        )}
      </div>

      {/* ══ Job Cards ══ */}
      <div className="job-card-list">
        {filteredJobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-text">No jobs found</div>
            <div className="empty-state-sub">Try adjusting your filters or search</div>
          </div>
        ) : (
          filteredJobs.map(job => (
            <JobListCard
              key={job.id}
              job={job}
              phaseLabel={getPhaseLabel(job.phase)}
              phaseClass={getPhaseClass(job.phase)}
              formatDate={formatDate}
              formatCurrency={formatCurrency}
              onClick={() => setSelectedJob(job)}
            />
          ))
        )}
      </div>

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

/* ── Job List Card ── */
function JobListCard({ job, phaseLabel, phaseClass, formatDate, formatCurrency, onClick }) {
  const divIcon = DIVISION_ICON[job.division] || '📁';
  const estimatedVal = formatCurrency(job.estimated_value);
  const lossDate = formatDate(job.date_of_loss);
  const receivedDate = formatDate(job.received_date);

  return (
    <div className="job-list-card" onClick={onClick}>
      {/* Left: Division Icon */}
      <div className="job-list-card-icon">{divIcon}</div>

      {/* Middle: Info */}
      <div className="job-list-card-body">
        <div className="job-list-card-top">
          <span className="job-list-card-name">{job.insured_name || 'Unknown Client'}</span>
          {job.priority && job.priority <= 2 && (
            <span className={`priority-tag priority-${job.priority <= 1 ? 'urgent' : 'high'}`}>
              {job.priority <= 1 ? 'URG' : 'HIGH'}
            </span>
          )}
        </div>

        <div className="job-list-card-row">
          {job.job_number && <span className="job-list-card-jobnumber">{job.job_number}</span>}
          <span className={`status-badge status-${phaseClass}`}>{phaseLabel}</span>
        </div>

        {job.address && (
          <div className="job-list-card-address">{job.address}{job.city ? `, ${job.city}` : ''}</div>
        )}

        <div className="job-list-card-meta">
          {job.insurance_company && <span>{job.insurance_company}</span>}
          {lossDate && <span>Loss: {lossDate}</span>}
          {estimatedVal && <span>Est: {estimatedVal}</span>}
          {!job.insurance_company && receivedDate && <span>Received: {receivedDate}</span>}
        </div>

        {/* Flags */}
        {(job.has_asbestos || job.has_lead || job.is_cat_loss) && (
          <div className="job-list-card-flags">
            {job.is_cat_loss && <span className="job-flag flag-red">CAT</span>}
            {job.has_asbestos && <span className="job-flag flag-red">ASB</span>}
            {job.has_lead && <span className="job-flag flag-red">LEAD</span>}
          </div>
        )}
      </div>

      {/* Right: Chevron */}
      <div className="job-list-card-chevron">›</div>
    </div>
  );
}

function getPhaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed', 'paid'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled', 'waiting_on_approval', 'waiting_for_deductible', 'awaiting_payment'].includes(phase)) return 'waiting';
  if (['lead', 'emergency', 'job_received'].includes(phase)) return 'needs-response';
  if (['drywall', 'carpentry', 'painting', 'floors', 'cabinetry', 'other_recon', 'reconstruction', 'demolition', 'drying', 'mitigation'].includes(phase)) return 'active';
  return 'active';
}
