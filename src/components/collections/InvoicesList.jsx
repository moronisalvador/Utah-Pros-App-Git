/**
 * ════════════════════════════════════════════════
 * FILE: InvoicesList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Invoices" tab of the My Money page — every invoice (open, paid, or
 *   draft) in one searchable, filterable list. You can search, narrow by status,
 *   scope to a time period, toggle columns, and click any row to open that
 *   invoice in the editor.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /collections (the "Invoices" tab)
 *   Rendered by:  src/pages/Collections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collKit (palette, formatters, primitives), receives { db, navigate, period }
 *   Data:      reads  → get_ar_invoices() RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Reuses get_ar_invoices() (the same RPC the A/R tab uses) so the two tabs
 *     always agree on amounts/status. This tab shows ALL invoices; A/R defaults
 *     to outstanding only.
 *   - COLOR SEMANTICS: balance is neutral ink, never red. Status is carried by
 *     the badge (PAID green / PARTIAL amber / DRAFT neutral / OVERDUE red).
 *   - The header period switch filters this list by invoice date (drafts/undated
 *     always show); default is "All".
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  C, STATUS, mono, tnum, fmt$, fmt$2, fmtDate, divColor, divLabel,
  midnight, periodRange, inPeriod, downloadCsv, invoiceStatusKind,
} from './collTokens';
import {
  CollCard, SegControl, SearchBox, StatusText, DivisionSquare,
  EmptyState, PopoverButton, FilterGroup, ToggleChip, FunnelIcon, ColumnsIcon,
} from './collKit';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

const COL = {
  invoice:  { label: 'Invoice',     fr: '1fr',   num: false },
  customer: { label: 'Customer',    fr: '1.5fr', num: false },
  claimJob: { label: 'Claim · Job', fr: '1.6fr', num: false },
  date:     { label: 'Date',        fr: '0.9fr', num: false },
  total:    { label: 'Total',       fr: '1fr',   num: true },
  balance:  { label: 'Balance',     fr: '1.1fr', num: true },
};
const COL_ORDER = ['invoice', 'customer', 'claimJob', 'date', 'total', 'balance'];
const LOCKED = ['invoice', 'balance'];
const numInput = { width: 88, padding: '6px 9px', border: `1px solid ${C.cardBorder}`, borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', color: C.ink, background: '#fff', outline: 'none' };

// Default order: most recently CREATED invoice first (matches the A/R + Estimates tabs).
// get_ar_invoices() comes back balance-desc, so we re-sort here. Null dates sort last.
const byCreatedDesc = (a, b) =>
  (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0);

export default function InvoicesList({ db, navigate, period = 'All' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('all');                  // all | open | paid | draft
  const [filters, setFilters] = useState({ divisions: [], sync: [], minAmt: '', maxAmt: '' });
  const [cols, setCols] = useState({ invoice: true, customer: true, claimJob: true, date: true, total: true, balance: true });

  // ─── SECTION: Data fetching ──────────────
  // dbRef holds the latest REST client so load() stays stable across renders. A token
  // refresh on tab refocus rebuilds `db`; the old [db] dep re-fired load() and flashed the
  // loading state ("blink"). Same pattern as InvoiceEditor/EstimateEditor.
  const dbRef = useRef(db);
  dbRef.current = db;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dbRef.current.rpc('get_ar_invoices');
      setRows(data || []);
    } catch (e) {
      toast('Failed to load invoices: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = useMemo(() => midnight(), []);

  // ─── SECTION: Helpers ──────────────
  const divisionOptions = useMemo(() => {
    const set = new Set();
    rows.forEach(r => { const d = String(r.division || '').toLowerCase(); if (d) set.add(d); });
    return [...set];
  }, [rows]);

  const activeFilterCount = filters.divisions.length + filters.sync.length + ((filters.minAmt !== '' || filters.maxAmt !== '') ? 1 : 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const range = periodRange(period);
    return rows.filter(r => {
      const total = Number(r.total || 0), bal = Number(r.balance || 0);
      if (!inPeriod(r.invoice_date || r.sent_at, range)) return false;
      if (mode === 'open' && bal <= 0.005) return false;
      if (mode === 'paid' && !(total > 0 && bal <= 0.005)) return false;
      if (mode === 'draft' && !(r.status === 'draft' || (!r.qbo_invoice_id && !r.sent_at))) return false;
      if (filters.divisions.length && !filters.divisions.includes(String(r.division || '').toLowerCase())) return false;
      if (filters.sync.length) {
        const st = r.qbo_sync_error ? 'error' : (r.qbo_invoice_id ? 'synced' : 'unsynced');
        if (!filters.sync.includes(st)) return false;
      }
      if (filters.minAmt !== '' && total < Number(filters.minAmt)) return false;
      if (filters.maxAmt !== '' && total > Number(filters.maxAmt)) return false;
      if (q) {
        const hay = `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.invoice_number || ''} ${r.qbo_doc_number || ''} ${r.qbo_invoice_id || ''} ${r.division || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(byCreatedDesc);
  }, [rows, mode, search, filters, period]);

  const billed = useMemo(() => filtered.reduce((a, r) => a + Number(r.total || 0), 0), [filtered]);

  const visible = COL_ORDER.filter(key => cols[key]);
  const gtc = visible.map(key => COL[key].fr).join(' ');

  const exportCsv = () => {
    const header = ['Invoice', 'Customer', 'Claim', 'Job', 'Division', 'Date', 'Total', 'Balance', 'Status'];
    const data = filtered.map(r => [
      r.qbo_doc_number || r.invoice_number || '', r.client_name || '', r.claim_number || '', r.job_number || '',
      divLabel(r.division), (r.invoice_date || r.sent_at) ? fmtDate(r.invoice_date || r.sent_at) : '',
      Number(r.total || 0).toFixed(2), Number(r.balance || 0).toFixed(2), invoiceStatusKind(r, today),
    ]);
    downloadCsv('invoices.csv', header, data);
  };

  if (loading) return <div className="coll-loading">Loading invoices…</div>;

  // ─── SECTION: Render ──────────────
  return (
    <CollCard pad={0} style={{ overflow: 'hidden' }}>
      <div className="coll-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search customer, claim, job, invoice #…" style={{ flex: 1, minWidth: 220 }} />
        <SegControl options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'paid', label: 'Paid' }, { value: 'draft', label: 'Drafts' }]} value={mode} onChange={setMode} size="sm" ariaLabel="Status filter" />
        <span style={{ fontSize: 12, color: C.faint, fontWeight: 500, whiteSpace: 'nowrap' }}>{filtered.length} invoice{filtered.length === 1 ? '' : 's'}</span>
        <PopoverButton label="Filters" icon={<FunnelIcon />} count={activeFilterCount} width={300}>
          {() => (
            <>
              <FilterGroup label="Division">
                <div className="coll-filter-chips">
                  {divisionOptions.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>None</span>}
                  {divisionOptions.map(d => (
                    <ToggleChip key={d} active={filters.divisions.includes(d)} swatch={divColor(d)}
                      onClick={() => setFilters(f => ({ ...f, divisions: f.divisions.includes(d) ? f.divisions.filter(x => x !== d) : [...f.divisions, d] }))}>
                      {divLabel(d)}
                    </ToggleChip>
                  ))}
                </div>
              </FilterGroup>
              <FilterGroup label="QuickBooks sync">
                <div className="coll-filter-chips">
                  {[['synced', 'Synced'], ['unsynced', 'Not synced'], ['error', 'Sync error']].map(([v, l]) => (
                    <ToggleChip key={v} active={filters.sync.includes(v)}
                      onClick={() => setFilters(f => ({ ...f, sync: f.sync.includes(v) ? f.sync.filter(x => x !== v) : [...f.sync, v] }))}>
                      {l}
                    </ToggleChip>
                  ))}
                </div>
              </FilterGroup>
              <FilterGroup label="Invoice total">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" inputMode="decimal" placeholder="Min" value={filters.minAmt} onChange={e => setFilters(f => ({ ...f, minAmt: e.target.value }))} style={numInput} />
                  <span style={{ color: C.faint, fontSize: 12 }}>to</span>
                  <input type="number" inputMode="decimal" placeholder="Max" value={filters.maxAmt} onChange={e => setFilters(f => ({ ...f, maxAmt: e.target.value }))} style={numInput} />
                </div>
              </FilterGroup>
              <div className="coll-pop-foot">
                <button type="button" className="coll-link" onClick={() => setFilters({ divisions: [], sync: [], minAmt: '', maxAmt: '' })}>Clear all</button>
                <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{activeFilterCount} active</span>
              </div>
            </>
          )}
        </PopoverButton>
        <PopoverButton label="Columns" icon={<ColumnsIcon />} width={200}>
          {() => (
            <>
              {COL_ORDER.map(key => {
                const locked = LOCKED.includes(key);
                return (
                  <label key={key} className={`coll-col-item${locked ? ' locked' : ''}`}>
                    <input type="checkbox" checked={cols[key]} disabled={locked}
                      onChange={() => !locked && setCols(c => ({ ...c, [key]: !c[key] }))} />
                    {COL[key].label}
                  </label>
                );
              })}
            </>
          )}
        </PopoverButton>
      </div>

      <div className="coll-tablewrap">
        <div style={{ minWidth: 760 }}>
          <div className="coll-thead" style={{ display: 'grid', gridTemplateColumns: gtc, gap: 14 }}>
            {visible.map(key => <div key={key} style={{ textAlign: COL[key].num ? 'right' : 'left' }}>{COL[key].label}</div>)}
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No invoices match" sub="Try a different filter or search term." />
          ) : filtered.map(r => {
            const kind = invoiceStatusKind(r, today);
            return (
              <div key={r.invoice_id} className="coll-row" style={{ display: 'grid', gridTemplateColumns: gtc, gap: 14 }}
                onClick={() => navigate(`/invoices/${r.invoice_id}`)}>
                {visible.map(key => {
                  if (key === 'invoice') return <div key={key} style={{ ...mono, fontSize: 12, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.qbo_doc_number || r.invoice_number}</div>;
                  if (key === 'customer') return <div key={key} style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.client_name || '—'}</div>;
                  if (key === 'claimJob') return (
                    <div key={key} style={{ display: 'flex', gap: 8, minWidth: 0, alignItems: 'flex-start' }}>
                      <span style={{ marginTop: 3, flex: 'none' }}><DivisionSquare division={r.division} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...mono, fontSize: 12, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.claim_number || '—'}</div>
                        <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{divLabel(r.division)}{r.job_number ? ` · ${r.job_number}` : ''}</div>
                      </div>
                    </div>
                  );
                  if (key === 'date') return <div key={key} style={{ fontSize: 12.5, fontWeight: 600, color: (r.invoice_date || r.sent_at) ? C.body : C.faint2, ...tnum }}>{fmtDate(r.invoice_date || r.sent_at)}</div>;
                  if (key === 'total') return <div key={key} style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.ink, ...tnum }}>{fmt$2(r.total)}</div>;
                  return (
                    <div key={key} style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, ...tnum }}>{fmt$2(r.balance)}</div>
                      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}><StatusText kind={kind} /></div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="coll-foot">
        <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>
          {filtered.length === rows.length ? 'Showing all invoices' : `${filtered.length} invoice${filtered.length === 1 ? '' : 's'}`} · <b style={{ color: C.ink, fontWeight: 800, ...tnum }}>{fmt$(billed)}</b> billed
        </span>
        <button type="button" className="coll-link" onClick={exportCsv}>Export invoices →</button>
      </div>
    </CollCard>
  );
}
