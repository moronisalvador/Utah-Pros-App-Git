import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ErrorState } from '@/components/ui';
import { err } from '@/lib/toast';

export default function Marketing() {
  const { db } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // ErrorState only renders on an empty list, so a refresh failure over existing
  // rows would otherwise show the user nothing at all.
  const hadRowsRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const rows = await db.select('campaigns', 'order=created_at.desc&select=id,name,campaign_type,status,audience_count,total_sent,total_delivered,total_replied,created_at&limit=50');
      setCampaigns(rows || []);
      hadRowsRef.current = (rows || []).length > 0;
      setLoadError(null);
    } catch (loadErr) {
      // Was `.catch(() => setCampaigns([]))` — a failure was actively converted
      // into an empty list, so an outage looked identical to "no campaigns yet"
      // (loading-error-states.md §1).
      console.error('Marketing load error:', loadErr);
      setLoadError('Couldn’t load campaigns. Check your connection and try again.');
      if (hadRowsRef.current) err('Couldn’t refresh — showing last-loaded campaigns.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Marketing</h1>
          <p className="page-subtitle">Campaigns and outreach</p>
        </div>
        <button className="btn btn-primary">+ New Campaign</button>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {loadError && campaigns.length === 0 ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : campaigns.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No campaigns yet</p>
              <p className="empty-state-text">Create SMS/MMS campaigns to reach your customer base. Coming in Phase 4b (blocked on Twilio carrier approval). Looking for email campaigns? See CRM &rarr; Campaigns.</p>
            </div>
          ) : (
            <table>
              <thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Replies</th><th>Created</th></tr></thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>{c.campaign_type || '—'}</td>
                    <td><span className={`status-badge status-${c.status === 'sent' ? 'resolved' : c.status === 'draft' ? 'waiting' : 'active'}`}>{c.status}</span></td>
                    <td>{c.total_sent ?? '—'}</td>
                    <td>{c.total_delivered ?? '—'}</td>
                    <td>{c.total_replied ?? '—'}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{new Date(c.created_at).toLocaleDateString()}</td>
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
