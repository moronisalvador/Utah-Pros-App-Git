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
const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'sewer', 'vandalism', 'other'];
const DIV_COLORS = { water: '#2563eb', mold: '#9d174d', reconstruction: '#d97706', fire: '#dc2626', contents: '#059669', general: '#6b7280' };

// ── Loss type config: color + SVG icon ────────────────────────────────────────
const LOSS_CONFIG = {
  water:     { bg: '#dbeafe', color: '#1d4ed8', label: 'Water' },
  fire:      { bg: '#fee2e2', color: '#b91c1c', label: 'Fire' },
  mold:      { bg: '#f3e8ff', color: '#7e22ce', label: 'Mold' },
  storm:     { bg: '#fef9c3', color: '#a16207', label: 'Storm' },
  sewer:     { bg: '#d1fae5', color: '#065f46', label: 'Sewer' },
  vandalism: { bg: '#ffe4e6', color: '#be123c', label: 'Vandalism' },
  other:     { bg: '#f1f5f9', color: '#475569', label: 'Other' },
};

function LossIcon({ type, size = 20 }) {
  const s = { width: size, height: size, display: 'block' };
  const color = LOSS_CONFIG[type]?.color || '#475569';
  switch (type) {
    case 'water': return (
      <svg style={s} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2z"/>
      </svg>
    );
    case 'fire': return (
      <svg style={s} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2c0 0-1 3-3 5C7 9.5 6 11 6 13a6 6 0 0 0 12 0c0-4-4-7-4-9-1 1.5-1 3-1 3s-1-1-1-5z"/>
        <path d="M12 15a2 2 0 0 1-2-2c0-1.5 2-4 2-4s2 2.5 2 4a2 2 0 0 1-2 2z" fill="white" opacity="0.5"/>
      </svg>
    );
    case 'mold': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="3"/>
        <circle cx="12" cy="5"  r="1.8"/>
        <circle cx="12" cy="19" r="1.8"/>
        <circle cx="5"  cy="12" r="1.8"/>
        <circle cx="19" cy="12" r="1.8"/>
        <circle cx="7"  cy="7"  r="1.4"/>
        <circle cx="17" cy="7"  r="1.4"/>
        <circle cx="7"  cy="17" r="1.4"/>
        <circle cx="17" cy="17" r="1.4"/>
      </svg>
    );
    case 'storm': return (
      <svg style={s} viewBox="0 0 24 24" fill={color}>
        <path d="M13 2L4 14h7l-2 8 11-12h-7l2-8z"/>
      </svg>
    );
    case 'sewer': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="6" width="16" height="4" rx="2"/>
        <path d="M8 10v2M12 10v4M16 10v2"/>
        <path d="M6 14h12"/>
        <path d="M8 14v4M16 14v4"/>
        <path d="M12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" fill={color} opacity="0.3"/>
      </svg>
    );
    case 'vandalism': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21l9-9"/>
        <path d="M12.5 7.5l2-2a2.12 2.12 0 0 1 3 3l-2 2"/>
        <path d="M3 21h4l9.5-9.5-4-4L3 21z" fill={color} opacity="0.2"/>
        <line x1="16" y1="8" x2="18" y2="6"/>
      </svg>
    );
    default: return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="13" y2="17"/>
      </svg>
    );
  }
}

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
          {LOSS_TYPES.map(t => <option key={t} value={t}>{LOSS_CONFIG[t]?.label || t}</option>)}
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
          const st      = STATUS_MAP[c.status] || STATUS_MAP.open;
          const lossConf = LOSS_CONFIG[c.loss_type];
          const jobs    = Array.isArray(c.jobs_summary) ? c.jobs_summary : [];

          return (
            <div key={c.id} className="customer-card" onClick={() => navigate(`/claims/${c.id}`)}>

              {/* Avatar — SVG icon on type-colored bg, or initials on hashed color */}
              <div
                className="customer-card-avatar"
                style={{
                  background:     lossConf ? lossConf.bg : avatarColor(c.claim_number),
                  color:          lossConf ? lossConf.color : '#fff',
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  fontSize:       lossConf ? undefined : 14,
                }}
              >
                {lossConf
                  ? <LossIcon type={c.loss_type} size={22} />
                  : initials(c.insured_name)
                }
              </div>

              {/* Body */}
              <div className="customer-card-body">
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

                <div className="customer-card-name">{c.insured_name || 'Unknown'}</div>

                <div className="customer-card-meta">
                  {c.client_phone && <span>{fmtPh(c.client_phone)}</span>}
                  <span style={{ color: c.insurance_carrier ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                    {c.insurance_carrier || 'Out of pocket'}
                  </span>
                  {c.loss_city && (
                    <span>{c.loss_city}{c.loss_state ? ', ' + c.loss_state : ''}</span>
                  )}
                  {c.date_of_loss && <span>Loss: {fmtDate(c.date_of_loss)}</span>}
                </div>

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
