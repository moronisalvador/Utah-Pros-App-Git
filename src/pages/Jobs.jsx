import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Default pipeline phases — will be overridden by job_phases table
const DEFAULT_PHASES = [
  { id: 'lead', name: 'Lead', order_index: 0 },
  { id: 'scheduled', name: 'Scheduled', order_index: 1 },
  { id: 'in_progress', name: 'In Progress', order_index: 2 },
  { id: 'pending_review', name: 'Pending Review', order_index: 3 },
  { id: 'invoiced', name: 'Invoiced', order_index: 4 },
  { id: 'completed', name: 'Completed', order_index: 5 },
];

export default function Jobs() {
  const { db } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState(DEFAULT_PHASES);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('pipeline'); // pipeline | list

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [jobsData, phasesData] = await Promise.all([
        db.select('jobs', 'select=id,title,status,client_name,job_type,created_at,scheduled_date,assigned_to&order=created_at.desc'),
        db.select('job_phases', 'order=order_index.asc').catch(() => []),
      ]);

      setJobs(jobsData);
      if (phasesData.length > 0) {
        setPhases(phasesData);
      }
    } catch (err) {
      console.error('Jobs load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Group jobs by status/phase
  const jobsByPhase = phases.reduce((acc, phase) => {
    const phaseName = phase.name?.toLowerCase().replace(/\s+/g, '_') || phase.id;
    acc[phase.id || phaseName] = jobs.filter(j => {
      const jobStatus = (j.status || '').toLowerCase().replace(/\s+/g, '_');
      return jobStatus === phaseName || jobStatus === (phase.id || '');
    });
    return acc;
  }, {});

  // Jobs that don't match any phase
  const matchedStatuses = new Set(phases.map(p => (p.name?.toLowerCase().replace(/\s+/g, '_') || p.id)));
  const unmatchedJobs = jobs.filter(j => {
    const s = (j.status || '').toLowerCase().replace(/\s+/g, '_');
    return !matchedStatuses.has(s);
  });

  if (loading) {
    return <div className="loading-page"><div className="spinner" /></div>;
  }

  return (
    <div className="page" style={{ maxWidth: 'none', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">{jobs.length} total jobs across {phases.length} phases</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${view === 'pipeline' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setView('pipeline')}
          >
            Pipeline
          </button>
          <button
            className={`btn ${view === 'list' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>

      {view === 'pipeline' ? (
        <div className="pipeline">
          {phases.map(phase => {
            const phaseKey = phase.id || phase.name?.toLowerCase().replace(/\s+/g, '_');
            const phaseJobs = jobsByPhase[phaseKey] || [];

            return (
              <div className="pipeline-column" key={phaseKey}>
                <div className="pipeline-column-header">
                  <span>{phase.name}</span>
                  <span className="pipeline-column-count">{phaseJobs.length}</span>
                </div>
                <div className="pipeline-cards">
                  {phaseJobs.map(job => (
                    <div className="pipeline-card" key={job.id}>
                      <div className="pipeline-card-title">{job.title || `Job #${job.id.slice(0, 8)}`}</div>
                      <div className="pipeline-card-meta">
                        {job.client_name || 'No client'}
                        {job.job_type && ` · ${job.job_type}`}
                      </div>
                      {job.scheduled_date && (
                        <div className="pipeline-card-meta" style={{ marginTop: 4 }}>
                          {new Date(job.scheduled_date).toLocaleDateString()}
                        </div>
                      )}
                    </div>
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

          {/* Unmatched jobs column */}
          {unmatchedJobs.length > 0 && (
            <div className="pipeline-column">
              <div className="pipeline-column-header">
                <span>Other</span>
                <span className="pipeline-column-count">{unmatchedJobs.length}</span>
              </div>
              <div className="pipeline-cards">
                {unmatchedJobs.map(job => (
                  <div className="pipeline-card" key={job.id}>
                    <div className="pipeline-card-title">{job.title || `Job #${job.id.slice(0, 8)}`}</div>
                    <div className="pipeline-card-meta">{job.client_name || 'No client'} · {job.status}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ flex: 1, overflow: 'auto' }}>
          <div className="card-body" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 600 }}>{job.title || `Job #${job.id.slice(0, 8)}`}</td>
                    <td>{job.client_name || '—'}</td>
                    <td>{job.job_type || '—'}</td>
                    <td>
                      <span className={`status-badge status-${statusClass(job.status)}`}>
                        {job.status?.replace(/_/g, ' ') || '—'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-tertiary)' }}>
                      {job.scheduled_date ? new Date(job.scheduled_date).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(job.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function statusClass(status) {
  if (!status) return 'active';
  const s = status.toLowerCase();
  if (s.includes('complete') || s.includes('closed')) return 'resolved';
  if (s.includes('pending') || s.includes('waiting') || s.includes('invoic')) return 'waiting';
  if (s.includes('lead') || s.includes('new')) return 'needs-response';
  return 'active';
}
