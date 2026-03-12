import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Jobs() {
  const { db } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [phases, setPhases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('pipeline'); // pipeline | list

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [jobsData, phasesData] = await Promise.all([
        db.select('jobs', 'select=id,job_number,insured_name,phase,division,source,status,created_at,received_date,target_completion,project_manager&order=created_at.desc'),
        db.select('job_phases', 'is_active=eq.true&order=display_order.asc'),
      ]);

      setJobs(jobsData);
      setPhases(phasesData);
    } catch (err) {
      console.error('Jobs load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Group jobs by phase → matches job_phases.key
  const jobsByPhase = {};
  for (const phase of phases) {
    jobsByPhase[phase.key] = jobs.filter(j => j.phase === phase.key);
  }

  // Jobs that don't match any defined phase
  const knownKeys = new Set(phases.map(p => p.key));
  const unmatchedJobs = jobs.filter(j => !knownKeys.has(j.phase));

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
            const phaseJobs = jobsByPhase[phase.key] || [];

            return (
              <div className="pipeline-column" key={phase.key}>
                <div className="pipeline-column-header">
                  <span>{phase.label}</span>
                  <span className="pipeline-column-count">{phaseJobs.length}</span>
                </div>
                <div className="pipeline-cards">
                  {phaseJobs.map(job => (
                    <div className="pipeline-card" key={job.id}>
                      <div className="pipeline-card-title">{job.job_number || job.insured_name || `Job #${job.id.slice(0, 8)}`}</div>
                      <div className="pipeline-card-meta">
                        {job.insured_name || 'No client'}
                        {job.division && ` · ${job.division}`}
                      </div>
                      {job.target_completion && (
                        <div className="pipeline-card-meta" style={{ marginTop: 4 }}>
                          Due: {new Date(job.target_completion).toLocaleDateString()}
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

          {unmatchedJobs.length > 0 && (
            <div className="pipeline-column">
              <div className="pipeline-column-header">
                <span>Uncategorized</span>
                <span className="pipeline-column-count">{unmatchedJobs.length}</span>
              </div>
              <div className="pipeline-cards">
                {unmatchedJobs.map(job => (
                  <div className="pipeline-card" key={job.id}>
                    <div className="pipeline-card-title">{job.job_number || job.insured_name || `Job #${job.id.slice(0, 8)}`}</div>
                    <div className="pipeline-card-meta">{job.insured_name || 'No client'} · phase: {job.phase || 'none'}</div>
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
                  <th>Job #</th>
                  <th>Client</th>
                  <th>Division</th>
                  <th>Phase</th>
                  <th>Source</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    <td style={{ fontWeight: 600 }}>{job.job_number || '—'}</td>
                    <td>{job.insured_name || '—'}</td>
                    <td>{job.division || '—'}</td>
                    <td>
                      <span className={`status-badge status-${phaseClass(job.phase)}`}>
                        {job.phase || '—'}
                      </span>
                    </td>
                    <td>{job.source || '—'}</td>
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

function phaseClass(phase) {
  if (!phase) return 'active';
  if (['completed', 'closed'].includes(phase)) return 'resolved';
  if (['on_hold', 'cancelled'].includes(phase)) return 'waiting';
  if (['lead', 'emergency'].includes(phase)) return 'needs-response';
  return 'active';
}
