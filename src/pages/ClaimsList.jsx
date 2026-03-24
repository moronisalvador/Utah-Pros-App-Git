import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const DIV_EMOJI  = { water: '💧', mold: '🧬', reconstruction: '🏗️', fire: '🔥', contents: '📦' };
const STATUS_MAP = {
  open:          { label: 'Open',          color: '#2563eb', bg: '#eff6ff' },
  in_progress:   { label: 'In Progress',   color: '#d97706', bg: '#fffbeb' },
  closed:        { label: 'Closed',        color: '#6b7280', bg: '#f9fafb' },
  denied:        { label: 'Denied',        color: '#dc2626', bg: '#fef2f2' },
  settled:       { label: 'Settled',       color: '#059669', bg: '#ecfdf5' },
  supplementing: { label: 'Supplementing', color: '#7c3aed', bg: '#f5f3ff' },
};
const LOSS_EMOJI = { water: '💧', fire: '🔥', mold: '🧬', storm: '⛈️', sewer: '🚽', vandalism: '🔨', other: '📋' };

const fmt$ = (v) => { if (!v || Number(v) === 0) return '—'; const n = Number(v); if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'k'; return '$' + Math.round(n); };
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const fmtPh = (ph) => { if (!ph) return null; const d = ph.replace(/\D/g,''); const n = d.startsWith('1') ? d.slice(1) : d; return n.length === 10 ? `(${n.slice(0,3)}) ${n.slice(3,6)}-${n.slice(6)}` : ph; };

export default function ClaimsList() {
  const navigate = useNavigate();
  const { db } = useAuth();

  const [claims,  setClaims]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [statusF, setStatusF] = useState('all');
  const [lossF,   setLossF]   = useState('all');
  const [balF,    setBalF]    = useState('all'); // all | outstanding | paid

  const load = async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_claims_list', {});
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load claims: ' + e.message, type: 'error' } }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = [...claims];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.claim_number?.toLowerCase().includes(q) ||
        c.insurance_claim_number?.toLowerCase().includes(q) ||
        c.insured_name?.toLowerCase().includes(q) ||
        c.insurance_carrier?.toLowerCase().includes(q)
      );
    }
    if (statusF !== 'all') list = list.filter(c => c.status === statusF);
    if (lossF   !== 'all') list = list.filter(c => c.loss_type === lossF);
    if (balF === 'outstanding') list = list.filter(c => Number(c.total_balance) > 0);
    if (balF === 'paid')        list = list.filter(c => Number(c.total_balance) <= 0 && Number(c.total_invoiced) > 0);
    return list;
  }, [claims, search, statusF, lossF, balF]);

  // Summary stats
  const stats = useMemo(() => ({
    total:       claims.length,
    open:        claims.filter(c => c.status === 'open' || c.status === 'in_progress').length,
    outstanding: claims.reduce((s, c) => s + Number(c.total_balance || 0), 0),
    invoiced:    claims.reduce((s, c) => s + Number(c.total_invoiced || 0), 0),
  }), [claims]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page-container">

      {/* Header */}
      <div className="page-header" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
        <div>
          <h1 className="page-title">Claims</h1>
          <p className="page-subtitle">{stats.total} claims · {stats.open} active · {fmt$(stats.outstanding)} outstanding</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 1, background: 'var(--border-color)', borderBottom: '1px solid var(--border-color)', overflowX: 'auto' }}>
        {[
          { label: 'Total Claims',  value: stats.total,                     color: 'var(--text-primary)', isNum: false },
          { label: 'Active',        value: stats.open,                      color: '#d97706',             isNum: false },
          { label: 'Total Billed',  value: fmt$(stats.invoiced),            color: 'var(--accent)',       isNum: true  },
          { label: 'Outstanding',   value: fmt$(stats.outstanding),         color: stats.outstanding > 0 ? '#dc2626' : '#059669', isNum: true },
        ].map(k => (
          <div key={k.label} style={{ flex: 1, minWidth: 90, padding: '10px 14px', background: 'var(--bg-primary)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 20px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-primary)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 160, maxWidth: 300 }}>
          <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-tertiary)', pointerEvents: 'none' }}>🔍</span>
          <input className="input" style={{ paddingLeft: 28, height: 34, fontSize: 13 }} placeholder="Claim #, client, carrier…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={{ height: 34, width: 'auto', minWidth: 120 }} value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
        <select className="input" style={{ height: 34, width: 'auto', minWidth: 110 }} value={lossF} onChange={e => setLossF(e.target.value)}>
          <option value="all">All Loss Types</option>
          {['water','fire','mold','storm','sewer','vandalism','other'].map(t => (
            <option key={t} value={t}>{LOSS_EMOJI[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <select className="input" style={{ height: 34, width: 'auto', minWidth: 120 }} value={balF} onChange={e => setBalF(e.target.value)}>
          <option value="all">All Balances</option>
          <option value="outstanding">Has Balance</option>
          <option value="paid">Fully Paid</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', alignSelf: 'center', marginLeft: 4 }}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '48px 20px' }}>
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No claims found</div>
            <div className="empty-state-text">Try adjusting your filters.</div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="claims-desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Insured</th>
                    <th>Carrier / Ins. #</th>
                    <th>Loss</th>
                    <th style={{ textAlign: 'right' }}>Jobs</th>
                    <th style={{ textAlign: 'right' }}>Invoiced</th>
                    <th style={{ textAlign: 'right' }}>Collected</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => {
                    const st = STATUS_MAP[c.status] || { label: c.status || 'Open', color: '#6b7280', bg: '#f9fafb' };
                    const bal = Number(c.total_balance || 0);
                    return (
                      <tr key={c.id} onClick={() => navigate(`/claims/${c.id}`)} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{c.claim_number}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{fmtDate(c.date_of_loss) !== '—' ? 'Loss: ' + fmtDate(c.date_of_loss) : 'No date of loss'}</div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.insured_name || '—'}</div>
                          {c.client_phone && <div style={{ fontSize: 11, color: 'var(--accent)' }}>{fmtPh(c.client_phone)}</div>}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{c.insurance_carrier || <span style={{ color: 'var(--text-tertiary)' }}>Out of pocket</span>}</div>
                          {c.insurance_claim_number && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{c.insurance_claim_number}</div>}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {c.loss_type
                            ? <span style={{ fontSize: 12 }}>{LOSS_EMOJI[c.loss_type] || '📋'} {c.loss_type.charAt(0).toUpperCase() + c.loss_type.slice(1)}</span>
                            : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}
                          {c.loss_city && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{c.loss_city}{c.loss_state ? ', ' + c.loss_state : ''}</div>}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700 }}>{c.job_count || 0}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmt$(c.total_invoiced)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>{fmt$(c.total_collected)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: bal > 0 ? '#dc2626' : (Number(c.total_invoiced) > 0 ? '#059669' : 'var(--text-tertiary)') }}>
                          {bal > 0 ? fmt$(bal) : (Number(c.total_invoiced) > 0 ? '✓ Paid' : '—')}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="claims-mobile-cards">
              {filtered.map(c => {
                const st = STATUS_MAP[c.status] || { label: c.status || 'Open', color: '#6b7280', bg: '#f9fafb' };
                const bal = Number(c.total_balance || 0);
                return (
                  <div key={c.id} onClick={() => navigate(`/claims/${c.id}`)}
                    style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13, fontFamily: 'var(--font-mono)' }}>{c.claim_number}</div>
                        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{c.insured_name || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{c.insurance_carrier || 'Out of pocket'}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color }}>{st.label}</span>
                        {bal > 0 && <div style={{ fontWeight: 800, fontSize: 15, color: '#dc2626', marginTop: 4 }}>{fmt$(bal)}</div>}
                        {bal <= 0 && Number(c.total_invoiced) > 0 && <div style={{ fontWeight: 700, fontSize: 13, color: '#059669', marginTop: 4 }}>✓ Paid</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {c.loss_type && <span>{LOSS_EMOJI[c.loss_type]} {c.loss_type}</span>}
                      {c.date_of_loss && <span>Loss: {fmtDate(c.date_of_loss)}</span>}
                      <span>{c.job_count || 0} job{c.job_count !== 1 ? 's' : ''}</span>
                      {Number(c.total_invoiced) > 0 && <span>Billed: {fmt$(c.total_invoiced)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
              {filtered.length} claims · Outstanding: <strong style={{ color: filtered.reduce((s,c) => s + Number(c.total_balance||0), 0) > 0 ? '#dc2626' : 'inherit' }}>{fmt$(filtered.reduce((s,c) => s + Number(c.total_balance||0), 0))}</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
