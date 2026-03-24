import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import PullToRefresh from '@/components/PullToRefresh';

const STATUS_MAP = {
  open:          { label: 'Open',          color: '#2563eb', bg: '#eff6ff' },
  in_progress:   { label: 'In Progress',   color: '#d97706', bg: '#fffbeb' },
  closed:        { label: 'Closed',        color: '#6b7280', bg: '#f9fafb' },
  denied:        { label: 'Denied',        color: '#dc2626', bg: '#fef2f2' },
  settled:       { label: 'Settled',       color: '#059669', bg: '#ecfdf5' },
  supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
};
const LOSS_EMOJI  = { water: '💧', fire: '🔥', mold: '🧬', storm: '⛈️', sewer: '🚽', vandalism: '🔨', other: '📋' };
const LOSS_TYPES  = ['water', 'fire', 'mold', 'storm', 'sewer', 'vandalism', 'other'];
const DIV_COLORS  = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669', general: '#6b7280' };

const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : null;
const fmtPh   = (ph) => { if (!ph) return null; const d = ph.replace(/\D/g,''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}` : ph; };
const initials = (name) => { if (!name) return '?'; const p = name.trim().split(/\s+/); return p.length === 1 ? p[0].slice(0,2).toUpperCase() : (p[0][0] + p[p.length-1][0]).toUpperCase(); };
const AVATAR_COLORS = ['#2563eb','#7c3aed','#db2777','#d97706','#059669','#0891b2','#dc2626'];
const avatarColor = (s) => { if (!s) return AVATAR_COLORS[0]; const n = s.split('').reduce((a, c) => a + c.charCodeAt(0), 0); return AVATAR_COLORS[n % AVATAR_COLORS.length]; };

export default function ClaimsList() {
  const navigate = useNavigate();
  const { db }   = useAuth();

  const [claims,  setClaims]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [searchD, setSearchD] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [lossF,   setLossF]   = useState('all');
  const [sortBy,  setSortBy]  = useState('newest');

  useEffect(() => { const t = setTimeout(() => setSearchD(search), 250); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_claims_list', {});
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load claims', type: 'error' } }));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = [...claims];
    if (searchD.trim()) {
      const q = searchD.toLowerCase();
      list = list.filter(c =>
        c.claim_number?.toLowerCase().includes(q) ||
        c.insurance_claim_number?.toLowerCase().includes(q) ||
        c.insured_name?.toLowerCase().includes(q) ||
        c.insurance_carrier?.toLowerCase().includes(q) ||
        c.loss_city?.toLowerCase().includes(q)
      );
    }
    if (statusF !== 'all') list = list.filter(c => c.status === statusF);
    if (lossF   !== 'all') list = list.filter(c => c.loss_type === lossF);
    list.sort((a, b) => {
      switch (sortBy) {
        case 'newest':    return new Date(b.created_at) - new Date(a.created_at);
        case 'oldest':    return new Date(a.created_at) - new Date(b.created_at);
        case 'client':    return (a.insured_name||'').localeCompare(b.insured_name||'');
        case 'carrier':   return (a.insurance_carrier||'').localeCompare(b.insurance_carrier||'');
        case 'loss_date': return (b.date_of_loss||'').localeCompare(a.date_of_loss||'');
        case 'jobs':      return Number(b.job_count||0) - Number(a.job_count||0);
        default:          return 0;
      }
    });
    return list;
  }, [claims, searchD, statusF, lossF, sortBy]);

  const stats = useMemo(() => ({
    total:  claims.length,
    active: claims.filter(c => c.status === 'open' || c.status === 'in_progress').length,
    jobs:   claims.reduce((s, c) => s + Number(c.job_count||0), 0),
  }), [claims]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="customers-page">

      <div className="customers-header">
        <div>
          <h1 className="page-title">Claims</h1>
          <p className="page-subtitle">
            {stats.total} claim{stats.total !== 1 ? 's' : ''} · {stats.active} active · {stats.jobs} jobs
          </p>
        </div>
      </div>

      <div className="customers-filters" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="customers-search-wrap" style={{ flex: 1, minWidth: 180 }}>
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input
            className="input"
            placeholder="Claim #, client, carrier, city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, width: '100%', fontSize: 16 }}
          />
        </div>

        <select className="input" style={{ height: 36, width: 'auto', minWidth: 120, fontSize: 16 }} value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>

        <select className="input" style={{ height: 36, width: 'auto', minWidth: 120, fontSize: 16 }} value={lossF} onChange={e => setLossF(e.target.value)}>
          <option value="all">All Loss Types</option>
          {LOSS_TYPES.map(t => <option key={t} value={t}>{LOSS_EMOJI[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>

        <select className="input" style={{ height: 36, width: 'auto', minWidth: 130, fontSize: 16 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="newest">↓ Newest</option>
          <option value="oldest">↑ Oldest</option>
          <option value="client">A–Z Client</option>
          <option value="carrier">A–Z Carrier</option>
          <option value="loss_date">Date of Loss</option>
          <option value="jobs">Most Jobs</option>
        </select>

        {(search || statusF !== 'all' || lossF !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusF('all'); setLossF('all'); }}>Clear</button>
        )}
      </div>

      <PullToRefresh onRefresh={load} className="customers-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-text">{search || statusF !== 'all' || lossF !== 'all' ? 'No claims match' : 'No claims yet'}</div>
            <div className="empty-state-sub">Try adjusting your filters</div>
          </div>
        ) : filtered.map(c => {
          const st   = STATUS_MAP[c.status] || STATUS_MAP.open;
          const jobs = Array.isArray(c.jobs_summary) ? c.jobs_summary : [];

          return (
            <div key={c.id} className="customer-card" onClick={() => navigate(`/claims/${c.id}`)}>

              {/* Avatar — loss emoji on colored background */}
              <div className="customer-card-avatar" style={{ background: avatarColor(c.claim_number), fontSize: 18 }}>
                {c.loss_type ? (LOSS_EMOJI[c.loss_type] || '📋') : initials(c.insured_name)}
              </div>

              {/* Body */}
              <div className="customer-card-body">
                {/* Claim number + insurance claim # */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>
                    {c.claim_number}
                  </span>
                  {c.insurance_claim_number && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-tertiary)', opacity: 0.65 }}>
                      · {c.insurance_claim_number}
                    </span>
                  )}
                </div>

                {/* Insured name — big like customer name */}
                <div className="customer-card-name">{c.insured_name || 'Unknown'}</div>

                {/* Meta row */}
                <div className="customer-card-meta">
                  {c.client_phone && <span>{fmtPh(c.client_phone)}</span>}
                  <span style={{ color: c.insurance_carrier ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                    {c.insurance_carrier || 'Out of pocket'}
                  </span>
                  {(c.loss_city || c.loss_state) && (
                    <span>{c.loss_city}{c.loss_state ? ', ' + c.loss_state : ''}</span>
                  )}
                  {c.date_of_loss && <span>Loss: {fmtDate(c.date_of_loss)}</span>}
                </div>

                {/* Job pills — same pattern as customer-card-jobs */}
                {jobs.length > 0 && (
                  <div className="customer-card-jobs" style={{ marginTop: 5 }}>
                    {jobs.slice(0, 4).map(j => (
                      <span
                        key={j.id}
                        className="customer-card-job-pill"
                        style={{ borderLeftColor: DIV_COLORS[j.division] || '#6b7280', borderLeftWidth: 2 }}
                        onClick={e => { e.stopPropagation(); navigate(`/jobs/${j.id}`); }}
                      >
                        {j.job_number || 'Job'}
                      </span>
                    ))}
                    {jobs.length > 4 && (
                      <span className="customer-card-job-pill">+{jobs.length - 4}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Right — status badge + job count */}
              <div className="customer-card-right">
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>
                  {st.label}
                </span>
                {Number(c.job_count) > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {c.job_count} job{c.job_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

            </div>
          );
        })}
      </PullToRefresh>

      {filtered.length > 0 && (
        <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
          {filtered.length} claim{filtered.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
