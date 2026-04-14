import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const MITIGATION_DIVS = ['water', 'mold', 'contents'];
const JOB_SELECT = 'id,job_number,insured_name,phase,division,insurance_company,project_manager_id,lead_tech_id,created_at';

export default function Dashboard() {
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ active_jobs: 0, needs_response: 0, total_contacts: 0, open_leads: 0 });
  const [allJobs, setAllJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [divFilter, setDivFilter] = useState('all');

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setError(null);
    try {
      const [statsData, jobs] = await Promise.all([
        db.rpc('get_dashboard_stats'),
        db.select('jobs', `status=neq.deleted&order=created_at.desc&select=${JOB_SELECT}`),
      ]);
      if (statsData) setStats(statsData);
      setAllJobs(jobs || []);
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  // My Jobs — where I'm PM or lead tech
  const myJobs = useMemo(() => {
    if (!employee?.id) return [];
    return allJobs.filter(j =>
      j.project_manager_id === employee.id || j.lead_tech_id === employee.id
    );
  }, [allJobs, employee?.id]);

  // All Jobs — with division filter
  const filteredAllJobs = useMemo(() => {
    if (divFilter === 'mitigation') return allJobs.filter(j => MITIGATION_DIVS.includes(j.division));
    if (divFilter === 'reconstruction') return allJobs.filter(j => j.division === 'reconstruction');
    return allJobs;
  }, [allJobs, divFilter]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          {employee?.full_name ? `Welcome, ${employee.full_name.split(' ')[0]}` : 'Dashboard'}
        </h1>
        <p className="page-subtitle">Here's what's happening at UPR today.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', fontSize: 13, color: '#dc2626', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={loadDashboard} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#dc2626', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>Retry</button>
        </div>
      )}

      <div className="stats-grid">
        <StatCard label="Active Jobs" value={stats.active_jobs} />
        <StatCard label="Needs Response" value={stats.needs_response} alert={stats.needs_response > 0} />
        <StatCard label="Total Contacts" value={stats.total_contacts} />
        <StatCard label="Open Leads" value={stats.open_leads} />
      </div>

      {/* ── My Jobs ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">My Jobs</span>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>{myJobs.length} jobs</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {myJobs.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 16px' }}>
              <p className="empty-state-text" style={{ margin: 0 }}>No jobs assigned to you as PM or lead tech.</p>
            </div>
          ) : (
            <JobTable jobs={myJobs} navigate={navigate} />
          )}
        </div>
      </div>

      {/* ── All Jobs ── */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="card-title" style={{ marginRight: 'auto' }}>All Jobs</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { key: 'all', label: 'All' },
              { key: 'mitigation', label: 'Mitigation' },
              { key: 'reconstruction', label: 'Reconstruction' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setDivFilter(opt.key)}
                style={{
                  height: 28, padding: '0 10px', borderRadius: 'var(--radius-full)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: divFilter === opt.key ? '1.5px solid var(--accent)' : '1px solid var(--border-color)',
                  background: divFilter === opt.key ? 'var(--accent-light)' : 'var(--bg-primary)',
                  color: divFilter === opt.key ? 'var(--accent)' : 'var(--text-tertiary)',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500, width: '100%', textAlign: 'right' }}>{filteredAllJobs.length} jobs</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {filteredAllJobs.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 16px' }}>
              <p className="empty-state-text" style={{ margin: 0 }}>No jobs match this filter.</p>
            </div>
          ) : (
            <JobTable jobs={filteredAllJobs} navigate={navigate} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared Job Table ── */
function JobTable({ jobs, navigate }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Job #</th>
          <th>Client</th>
          <th>Phase</th>
          <th>Division</th>
          <th className="dashboard-tbl-ins">Insurance</th>
          <th className="dashboard-tbl-date">Created</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map(job => (
          <tr key={job.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${job.id}`)}>
            <td style={{ fontWeight: 600 }}>{job.job_number || '—'}</td>
            <td>{job.insured_name || '—'}</td>
            <td>
              <span className={`status-badge status-${phaseClass(job.phase)}`}>
                {job.phase || 'unknown'}
              </span>
            </td>
            <td>{job.division || '—'}</td>
            <td className="dashboard-tbl-ins" style={{ color: 'var(--text-secondary)' }}>{job.insurance_company || 'Out of pocket'}</td>
            <td className="dashboard-tbl-date" style={{ color: 'var(--text-tertiary)' }}>
              {new Date(job.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatCard({ label, value, alert }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={alert ? { color: 'var(--status-needs-response)' } : undefined}>
        {value ?? '—'}
      </div>
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
