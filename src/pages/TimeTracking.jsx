import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function TimeTracking() {
  const { db, employee } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('job_time_entries', 'order=clock_in.desc.nullslast&select=id,employee_id,job_id,clock_in,clock_out,hours,work_type,notes&limit=50')
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Time Tracking</h1>
          <p className="page-subtitle">{entries.length} entries logged</p>
        </div>
        <button className="btn btn-primary">Clock In</button>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {entries.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No time entries</p>
              <p className="empty-state-text">Clock in/out and timesheet features coming next.</p>
            </div>
          ) : (
            <table>
              <thead><tr><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Notes</th></tr></thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id}>
                    <td>{e.clock_in ? new Date(e.clock_in).toLocaleString() : '—'}</td>
                    <td>{e.clock_out ? new Date(e.clock_out).toLocaleString() : 'Active'}</td>
                    <td style={{ fontWeight: 600 }}>{e.hours ? `${e.hours}h` : '—'}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{e.notes || '—'}</td>
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
