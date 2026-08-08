/**
 * ════════════════════════════════════════════════
 * FILE: Estimates.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Estimates hub. Shows every estimate in one searchable list — its number,
 *   customer, the claim/job it belongs to, the kind (initial/supplement/etc.), the
 *   amount, and whether it's a draft, sent, or already turned into an invoice. Click
 *   a row to open its builder. "+ New estimate" starts one. Mirrors the Collections
 *   invoices list.
 *
 * WHERE IT LIVES:
 *   Route:        /estimates
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/lib/claimUtils (canEditBilling),
 *              @/lib/estimateStatus, @/components/NewEstimateModal
 *   Data:      reads  → get_estimates() RPC · writes → none (modal creates)
 *
 * NOTES / GOTCHAS:
 *   - Status and filtering come from @/lib/estimateStatus, shared with the
 *     Collections tab and admin-mobile: Draft → Saved (in QuickBooks) → Sent
 *     (emailed to the customer) → Converted (→ invoice). "Sent" means EMAILED.
 *   - Gated by the page:estimates feature flag + canEditBilling for the create button.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { canEditBilling } from '@/lib/claimUtils';
import {
  ESTIMATE_FILTER_OPTIONS, estimateStatusKind, estimateStatusLabel, matchesEstimateFilter,
} from '@/lib/estimateStatus';
import { err } from '@/lib/toast';
import NewEstimateModal from '@/components/NewEstimateModal';

const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt$0 = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (v) => v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
const TYPE_LABEL = { initial: 'Initial', supplement: 'Supplement', change_order: 'Change order', final: 'Final' };
const GRID = 'minmax(110px,1fr) minmax(140px,1.4fr) minmax(130px,1.3fr) 110px 90px 110px 100px';

// Draft → Saved (in QuickBooks) → Sent (emailed) → Converted (turned into an invoice).
// The word itself comes from @/lib/estimateStatus so this page, the Collections tab
// and admin-mobile can never disagree; only the palette is local.
const STATUS_TONE = {
  converted: { bg: '#f0fdf4',             color: '#16a34a',             border: '#bbf7d0' },
  error:     { bg: '#fef2f2',             color: '#dc2626',             border: '#fecaca' },
  sent:      { bg: 'var(--accent-light)', color: 'var(--accent)',       border: '#bfdbfe' },
  saved:     { bg: '#ede9fe',             color: '#7c3aed',             border: '#ddd6fe' },
  draft:     { bg: 'var(--bg-tertiary)',  color: 'var(--text-tertiary)', border: 'var(--border-light)' },
};

function statusOf(r) {
  const kind = estimateStatusKind(r);
  return { label: estimateStatusLabel(kind), ...(STATUS_TONE[kind] || STATUS_TONE.draft) };
}

export default function Estimates() {
  const { db, employee, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const canEdit = canEditBilling(employee?.role);
  const estimatesOn = isFeatureEnabled('page:estimates');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('all');                   // all | draft | saved | sent | converted
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_estimates');
      setRows(data || []);
    } catch (e) {
      err('Failed to load estimates: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { if (estimatesOn) load(); else setLoading(false); }, [estimatesOn, load]);

  const totals = useMemo(() => {
    const open = rows.filter(r => !r.converted_invoice_id);
    return {
      openCount: open.length,
      openValue: open.reduce((s, r) => s + Number(r.amount || 0), 0),
      convertedCount: rows.filter(r => r.converted_invoice_id).length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let r = rows.filter(x => matchesEstimateFilter(x, mode));
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(x =>
        (x.client_name || '').toLowerCase().includes(q) ||
        (x.claim_number || '').toLowerCase().includes(q) ||
        (x.job_number || '').toLowerCase().includes(q) ||
        (x.estimate_number || '').toLowerCase().includes(q) ||
        (x.qbo_doc_number || '').toLowerCase().includes(q));
    }
    return r;
  }, [rows, mode, search]);

  if (!estimatesOn) {
    return <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto', color: 'var(--text-tertiary)' }}>Estimates are turned off (feature flag <code>page:estimates</code>).</div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Estimates</h1>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)} style={{ gap: 5 }}>+ New estimate</button>}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <KPI label="Open estimates" value={String(totals.openCount)} sub={`${fmt$0(totals.openValue)} potential`} />
        <KPI label="Open value" value={fmt$0(totals.openValue)} color="var(--accent)" />
        <KPI label="Converted" value={String(totals.convertedCount)} color="#16a34a" sub="→ invoices" />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, claim, job, estimate #…"
          style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
        {/* wrap, not clip: this group carries five tabs since the Saved tier was split
            out of Sent, and the parent's `overflow: hidden` would silently cut the last
            one off at a narrow width rather than reflow it. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, background: 'var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {ESTIMATE_FILTER_OPTIONS.map(({ value: v, label: l }) => (
            <button key={v} onClick={() => setMode(v)} style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', border: 'none', background: mode === v ? 'var(--accent)' : 'var(--bg-primary)', color: mode === v ? '#fff' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{filtered.length} estimate{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ padding: 24, color: 'var(--text-tertiary)' }}>Loading estimates…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          {rows.length === 0 ? 'No estimates yet. Create one with “+ New estimate”.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 820 }}>
              <Row cells={['Estimate', 'Customer', 'Job type', 'Type', 'Date', 'Amount', 'Status']} />
              {filtered.map((r, i) => {
                const st = statusOf(r);
                return (
                  <div key={r.estimate_id} className="est-row" onClick={() => navigate(`/estimates/${r.estimate_id}`, { viewTransition: true })}
                    style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '10px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)', cursor: 'pointer' }}>
                    <Cell>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.qbo_doc_number || r.estimate_number || 'Draft'}</span>
                      {r.converted_invoice_id && r.converted_invoice_number && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>→ {r.converted_invoice_number}</div>}
                    </Cell>
                    <Cell>{r.client_name || '—'}</Cell>
                    <Cell>
                      <div style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{(r.division || '—').replace(/_/g, ' ')}</div>
                      {(r.claim_number || r.job_number) && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.claim_number || ''}{r.job_number ? ` · ${r.job_number}` : ''}</div>}
                    </Cell>
                    <Cell><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{TYPE_LABEL[r.estimate_type] || '—'}</span></Cell>
                    <Cell>{fmtDate(r.created_at)}</Cell>
                    <Cell num>{fmt$(r.amount)}</Cell>
                    <Cell>
                      <span title={r.qbo_sync_error || undefined} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: st.bg, color: st.color, border: `1px solid ${st.border}`, whiteSpace: 'nowrap' }}>{st.label}</span>
                    </Cell>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showNew && <NewEstimateModal db={db} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Row({ cells }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '8px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {cells.map((c, i) => <div key={i} style={{ textAlign: i === 5 ? 'right' : 'left' }}>{c}</div>)}
    </div>
  );
}

function Cell({ children, num, style }) {
  return <div style={{ fontSize: 13, textAlign: num ? 'right' : 'left', color: 'var(--text-primary)', ...style }}>{children}</div>;
}

function KPI({ label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}
