/**
 * ════════════════════════════════════════════════
 * FILE: EstimatesList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Estimates" tab of the My Money page — the pre-sale quote pipeline. Three
 *   summary tiles (how many estimates are open, their total value, how many were
 *   won/converted into invoices) and a searchable list you can narrow to drafts,
 *   sent, or converted. Click a row to open that estimate's builder.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /collections (the "Estimates" tab)
 *   Rendered by:  src/pages/Collections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collKit (palette, formatters, primitives), receives { db, navigate }
 *   Data:      reads  → get_estimates() RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Same data + status model as the standalone /estimates page (Draft → Sent in
 *     QuickBooks → Converted to an invoice), so the two stay in agreement; this is
 *     a convenience view inside Collections, rows open /estimates/:id.
 *   - No period / Filters / Columns controls here (matches the design) — just
 *     search + the status segmented control.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  C, STATUS, mono, tnum, fmt$, fmt$2, fmtDate, divLabel,
} from './collTokens';
import {
  CollCard, Kpi, KpiGrid, SegControl, SearchBox, DivisionSquare, Pill, EmptyState,
} from './collKit';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const TYPE_LABEL = { initial: 'Initial', supplement: 'Supplement', change_order: 'Change order', final: 'Final' };

// Draft → Sent (pushed to QuickBooks) → Converted (turned into an invoice).
function estStatus(r) {
  if (r.converted_invoice_id) return { label: 'CONVERTED', ...STATUS.success };
  if (r.qbo_sync_error)       return { label: 'SYNC ERROR', ...STATUS.danger };
  if (r.qbo_estimate_id)      return { label: 'SENT', ...STATUS.info };
  return { label: 'DRAFT', ...STATUS.neutral };
}

const GRID = '1fr 1.4fr 1.3fr 0.9fr 0.9fr 1fr 0.9fr';

export default function EstimatesList({ db, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('all');                  // all | draft | sent | converted

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_estimates');
      setRows(data || []);
    } catch (e) {
      toast('Failed to load estimates: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Derived totals + filter ──────────────
  const k = useMemo(() => {
    const open = rows.filter(r => !r.converted_invoice_id);
    return {
      openCount: open.length,
      openValue: open.reduce((s, r) => s + Number(r.amount || 0), 0),
      convertedCount: rows.filter(r => r.converted_invoice_id).length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (mode === 'draft' && !(!r.qbo_estimate_id && !r.converted_invoice_id)) return false;
      if (mode === 'sent' && !(r.qbo_estimate_id && !r.converted_invoice_id)) return false;
      if (mode === 'converted' && !r.converted_invoice_id) return false;
      if (q) {
        const hay = `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.estimate_number || ''} ${r.qbo_doc_number || ''} ${r.division || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, mode, search]);

  // ─── SECTION: Render ──────────────
  return (
    <div>
      <KpiGrid cols={3}>
        <Kpi label="Open estimates" value={String(k.openCount)} valueColor={C.ink}>{fmt$(k.openValue)} potential</Kpi>
        <Kpi label="Open value" value={fmt$(k.openValue)} valueColor={STATUS.info.solid}>awaiting approval</Kpi>
        <Kpi label="Converted" value={String(k.convertedCount)} valueColor={STATUS.success.text}>→ invoices</Kpi>
      </KpiGrid>

      <CollCard pad={0} style={{ overflow: 'hidden' }}>
        <div className="coll-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search customer, claim, job, estimate #…" style={{ flex: 1, minWidth: 220 }} />
          <SegControl options={[{ value: 'all', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'sent', label: 'Sent' }, { value: 'converted', label: 'Converted' }]} value={mode} onChange={setMode} size="sm" ariaLabel="Estimate status" />
          <span style={{ fontSize: 12, color: C.faint, fontWeight: 500, whiteSpace: 'nowrap' }}>{filtered.length} estimate{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? (
          <div className="coll-loading">Loading estimates…</div>
        ) : filtered.length === 0 ? (
          rows.length === 0
            ? <EmptyState title="No estimates yet" sub='Create one with the "+ New estimate" button.' />
            : <EmptyState title="No estimates match" sub="Try a different filter or search term." />
        ) : (
          <div className="coll-tablewrap">
            <div style={{ minWidth: 820 }}>
              <div className="coll-thead" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14 }}>
                <div>Estimate</div><div>Customer</div><div>Job type</div><div>Kind</div><div>Date</div>
                <div style={{ textAlign: 'right' }}>Amount</div><div>Status</div>
              </div>
              {filtered.map(r => {
                const st = estStatus(r);
                return (
                  <div key={r.estimate_id} className="coll-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14 }}
                    onClick={() => navigate(`/estimates/${r.estimate_id}`)}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...mono, fontSize: 12, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.qbo_doc_number || r.estimate_number || 'Draft'}</div>
                      {r.converted_invoice_id && r.converted_invoice_number && <div style={{ fontSize: 11, color: C.faint }}>→ {r.converted_invoice_number}</div>}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.client_name || '—'}</div>
                    <div style={{ display: 'flex', gap: 8, minWidth: 0, alignItems: 'flex-start' }}>
                      <span style={{ marginTop: 3, flex: 'none' }}><DivisionSquare division={r.division} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{divLabel(r.division) || '—'}</div>
                        {(r.claim_number || r.job_number) && <div style={{ ...mono, fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.claim_number || ''}{r.job_number ? ` · ${r.job_number}` : ''}</div>}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: C.body }}>{TYPE_LABEL[r.estimate_type] || '—'}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.body, ...tnum }}>{fmtDate(r.created_at)}</div>
                    <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.ink, ...tnum }}>{fmt$2(r.amount)}</div>
                    <div><Pill color={st.text} bg={st.tint} border={st.border} style={{ letterSpacing: '.04em' }}>{st.label}</Pill></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CollCard>
    </div>
  );
}
