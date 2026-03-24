import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_MAP = {
  open:          { label: 'Open',          color: '#2563eb', bg: '#eff6ff' },
  in_progress:   { label: 'In Progress',   color: '#d97706', bg: '#fffbeb' },
  closed:        { label: 'Closed',        color: '#6b7280', bg: '#f9fafb' },
  denied:        { label: 'Denied',        color: '#dc2626', bg: '#fef2f2' },
  settled:       { label: 'Settled',       color: '#059669', bg: '#ecfdf5' },
  supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
};
const LOSS_EMOJI = { water: '💧', fire: '🔥', mold: '🧬', storm: '⛈️', sewer: '🚽', vandalism: '🔨', other: '📋' };
const LOSS_TYPES = ['water', 'fire', 'mold', 'storm', 'sewer', 'vandalism', 'other'];

const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const fmtPh   = (ph) => { if (!ph) return null; const d = ph.replace(/\D/g,''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}` : ph; };

function SortTh({ label, col, current, dir, onSort, align = 'left' }) {
  const active = current === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{
        padding: '8px 14px',
        textAlign: align,
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        background: 'var(--bg-secondary)',
        borderBottom: '2px solid var(--border-color)',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {label} {active ? (dir === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.35 }}>↕</span>}
    </th>
  );
}

export default function ClaimsList() {
  const navigate = useNavigate();
  const { db } = useAuth();

  const [claims,  setClaims]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [statusF, setStatusF] = useState('all');
  const [lossF,   setLossF]   = useState('all');
  const [sortBy,  setSortBy]  = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const load = async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_claims_list', {});
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load: ' + e.message, type: 'error' } }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

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
    if (statusF !== 'all') list = list.filter(c => c.status === statusF);
    if (lossF   !== 'all') list = list.filter(c => c.loss_type === lossF);

    list.sort((a, b) => {
      let av, bv;
      switch (sortBy) {
        case 'insured_name':      av = a.insured_name || '';        bv = b.insured_name || '';        break;
        case 'insurance_carrier': av = a.insurance_carrier || '';   bv = b.insurance_carrier || '';   break;
        case 'loss_type':         av = a.loss_type || '';           bv = b.loss_type || '';           break;
        case 'date_of_loss':      av = a.date_of_loss || '';        bv = b.date_of_loss || '';        break;
        case 'status':            av = a.status || '';              bv = b.status || '';              break;
        case 'job_count':         av = Number(a.job_count || 0);    bv = Number(b.job_count || 0);    break;
        case 'loss_city':         av = a.loss_city || '';           bv = b.loss_city || '';           break;
        default:                  av = a.created_at || '';          bv = b.created_at || '';
      }
      if (typeof av === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [claims, search, statusF, lossF, sortBy, sortDir]);

  const stats = useMemo(() => ({
    total:  claims.length,
    active: claims.filter(c => c.status === 'open' || c.status === 'in_progress').length,
    jobs:   claims.reduce((s, c) => s + Number(c.job_count || 0), 0),
  }), [claims]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  const sp = { col: sortBy, dir: sortDir, onSort: toggleSort };

  return (
    <div className="page-container">

      {/* Header */}
      <div className="page-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
        <div>
          <h1 className="page-title">Claims</h1>
          <p className="page-subtitle">{stats.total} claims · {stats.active} active · {stats.jobs} jobs</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 20px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-primary)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 160, maxWidth: 320 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 28, height: 34, fontSize: 16 }}
            placeholder="Claim #, client, carrier, city…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="input" style={{ height: 34, width: 'auto', minWidth: 120, fontSize: 16 }} value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
        <select className="input" style={{ height: 34, width: 'auto', minWidth: 120, fontSize: 16 }} value={lossF} onChange={e => setLossF(e.target.value)}>
          <option value="all">All Loss Types</option>
          {LOSS_TYPES.map(t => (
            <option key={t} value={t}>{LOSS_EMOJI[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table / Cards */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px 20px' }}>
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No claims found</div>
            <div className="empty-state-text">Try adjusting your filters.</div>
          </div>
        ) : (
          <>
            {/* ── Desktop table ── */}
            <div className="claims-desktop-table">
              <table>
                <thead>
                  <tr>
                    <SortTh label="Claim #"  col="created_at"         {...sp} />
                    <SortTh label="Insured"  col="insured_name"        {...sp} />
                    <SortTh label="Carrier"  col="insurance_carrier"   {...sp} />
                    <SortTh label="Loss"     col="loss_type"           {...sp} />
                    <SortTh label="City"     col="loss_city"           {...sp} />
                    <SortTh label="Date of Loss" col="date_of_loss"    {...sp} />
                    <SortTh label="Jobs"     col="job_count" align="right" {...sp} />
                    <SortTh label="Status"   col="status"              {...sp} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const st = STATUS_MAP[c.status] || { label: c.status || 'Open', color: '#6b7280', bg: '#f9fafb' };
                    return (
                      <tr
                        key={c.id}
                        onClick={() => navigate(`/claims/${c.id}`)}
                        style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{c.claim_number}</div>
                          {c.insurance_claim_number && (
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{c.insurance_claim_number}</div>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.insured_name || '—'}</div>
                          {c.client_phone && (
                            <a href={`tel:${c.client_phone}`} onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                              {fmtPh(c.client_phone)}
                            </a>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: c.insurance_carrier ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                          {c.insurance_carrier || 'Out of pocket'}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12 }}>
                          {c.loss_type
                            ? <span>{LOSS_EMOJI[c.loss_type] || '📋'} {c.loss_type.charAt(0).toUpperCase() + c.loss_type.slice(1)}</span>
                            : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>
                          {c.loss_city ? `${c.loss_city}${c.loss_state ? ', ' + c.loss_state : ''}` : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {fmtDate(c.date_of_loss)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>
                          {c.job_count || 0}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Mobile cards ── */}
            <div className="claims-mobile-cards">
              {filtered.map(c => {
                const st = STATUS_MAP[c.status] || { label: c.status || 'Open', color: '#6b7280', bg: '#f9fafb' };
                return (
                  <div
                    key={c.id}
                    onClick={() => navigate(`/claims/${c.id}`)}
                    style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{c.claim_number}</div>
                        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.insured_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{c.insurance_carrier || 'Out of pocket'}</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color, flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
                        {st.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                      {c.loss_type && <span>{LOSS_EMOJI[c.loss_type]} {c.loss_type}</span>}
                      {c.loss_city && <span>📍 {c.loss_city}{c.loss_state ? ', ' + c.loss_state : ''}</span>}
                      {c.date_of_loss && <span>Loss: {fmtDate(c.date_of_loss)}</span>}
                      <span>{c.job_count || 0} job{c.job_count !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
              {filtered.length} claims · {filtered.reduce((s, c) => s + Number(c.job_count || 0), 0)} jobs
            </div>
          </>
        )}
      </div>
    </div>
  );
}
