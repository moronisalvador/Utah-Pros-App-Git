import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function Dashboard() {
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const [stats,      setStats]      = useState({ active_jobs: 0, needs_response: 0, total_contacts: 0, open_leads: 0 });
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  useEffect(() => { loadDashboard(); }, []);

  const loadDashboard = async () => {
    setError(null);
    try {
      const [statsData, jobs] = await Promise.all([
        db.rpc('get_dashboard_stats'),
        db.rpc('get_dashboard_stats')  // reuse for now — replace with a real recent jobs RPC when needed
          .then(() => db.select(
            'jobs',
            'status=eq.active&order=created_at.desc&limit=5&select=id,job_number,insured_name,phase,division,insurance_company,created_at'
          )),
      ]);
      if (statsData) setStats(statsData);
      setRecentJobs(jobs || []);
    } catch (err) {
      console.error('Dashboard load error:', err);
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

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
        <StatCard label="Active Jobs"      value={stats.active_jobs} />
        <StatCard label="Needs Response"   value={stats.needs_response} alert={stats.needs_response > 0} />
        <StatCard label="Total Contacts"   value={stats.total_contacts} />
        <StatCard label="Open Leads"       value={stats.open_leads} />
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Jobs</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {recentJobs.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No jobs yet</p>
              <p className="empty-state-text">Jobs will appear here once created.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Job #</th>
                  <th>Client</th>
                  <th>Phase</th>
                  <th>Division</th>
                  <th>Insurance</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map(job => (
                  <tr key={job.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${job.id}`)}>
                    <td style={{ fontWeight: 600 }}>{job.job_number || '—'}</td>
                    <td>{job.insured_name || '—'}</td>
                    <td>
                      <span className={`status-badge status-${phaseClass(job.phase)}`}>
                        {job.phase || 'unknown'}
                      </span>
                    </td>
                    <td>{job.division || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{job.insurance_company || 'Out of pocket'}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(job.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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
