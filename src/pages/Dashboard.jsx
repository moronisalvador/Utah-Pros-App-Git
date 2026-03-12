import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Dashboard() {
  const { db, employee } = useAuth();
  const [stats, setStats] = useState({
    activeJobs: 0,
    needsResponse: 0,
    todayScheduled: 0,
    openLeads: 0,
  });
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [jobs, conversations, leads] = await Promise.all([
        db.select('jobs', 'select=id,title,status,client_name,created_at&order=created_at.desc&limit=10'),
        db.select('conversations', 'select=id,status&status=eq.needs_response'),
        db.select('contacts', 'select=id&role=eq.lead'),
      ]);

      const activeJobs = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled');

      setStats({
        activeJobs: activeJobs.length,
        needsResponse: conversations.length,
        todayScheduled: 0, // TODO: wire to schedule table
        openLeads: leads.length,
      });

      setRecentJobs(jobs.slice(0, 5));
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading-page"><div className="spinner" /></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          {employee?.full_name ? `Welcome, ${employee.full_name.split(' ')[0]}` : 'Dashboard'}
        </h1>
        <p className="page-subtitle">Here's what's happening at UPR today.</p>
      </div>

      <div className="stats-grid">
        <StatCard label="Active Jobs" value={stats.activeJobs} />
        <StatCard label="Needs Response" value={stats.needsResponse} alert={stats.needsResponse > 0} />
        <StatCard label="Scheduled Today" value={stats.todayScheduled} />
        <StatCard label="Open Leads" value={stats.openLeads} />
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
                  <th>Job</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map(job => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 600 }}>{job.title || `Job #${job.id.slice(0, 8)}`}</td>
                    <td>{job.client_name || '—'}</td>
                    <td>
                      <span className={`status-badge status-${statusClass(job.status)}`}>
                        {job.status?.replace(/_/g, ' ') || 'unknown'}
                      </span>
                    </td>
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
        {value}
      </div>
    </div>
  );
}

function statusClass(status) {
  if (!status) return 'active';
  if (status.includes('complete') || status.includes('closed')) return 'resolved';
  if (status.includes('pending') || status.includes('waiting')) return 'waiting';
  if (status.includes('need') || status.includes('urgent')) return 'needs-response';
  return 'active';
}
