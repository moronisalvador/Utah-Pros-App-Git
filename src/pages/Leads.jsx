import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Leads() {
  const { db } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('contacts', 'role=eq.lead&order=created_at.desc&select=id,name,phone,email,opt_in_source,created_at')
      .then(setLeads)
      .catch(err => console.error('Leads load error:', err))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Leads</h1>
          <p className="page-subtitle">{leads.length} leads in pipeline</p>
        </div>
        <button className="btn btn-primary">+ New Lead</button>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {leads.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No leads yet</p>
              <p className="empty-state-text">Leads from campaigns, referrals, and inbound texts will appear here.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Source</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id}>
                    <td style={{ fontWeight: 600 }}>{lead.name || 'Unknown'}</td>
                    <td>{lead.phone || '—'}</td>
                    <td>{lead.email || '—'}</td>
                    <td>{lead.opt_in_source || '—'}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{new Date(lead.created_at).toLocaleDateString()}</td>
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
