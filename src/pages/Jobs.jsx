import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch, IconOpenPage } from '@/components/Icons';
import JobDetailPanel from '@/components/JobDetailPanel';
import PullToRefresh from '@/components/PullToRefresh';

const DIVISION_TABS = [
  { key: 'all', label: 'All', emoji: '' },
  { key: 'water', label: 'Water', emoji: '💧' },
  { key: 'mold', label: 'Mold', emoji: '🦠' },
  { key: 'reconstruction', label: 'Recon', emoji: '🏗️' },
  { key: 'fire', label: 'Fire', emoji: '🔥' },
  { key: 'contents', label: 'Contents', emoji: '📦' },
];

const DIVISION_COLORS = {
  water: '#2563eb',
  mold: '#9d174d',
  reconstruction: '#d97706',
  fire: '#dc2626',
  contents: '#059669',
};

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'name_asc', label: 'Name A–Z' },
  { key: 'loss_date', label: 'Date of Loss' },
  { key: 'priority', label: 'Priority' },
];

const PHASE_STYLES = {
  lead:              { label: 'Lead',            bg: '#fef2f2', color: '#ef4444' },
  emergency_response:{ label: 'Emergency',       bg: '#fef2f2', color: '#ef4444' },
  job_received:      { label: 'Received',        bg: '#fff7ed', color: '#ea580c' },
  estimate_submitted:{ label: 'Est. Submitted',  bg: '#fffbeb', color: '#d97706' },
  estimate_approved: { label: 'Est. Approved',   bg: '#ecfdf5', color: '#059669' },
  work_authorized:   { label: 'Authorized',      bg: '#ecfdf5', color: '#059669' },
  mitigation_in_progress: { label: 'Mitigation', bg: '#eff6ff', color: '#2563eb' },
  drying:            { label: 'Drying',          bg: '#eff6ff', color: '#2563eb' },
  monitoring:        { label: 'Monitoring',      bg: '#eff6ff', color: '#2563eb' },
  demo_in_progress:  { label: 'Demo',            bg: '#eff6ff', color: '#2563eb' },
  reconstruction_in_progress: { label: 'In Progress', bg: '#eff6ff', color: '#2563eb' },
  reconstruction_punch_list:  { label: 'Punch List',  bg: '#fef9c3', color: '#a16207' },
  pending_inspection:{ label: 'Pending Inspect.', bg: '#fef9c3', color: '#a16207' },
  supplement_in_progress: { label: 'Supplement',  bg: '#fef9c3', color: '#a16207' },
  supplement_submitted:  { label: 'Suppl. Sent',  bg: '#fef9c3', color: '#a16207' },
  supplement_review: { label: 'Suppl. Review',   bg: '#fef9c3', color: '#a16207' },
  waiting_on_insurance:  { label: 'Wait: Insurance', bg: '#fef9c3', color: '#a16207' },
  waiting_on_payment:    { label: 'Wait: Payment',   bg: '#fef9c3', color: '#a16207' },
  waiting_on_client:     { label: 'Wait: Client',    bg: '#fef9c3', color: '#a16207' },
  waiting_on_adjuster:   { label: 'Wait: Adjuster',  bg: '#fef9c3', color: '#a16207' },
  on_hold:           { label: 'On Hold',         bg: '#f1f3f5', color: '#6b7280' },
  completed:         { label: 'Completed',       bg: '#ecfdf5', color: '#10b981' },
  closed:            { label: 'Closed',          bg: '#f1f3f5', color: '#6b7280' },
  invoiced:          { label: 'Invoiced',        bg: '#f0f9ff', color: '#0369a1' },
  paid:              { label: 'Paid',            bg: '#ecfdf5', color: '#059669' },
};

const PRIORITY_LABELS = {
  1: { label: 'URG', bg: '#fef2f2', color: '#ef4444' },
  2: { label: 'HIGH', bg: '#fff7ed', color: '#ea580c' },
};

function getPhaseStyle(phase) {
  return PHASE_STYLES[phase] || { label: phase?.replace(/_/g, ' ') || '—', bg: '#f1f3f5', color: '#6b7280' };
}

export default function Jobs() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [divisionTab, setDivisionTab] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoadError(null);
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

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (divisionTab !== 'all') result = result.filter(j => j.division === divisionTab);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j => {
        const s = [j.insured_name, j.job_number, j.address, j.claim_number, j.insurance_company]
          .filter(Boolean).join(' ').toLowerCase();
        return s.includes(q);
      });
    }
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

  const divisionCounts = useMemo(() => {
    const counts = { all: jobs.length };
    for (const t of DIVISION_TABS) if (t.key !== 'all') counts[t.key] = 0;
    for (const j of jobs) { if (j.division && counts[j.division] !== undefined) counts[j.division]++; }
    return counts;
  }, [jobs]);

  // FIX: Merge update into existing job to preserve created_at and all other fields
  const handleJobUpdate = useCallback((updatedJob) => {
    setJobs(prev => prev.map(j => j.id === updatedJob.id ? { ...j, ...updatedJob } : j));
    setSelectedJob(prev => prev ? { ...prev, ...updatedJob } : updatedJob);
  }, []);

  const formatDate = (val) => {
    if (!val) return null;
    return new Date(val + (val.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatCurrency = (val) => {
    if (val === null || val === undefined || val === 0) return null;
    return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  if (loadError) return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Jobs</h1></div>
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Failed to load jobs</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>{loadError}</div>
        <button className="btn btn-primary btn-sm" onClick={loadData}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className="jobs-page">
      {/* Header */}
      <div className="jobs-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">{filteredJobs.length} of {jobs.length} jobs</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="input jobs-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ minWidth: 130 }}>
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Division Tabs — only show tabs that have jobs */}
      <div className="division-tabs">
        {DIVISION_TABS.filter(tab => tab.key === 'all' || (divisionCounts[tab.key] || 0) > 0).map(tab => (
          <button key={tab.key} className={`division-tab${divisionTab === tab.key ? ' active' : ''}`}
            onClick={() => setDivisionTab(tab.key)}>
            {tab.emoji && <span className="division-tab-emoji">{tab.emoji}</span>}
            <span>{tab.label}</span>
            <span className="division-tab-count">{divisionCounts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="jobs-filters">
        <div className="jobs-search-wrap" style={{ maxWidth: 'none', width: '100%' }}>
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input jobs-search" placeholder="Search name, job #, address, claim #..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {search && <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear</button>}
      </div>

      {/* Job Cards */}
      <PullToRefresh onRefresh={loadData} className="job-card-list">
        {filteredJobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-text">No jobs found</div>
            <div className="empty-state-sub">Try adjusting your filters or search</div>
          </div>
        ) : (
          filteredJobs.map(job => (
            <JobListCard key={job.id} job={job} formatDate={formatDate} formatCurrency={formatCurrency}
              onClick={() => navigate(`/jobs/${job.id}`)}
              onQuickView={() => setSelectedJob(job)} />
          ))
        )}
      </PullToRefresh>

      {/* Detail Panel */}
      {selectedJob && (
        <JobDetailPanel job={selectedJob} phases={phases} employees={employees}
          onClose={() => setSelectedJob(null)} onUpdate={handleJobUpdate} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// JOB LIST CARD
// ═══════════════════════════════════════════════════════════════

function JobListCard({ job, formatDate, formatCurrency, onClick, onQuickView }) {
  const divColor = DIVISION_COLORS[job.division] || '#6b7280';
  const phase = getPhaseStyle(job.phase);
  const priority = PRIORITY_LABELS[job.priority];
  const lossDate = formatDate(job.date_of_loss);
  const receivedDate = formatDate(job.received_date);
  const estimatedVal = formatCurrency(job.estimated_value);
  const approvedVal = formatCurrency(job.approved_value);
  const hasFlags = job.has_asbestos || job.has_lead || job.is_cat_loss || job.requires_permit;

  return (
    <div className="job-list-card" onClick={onClick}
      style={{ borderLeft: `3px solid ${divColor}`, borderRadius: 'var(--radius-md)' }}>
      {/* Body */}
      <div className="job-list-card-body">
        {/* Row 1: Name + Priority + Phase */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span className="job-list-card-name" style={{ flex: 1 }}>{job.insured_name || 'Unknown Client'}</span>
          {priority && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: priority.bg, color: priority.color, flexShrink: 0 }}>{priority.label}</span>
          )}
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
            background: phase.bg, color: phase.color, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {phase.label}
          </span>
        </div>

        {/* Row 2: Job number + division label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          {job.job_number && <span className="job-list-card-jobnumber">{job.job_number}</span>}
          {hasFlags && (
            <div style={{ display: 'flex', gap: 3 }}>
              {job.is_cat_loss && <span style={S.flag}>CAT</span>}
              {job.has_asbestos && <span style={S.flag}>ASB</span>}
              {job.has_lead && <span style={S.flag}>LEAD</span>}
              {job.requires_permit && <span style={S.flagYellow}>PERMIT</span>}
            </div>
          )}
        </div>

        {/* Row 3: Address */}
        {job.address && (
          <div className="job-list-card-address">{job.address}{job.city ? `, ${job.city}` : ''}{job.state ? `, ${job.state}` : ''}</div>
        )}

        {/* Row 4: Meta line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {job.insurance_company && <span>{job.insurance_company}</span>}
          {job.insurance_company && (lossDate || estimatedVal) && <span style={{ color: 'var(--border-color)' }}>·</span>}
          {lossDate && <span>Loss: {lossDate}</span>}
          {receivedDate && !lossDate && <span>Received: {receivedDate}</span>}
          {(lossDate || receivedDate) && estimatedVal && <span style={{ color: 'var(--border-color)' }}>·</span>}
          {estimatedVal && <span>Est: {estimatedVal}</span>}
          {approvedVal && approvedVal !== estimatedVal && <span>Appr: {approvedVal}</span>}
        </div>
      </div>

      {/* Right: Quick View */}
      <button className="job-card-open-btn" onClick={e => { e.stopPropagation(); onQuickView(); }} title="Quick view">
        <IconSearch style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
}

const S = {
  flag: { fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 3, background: '#fef2f2', color: '#ef4444', lineHeight: '16px' },
  flagYellow: { fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 3, background: '#fffbeb', color: '#d97706', lineHeight: '16px' },
};
