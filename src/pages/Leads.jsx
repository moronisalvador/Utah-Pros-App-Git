import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ErrorState } from '@/components/ui';

export default function Leads() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    // Leads = jobs in the 'lead' phase — not a contacts role
    try {
      const rows = await db.select(
        'jobs',
        'phase=eq.lead&status=eq.active&order=created_at.desc&select=id,job_number,insured_name,address,city,state,division,type_of_loss,insurance_company,created_at,priority,lead_source'
      );
      setLeads(rows || []);
      setLoadError(null);
    } catch (err) {
      // Was console.error only, so a failed load rendered "No leads yet" —
      // indistinguishable from a genuinely empty pipeline (loading-error-states.md §1).
      console.error('Leads load error:', err);
      setLoadError('Couldn’t load leads. Check your connection and try again.');
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
          <h1 className="page-title">Leads</h1>
          <p className="page-subtitle">{leads.length} lead{leads.length !== 1 ? 's' : ''} in pipeline</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {loadError && leads.length === 0 ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : leads.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No leads yet</p>
              <p className="empty-state-text">Jobs in the Lead phase will appear here.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Job #</th>
                  <th>Client</th>
                  <th>Address</th>
                  <th>Division</th>
                  <th>Insurance</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${lead.id}`, { viewTransition: true })}>
                    <td style={{ fontWeight: 600 }}>{lead.job_number || '—'}</td>
                    <td>{lead.insured_name || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {[lead.address, lead.city].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td>{lead.division || '—'}</td>
                    <td>{lead.insurance_company || 'Out of pocket'}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(lead.created_at).toLocaleDateString()}
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
