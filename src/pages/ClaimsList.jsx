import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconSearch } from '@/components/Icons';
import { LossIcon, LOSS_CONFIG, DIVISION_COLORS as DIV_COLORS } from '@/components/DivisionIcons';
import PullToRefresh from '@/components/PullToRefresh';

const STATUS_MAP = {
  open:          { label: 'Open',          bg: '#eff6ff', color: '#2563eb' },
  in_progress:   { label: 'In Progress',   bg: '#fffbeb', color: '#d97706' },
  closed:        { label: 'Closed',        bg: '#f1f3f5', color: '#6b7280' },
  denied:        { label: 'Denied',        bg: '#fef2f2', color: '#dc2626' },
  settled:       { label: 'Settled',       bg: '#ecfdf5', color: '#059669' },
  supplementing: { label: 'Supplementing', bg: '#f5f3ff', color: '#7c3aed' },
};

const LOSS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'water', label: 'Water', emoji: null },
  { key: 'fire', label: 'Fire', emoji: '🔥' },
  { key: 'mold', label: 'Mold', emoji: '🦠' },
  { key: 'storm', label: 'Storm', emoji: '⛈️' },
  { key: 'sewer', label: 'Sewer', emoji: '🚿' },
  { key: 'vandalism', label: 'Vandalism', emoji: '🔨' },
  { key: 'other', label: 'Other', emoji: '📋' },
];

const SORT_OPTIONS = [
  { key: 'recent_activity', label: 'Recent Activity' },
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'client', label: 'Client A–Z' },
  { key: 'carrier', label: 'Carrier A–Z' },
  { key: 'loss_date', label: 'Date of Loss' },
  { key: 'jobs', label: 'Most Jobs' },
];

const fmtDate = (v) => {
  if (!v) return null;
  return new Date(v + (v.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtPh = (ph) => {
  if (!ph) return null;
  const d = ph.replace(/\D/g, '');
  const n = d.startsWith('1') ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : ph;
};

export default function ClaimsList() {
  const navigate = useNavigate();
  const { db } = useAuth();

  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [lossTab, setLossTab] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [sortBy, setSortBy] = useState('recent_activity');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await db.rpc('get_claims_list', {});
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadError(e.message);
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load claims', type: 'error' } }));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = [...claims];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.claim_number?.toLowerCase().includes(q) ||
        c.insurance_claim_number?.toLowerCase().includes(q) ||
        c.insured_name?.toLowerCase().includes(q) ||
        c.insurance_carrier?.toLowerCase().includes(q) ||
        c.loss_city?.toLowerCase().includes(q)
      );
    }
    if (lossTab !== 'all') list = list.filter(c => c.loss_type === lossTab);
    if (statusF !== 'all') list = list.filter(c => c.status === statusF);
    list.sort((a, b) => {
      switch (sortBy) {
        case 'recent_activity': {
          const av = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
          const bv = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
          return bv - av;
        }
        case 'newest':    return new Date(b.created_at) - new Date(a.created_at);
        case 'oldest':    return new Date(a.created_at) - new Date(b.created_at);
        case 'client':    return (a.insured_name || '').localeCompare(b.insured_name || '');
        case 'carrier':   return (a.insurance_carrier || '').localeCompare(b.insurance_carrier || '');
        case 'loss_date': return (b.date_of_loss || '').localeCompare(a.date_of_loss || '');
        case 'jobs':      return Number(b.job_count || 0) - Number(a.job_count || 0);
        default:          return 0;
      }
    });
    return list;
  }, [claims, search, lossTab, statusF, sortBy]);

  const lossCounts = useMemo(() => {
    const counts = { all: claims.length };
    for (const t of LOSS_TABS) if (t.key !== 'all') counts[t.key] = 0;
    for (const c of claims) { if (c.loss_type && counts[c.loss_type] !== undefined) counts[c.loss_type]++; }
    return counts;
  }, [claims]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  if (loadError) return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Claims</h1></div>
      <div style={{ padding: '24px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Failed to load claims</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>{loadError}</div>
        <button className="btn btn-primary btn-sm" onClick={load}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className="jobs-page">
      {/* Header */}
      <div className="jobs-header">
        <div>
          <h1 className="page-title">Claims</h1>
          <p className="page-subtitle">{filtered.length} of {claims.length} claims</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="input jobs-filter-select" value={statusF} onChange={e => setStatusF(e.target.value)} style={{ minWidth: 130 }}>
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_MAP).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>
          <select className="input jobs-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ minWidth: 130 }}>
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Loss Type Tabs */}
      <div className="division-tabs">
        {LOSS_TABS.filter(tab => tab.key === 'all' || (lossCounts[tab.key] || 0) > 0).map(tab => (
          <button key={tab.key} className={`division-tab${lossTab === tab.key ? ' active' : ''}`}
            onClick={() => setLossTab(tab.key)}>
            {tab.key !== 'all' && tab.emoji && <span className="division-tab-emoji">{tab.emoji}</span>}
            {tab.key !== 'all' && !tab.emoji && <LossIcon type={tab.key} size={14} />}
            <span>{tab.label}</span>
            <span className="division-tab-count">{lossCounts[tab.key] || 0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="jobs-filters">
        <div className="jobs-search-wrap" style={{ maxWidth: 'none', width: '100%' }}>
          <IconSearch style={{ width: 14, height: 14, position: 'absolute', left: 10, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input jobs-search" placeholder="Search claim #, client, carrier, city..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {(search || statusF !== 'all' || lossTab !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setStatusF('all'); setLossTab('all'); }}>Clear</button>
        )}
      </div>

      {/* Claim Cards */}
      <PullToRefresh onRefresh={load} className="job-card-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-text">{search || statusF !== 'all' || lossTab !== 'all' ? 'No claims match' : 'No claims yet'}</div>
            <div className="empty-state-sub">Try adjusting your filters or search</div>
          </div>
        ) : (
          filtered.map(claim => (
            <ClaimListCard key={claim.id} claim={claim}
              onClick={() => navigate(`/claims/${claim.id}`)} />
          ))
        )}
      </PullToRefresh>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CLAIM LIST CARD — matches JobListCard pattern
// ═══════════════════════════════════════════════════════════════

function ClaimListCard({ claim: c, onClick }) {
  const st = STATUS_MAP[c.status] || STATUS_MAP.open;
  const lossConf = LOSS_CONFIG[c.loss_type];
  const borderColor = lossConf?.color || '#6b7280';
  const jobs = Array.isArray(c.jobs_summary) ? c.jobs_summary : [];
  const lossDate = fmtDate(c.date_of_loss);
  const phone = fmtPh(c.client_phone);

  return (
    <div className="job-list-card" onClick={onClick}
      style={{ borderLeft: `3px solid ${borderColor}`, borderRadius: 'var(--radius-md)' }}>
      <div className="job-list-card-body">
        {/* Row 1: Client name + status badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span className="job-list-card-name" style={{ flex: 1 }}>{c.insured_name || 'Unknown Client'}</span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
            background: st.bg, color: st.color, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {st.label}
          </span>
        </div>

        {/* Row 2: Claim number + loss type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span className="job-list-card-jobnumber">{c.claim_number}</span>
          {c.insurance_claim_number && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', opacity: 0.65 }}>
              · {c.insurance_claim_number}
            </span>
          )}
          {lossConf && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 3,
              background: lossConf.bg, color: lossConf.color, lineHeight: '16px' }}>
              {lossConf.label?.toUpperCase()}
            </span>
          )}
          {Number(c.job_count) > 0 && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 3,
              background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', lineHeight: '16px' }}>
              {c.job_count} JOB{c.job_count !== 1 ? 'S' : ''}
            </span>
          )}
        </div>

        {/* Row 3: Location */}
        {(c.loss_city || c.loss_address) && (
          <div className="job-list-card-address">
            {c.loss_address || ''}{c.loss_city ? (c.loss_address ? ', ' : '') + c.loss_city : ''}{c.loss_state ? `, ${c.loss_state}` : ''}
          </div>
        )}

        {/* Row 4: Meta line */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {c.insurance_carrier && <span>{c.insurance_carrier}</span>}
          {c.insurance_carrier && (lossDate || phone) && <span style={{ color: 'var(--border-color)' }}>·</span>}
          {lossDate && <span>Loss: {lossDate}</span>}
          {phone && <span>{phone}</span>}
        </div>

        {/* Job pills */}
        {jobs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {jobs.slice(0, 4).map(j => (
              <span key={j.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)', cursor: 'pointer',
                borderLeft: `2px solid ${DIV_COLORS[j.division] || '#6b7280'}`,
              }} onClick={e => { e.stopPropagation(); window.location.href = `/jobs/${j.id}`; }}>
                {j.job_number || 'Job'}
              </span>
            ))}
            {jobs.length > 4 && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
              }}>+{jobs.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
