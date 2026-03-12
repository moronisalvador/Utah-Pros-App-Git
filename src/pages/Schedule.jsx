import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Schedule() {
  const { db } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('job_schedules', 'order=scheduled_date.asc&select=id,job_id,employee_id,scheduled_date,start_time,end_time,notes&limit=50')
      .then(setSchedules)
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        <p className="page-subtitle">Team schedule and job assignments</p>
      </div>

      <div className="card">
        <div className="card-body">
          {schedules.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No schedules yet</p>
              <p className="empty-state-text">Calendar view and drag-to-schedule coming in the next build phase.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Date</th><th>Time</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {schedules.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.scheduled_date}</td>
                      <td>{s.start_time || '—'} — {s.end_time || '—'}</td>
                      <td style={{ color: 'var(--text-tertiary)' }}>{s.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
