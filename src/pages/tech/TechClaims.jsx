/**
 * ════════════════════════════════════════════════
 * FILE: TechClaims.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The list of insurance claims a field technician browses on their phone.
 *   They can switch between "My Claims" (claims they've worked) and "All
 *   Claims", and type in a search box to filter by claim number, customer
 *   name, city, or insurance company. Each row shows the customer, address,
 *   and a few colored tags; tapping a row opens that claim's detail screen.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/claims
 *   Rendered by:  src/App.jsx (the "tech/claims" route, inside the TechLayout
 *                  shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/components/PullToRefresh,
 *              @/components/Icons, ./techConstants, @/lib/toast
 *   Data:      All access goes through the db client from useAuth (RPC only).
 *              Tables below were resolved from each RPC, not guessed:
 *              reads  → appointment_crew, appointments, claims, contacts,
 *                        job_documents, job_time_entries, jobs, system_events
 *                        ("My Claims" → get_tech_claims); appointments, claims,
 *                        contacts, job_documents, job_time_entries, jobs,
 *                        system_events ("All Claims" → get_claims_list)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - "My Claims" calls get_tech_claims, but falls back to get_claims_list if
 *     that RPC isn't deployed yet (wrapped in try/catch).
 *   - The scope toggle (mine/all) is remembered per device in localStorage
 *     under 'upr:tech-claims-scope'.
 *   - Search is debounced 200ms and runs purely in memory over the already
 *     loaded claims — it does not re-query the database.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { IconSearch } from '@/components/Icons';
import { CLAIM_STATUS_COLORS as STATUS_COLORS, DIV_PILL_COLORS } from './techConstants';
import { toast } from '@/lib/toast';

export default function TechClaims() {
  // ─── SECTION: State & hooks ──────────────
  const { db, employee } = useAuth();
  const navigate = useNavigate();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filtered, setFiltered] = useState([]);
  // Scope default = 'all' for everyone; last choice persists per device in localStorage
  const [scope, setScope] = useState(() => {
    try {
      const saved = localStorage.getItem('upr:tech-claims-scope');
      return saved === 'mine' || saved === 'all' ? saved : 'all';
    } catch { return 'all'; }
  });

  // Persist scope changes
  useEffect(() => {
    try { localStorage.setItem('upr:tech-claims-scope', scope); } catch { /* ignore */ }
  }, [scope]);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);
    try {
      let result;
      if (scope === 'mine') {
        try {
          result = await db.rpc('get_tech_claims', { p_employee_id: employee.id });
        } catch {
          // RPC may not exist yet — fall back to get_claims_list
          result = await db.rpc('get_claims_list');
        }
      } else {
        result = await db.rpc('get_claims_list');
      }
      setClaims(result || []);
    } catch (e) {
      toast('Failed to load claims', 'error');
    }
    setLoading(false);
  }, [db, employee?.id, scope]);

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

  // ─── SECTION: Helpers ──────────────
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ─── SECTION: Render ──────────────
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

        {/* Scope toggle */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 'var(--space-4)' }}>
          {[{ key: 'mine', label: 'My Claims' }, { key: 'all', label: 'All Claims' }].map(t => (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              style={{
                padding: '8px 18px', borderRadius: 'var(--radius-full)', border: '1px solid',
                fontSize: 14, fontWeight: scope === t.key ? 600 : 400, cursor: 'pointer',
                height: 48,
                background: scope === t.key ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: scope === t.key ? '#fff' : 'var(--text-secondary)',
                borderColor: scope === t.key ? 'var(--accent)' : 'var(--border-color)',
                fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search bar — 48px tall, 16px font to prevent iOS zoom */}
        <div style={{ position: 'relative', marginBottom: 'var(--space-4)' }}>
          <IconSearch style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: 'var(--text-tertiary)' }} />
          <input
            className="input"
            placeholder="Search claims..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              paddingLeft: 40, fontSize: 16,
              height: 48, borderRadius: 12,
            }}
          />
        </div>
      </div>

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div className="empty-state-text">
              {query ? `No claims match '${query}'` : 'No claims found'}
            </div>
            {query && (
              <div className="empty-state-sub">
                <button
                  onClick={() => setQuery('')}
                  style={{
                    color: 'var(--accent)', background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        ) : (
          filtered.map(claim => {
            const sc = STATUS_COLORS[claim.status] || STATUS_COLORS.open;
            const divColor = claim.primary_division ? DIV_PILL_COLORS[claim.primary_division] : null;
            const address = [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ')
              || (claim.loss_city ? `${claim.loss_city}${claim.loss_state ? `, ${claim.loss_state}` : ''}` : '');

            return (
              <div
                key={claim.id}
                onClick={() => navigate(`/tech/claims/${claim.id}`)}
                style={{
                  padding: '14px var(--space-4)',
                  borderBottom: '1px solid var(--border-light)',
                  background: 'var(--bg-primary)',
                  cursor: 'pointer',
                  minHeight: 80,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {/* Row 1: claim number + date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-tertiary)',
                  }}>
                    {claim.claim_number || '—'}
                  </span>
                  {claim.date_of_loss && (
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {formatDate(claim.date_of_loss)}
                    </span>
                  )}
                </div>

                {/* Row 2: insured name */}
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {claim.insured_name || 'Unknown'}
                </div>

                {/* Row 3: address */}
                {address && (
                  <div style={{ fontSize: 14, color: 'var(--accent)', marginBottom: 6 }}>
                    {address}
                  </div>
                )}

                {/* Row 4: pills */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {divColor && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: divColor.bg, color: divColor.color,
                    }}>
                      {claim.primary_division}
                    </span>
                  )}
                  {claim.job_count > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                    }}>
                      {claim.job_count} job{claim.job_count !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                  }}>
                    {claim.status || 'open'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </PullToRefresh>
    </div>
  );
}
