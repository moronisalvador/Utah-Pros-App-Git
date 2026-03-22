import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Dashboard() {
  const { db, employee } = useAuth();
  const [stats, setStats] = useState({
    activeJobs: 0,
    needsResponse: 0,
    totalContacts: 0,
    openLeads: 0,
  });
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [jobs, conversations, contacts] = await Promise.all([
        db.select('jobs', 'select=id,job_number,insured_name,phase,division,source,created_at&order=created_at.desc&limit=10'),
        db.select('conversations', 'select=id,status&status=eq.needs_response').catch(() => []),
        // limit=1000 prevents full table scan — for stat counts this is sufficient
        db.select('contacts', 'select=id,role&limit=1000').catch(() => []),
      ]);

      const terminalPhases = ['completed', 'closed', 'cancelled'];
      const activeJobs = jobs.filter(j => !terminalPhases.includes(j.phase));
      const leads = contacts.filter(c => c.role === 'lead');

      setStats({
        activeJobs: activeJobs.length,
        needsResponse: conversations.length,
        totalContacts: contacts.length,
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
        <StatCard label="Total Contacts" value={stats.totalContacts} />
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
                  <th>Job #</th>
                  <th>Client</th>
                  <th>Phase</th>
                  <th>Division</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map(job => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 600 }}>{job.job_number || '—'}</td>
                    <td>{job.insured_name || '—'}</td>
                    <td>
                      <span className={`status-badge status-${phaseClass(job.phase)}`}>
                        {job.phase || 'unknown'}
                      </span>
                    </td>
                    <td>{job.division || '—'}</td>
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

function phaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled'].includes(phase)) return 'waiting';
  if (['lead', 'emergency'].includes(phase)) return 'needs-response';
  return 'active';
}
