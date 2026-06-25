/**
 * ════════════════════════════════════════════════
 * FILE: PaymentsLedger.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Payments" tab of the My Money page — the record of cash that has come in.
 *   Three summary tiles (collected all-time, collected this month, how many
 *   payments are synced to QuickBooks) and a searchable table of cleared payments,
 *   newest first, showing who paid, on which claim/job/invoice, how, how much, and
 *   whether it reached QuickBooks. Rows open the claim's billing.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /collections (the "Payments" tab)
 *   Rendered by:  src/pages/Collections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collKit (palette, formatters, primitives), receives { db, navigate }
 *   Data:      reads  → get_payments_ledger() RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - get_payments_ledger returns CLEARED payments only — there is no in-flight /
 *     "processing" state in the data, so the design's optional Processing section
 *     is omitted here rather than faked. If a pending-payment source is added
 *     later, surface it above the cleared table.
 *   - Amounts are money-in, so green is correct here (collected = healthy).
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  C, STATUS, mono, tnum, fmt$, fmt$2, fmtDate, divLabel, downloadCsv,
} from './collTokens';
import {
  CollCard, Kpi, KpiGrid, SearchBox, DivisionSquare, EmptyState,
} from './collKit';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));
const cap = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '');

const GRID = '0.8fr 1.4fr 1.4fr 1fr 1.4fr 1fr 0.5fr';

export default function PaymentsLedger({ db, navigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_payments_ledger', { p_limit: 1000 });
      setRows(data || []);
    } catch (e) {
      toast('Failed to load payments: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Derived totals + filter ──────────────
  const k = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    let total = 0, month = 0, monthCount = 0, synced = 0;
    rows.forEach(r => {
      total += Number(r.amount || 0);
      if ((r.payment_date || '').startsWith(ym)) { month += Number(r.amount || 0); monthCount += 1; }
      if (r.qbo_payment_id) synced += 1;
    });
    return { total, month, monthCount, synced, count: rows.length, monthName };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const hay = `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.invoice_number || ''} ${r.qbo_doc_number || ''} ${r.reference_number || ''} ${r.division || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const shownTotal = useMemo(() => filtered.reduce((a, r) => a + Number(r.amount || 0), 0), [filtered]);

  const exportCsv = () => {
    const header = ['Date', 'Client', 'Claim', 'Job', 'Division', 'Invoice', 'Method', 'Source', 'Amount', 'QB synced', 'Reference'];
    const data = filtered.map(r => [
      r.payment_date ? fmtDate(r.payment_date) : '', r.client_name || '', r.claim_number || '', r.job_number || '',
      divLabel(r.division), r.qbo_doc_number || r.invoice_number || '', cap(r.payment_method), cap(r.payer_type),
      Number(r.amount || 0).toFixed(2), r.qbo_payment_id ? 'yes' : 'no', r.reference_number || '',
    ]);
    downloadCsv('payments.csv', header, data);
  };

  if (loading) return <div className="coll-loading">Loading payments…</div>;

  // ─── SECTION: Render ──────────────
  return (
    <div>
      <KpiGrid cols={3}>
        <Kpi label="Collected (all time)" value={fmt$(k.total)} valueColor={STATUS.success.text}>{k.count} payment{k.count === 1 ? '' : 's'}</Kpi>
        <Kpi label="This month" value={fmt$(k.month)} valueColor={STATUS.success.text}>{k.monthCount} payment{k.monthCount === 1 ? '' : 's'} in {k.monthName}</Kpi>
        <Kpi label="Synced to QuickBooks" value={`${k.synced}/${k.count}`} valueColor={k.synced === k.count ? STATUS.success.text : STATUS.warning.text}>
          {k.synced === k.count
            ? <span style={{ color: STATUS.success.text, fontWeight: 600 }}>all synced</span>
            : <span style={{ color: STATUS.warning.text, fontWeight: 600 }}>{k.count - k.synced} awaiting sync</span>}
        </Kpi>
      </KpiGrid>

      <CollCard pad={0} style={{ overflow: 'hidden' }}>
        <div className="coll-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search client, claim, invoice, reference…" style={{ flex: 1, minWidth: 220 }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: C.faint, whiteSpace: 'nowrap' }}>Cleared · newest first</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="💵" title={rows.length === 0 ? 'No payments recorded yet' : 'No payments match'} sub={rows.length === 0 ? 'Payments appear here as they clear.' : 'Try a different search term.'} />
        ) : (
          <div className="coll-tablewrap">
            <div style={{ minWidth: 820 }}>
              <div className="coll-thead" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14 }}>
                <div>Date</div><div>Client</div><div>Claim · Job</div><div>Invoice</div><div>Method / Source</div>
                <div style={{ textAlign: 'right' }}>Amount</div><div style={{ textAlign: 'center' }}>QB</div>
              </div>
              {filtered.map(r => (
                <div key={r.payment_id} className={`coll-row${r.claim_id ? '' : ' coll-static'}`} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14 }}
                  onClick={() => r.claim_id && navigate(`/collections/${r.claim_id}`)}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.body, ...tnum }}>{fmtDate(r.payment_date)}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.client_name || '—'}</div>
                  <div style={{ display: 'flex', gap: 8, minWidth: 0, alignItems: 'flex-start' }}>
                    <span style={{ marginTop: 3, flex: 'none' }}><DivisionSquare division={r.division} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...mono, fontSize: 12, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.claim_number || '—'}</div>
                      <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{divLabel(r.division)}{r.job_number ? ` · ${r.job_number}` : ''}</div>
                    </div>
                  </div>
                  <div style={{ ...mono, fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.qbo_doc_number || r.invoice_number || '—'}</div>
                  <div style={{ fontSize: 12, color: C.body, minWidth: 0 }}>
                    {r.payment_method ? cap(r.payment_method) : '—'}
                    {r.payer_type && <span style={{ color: C.faint }}> · {cap(r.payer_type)}</span>}
                    {r.is_deductible ? <span style={{ color: STATUS.warning.text, fontWeight: 600 }}> · Deductible</span> : ''}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: C.ink, ...tnum }}>{fmt$2(r.amount)}</div>
                  <div style={{ textAlign: 'center', fontSize: 13 }}>
                    {r.qbo_payment_id
                      ? <span title="Synced to QuickBooks" style={{ color: STATUS.success.solid, fontWeight: 700 }}>✓</span>
                      : r.qbo_sync_error
                        ? <span title={r.qbo_sync_error} style={{ color: STATUS.danger.solid, cursor: 'help', fontWeight: 700 }}>!</span>
                        : <span title="Not synced to QuickBooks" style={{ color: C.faint2 }}>—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="coll-foot">
          <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>
            {filtered.length} payment{filtered.length === 1 ? '' : 's'} · <b style={{ color: C.ink, fontWeight: 800, ...tnum }}>{fmt$(shownTotal)}</b> collected
          </span>
          <button type="button" className="coll-link" onClick={exportCsv}>Export payments →</button>
        </div>
      </CollCard>
    </div>
  );
}
