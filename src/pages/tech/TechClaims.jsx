import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { IconSearch } from '@/components/Icons';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

const STATUS_COLORS = {
  open:       { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  active:     { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  closed:     { bg: '#f1f3f5', color: '#6b7280', border: '#e2e5e9' },
  pending:    { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
};

export default function TechClaims() {
  const { db } = useAuth();
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtered, setFiltered] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.rpc('get_claims_list');
      setClaims(result || []);
    } catch (e) {
      toast('Failed to load claims', 'error');
    }
    setLoading(false);
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // 200ms debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!query.trim()) { setFiltered(claims); return; }
      const q = query.toLowerCase();
      setFiltered(claims.filter(c =>
        c.claim_number?.toLowerCase().includes(q) ||
        c.insured_name?.toLowerCase().includes(q) ||
        c.loss_city?.toLowerCase().includes(q) ||
        c.insurance_carrier?.toLowerCase().includes(q)
      ));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, claims]);

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <div className="tech-page-header">
          <div className="tech-page-title">Claims</div>
          <div className="tech-page-subtitle">{claims.length} total</div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 'var(--space-4)' }}>
          <IconSearch style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, color: 'var(--text-tertiary)' }} />
          <input
            className="input"
            placeholder="Search claims..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 32, fontSize: 16 }}
          />
        </div>
      </div>

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div className="empty-state-text">{query ? 'No claims match your search' : 'No claims found'}</div>
          </div>
        ) : (
          filtered.map(claim => {
            const sc = STATUS_COLORS[claim.status] || STATUS_COLORS.open;
            return (
              <div
                key={claim.id}
                onClick={() => navigate(`/claims/${claim.id}`)}
                style={{
                  padding: '12px var(--space-4)',
                  borderBottom: '1px solid var(--border-light)',
                  background: 'var(--bg-primary)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                    {claim.claim_number || '—'}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                    background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                  }}>
                    {claim.status || 'open'}
                  </span>
                  {claim.job_count > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                    }}>
                      {claim.job_count} job{claim.job_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {claim.insured_name || 'Unknown'}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {claim.date_of_loss && (
                    <span>Loss: {new Date(claim.date_of_loss + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  )}
                  {claim.loss_city && <span>{claim.loss_city}{claim.loss_state ? `, ${claim.loss_state}` : ''}</span>}
                </div>
              </div>
            );
          })
        )}
      </PullToRefresh>
    </div>
  );
}
