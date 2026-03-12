import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Schedule() {
  const { db } = useAuth();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('schedule_blocks', 'order=block_date.asc,start_time.asc&select=id,employee_id,job_id,title,block_date,start_time,end_time,all_day,block_type,notes&limit=50')
      .then(setBlocks)
      .catch(() => setBlocks([]))
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
          {blocks.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No schedule blocks yet</p>
              <p className="empty-state-text">Calendar view and drag-to-schedule coming in the next build phase.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Date</th><th>Title</th><th>Time</th><th>Type</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {blocks.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{b.block_date}</td>
                      <td>{b.title || '—'}</td>
                      <td>{b.all_day ? 'All day' : `${b.start_time || '—'} — ${b.end_time || '—'}`}</td>
                      <td>{b.block_type || '—'}</td>
                      <td style={{ color: 'var(--text-tertiary)' }}>{b.notes || '—'}</td>
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
