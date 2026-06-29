/**
 * ════════════════════════════════════════════════
 * FILE: ARDashboard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "A/R · Outstanding" tab of the My Money page — the accounts-receivable
 *   worklist. Four summary tiles (what's owed, what's overdue, what's been
 *   collected, what's been invoiced), an aging breakdown (how old the money owed
 *   is), and a searchable/filterable table of invoices with each one's balance,
 *   age, and status. Rows open that invoice.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /collections (the "A/R · Outstanding" tab)
 *   Rendered by:  src/pages/Collections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./collKit (palette, formatters, primitives), receives { db, navigate, period }
 *   Data:      reads  → get_ar_invoices() RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - COLOR SEMANTICS: a balance is neutral ink, never red. Red appears only on a
 *     genuinely past-due age pill / OVERDUE badge / the 90+ aging bucket. Green is
 *     collected/current; amber is aging. Do not redden outstanding balances.
 *   - The A/R worklist is period-INDEPENDENT (it always shows all open invoices,
 *     so aged debt can't hide). The header period switch scopes only the
 *     Invoiced + Collected tiles (money in the window) — matching the design
 *     system's stance that current A/R is a snapshot, not a period metric.
 *   - Address line under Claim · Job renders only if get_ar_invoices supplies
 *     job_address/job_city (additive RPC field) — absent today, shows gracefully.
 *   - Column sorting is client-side: clicking the Sent/Age/Total/Collected/Balance
 *     headers sorts the already-filtered rows. The default order is newest CREATED
 *     first (invoices.created_at, desc); null/undated values always sort last.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  C, STATUS, mono, tnum, fmt$, fmt$2, fmtDate, divColor, divLabel,
  midnight, daysPastDue, periodRange, inPeriod, downloadCsv, invoiceStatusKind,
  bucketKey, AGING_BUCKETS,
} from './collTokens';
import {
  CollCard, SegControl, SearchBox, DivisionSquare,
  ProgressBar, Pill, EmptyState, PopoverButton, FilterGroup, ToggleChip,
  FunnelIcon, ColumnsIcon,
} from './collKit';
import ARChatBubble from './ARChatBubble';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

// ─── SECTION: Helpers — aging buckets, columns ──────────────
// Aging buckets escalate by age: green → neutral → amber → amber → red. The boundaries and
// labels live in collTokens (AGING_BUCKETS + bucketKey) as the single source of truth shared
// with the AI Copilot's snapshot; this map only attaches each bucket's bar/text colors.
const AGING_SEG = {
  current: { seg: STATUS.success.solid, val: STATUS.success.text },
  b30:     { seg: '#cbd0d9',            val: C.body },
  b60:     { seg: STATUS.warning.solid, val: STATUS.warning.text },
  b90:     { seg: STATUS.warning.solid, val: STATUS.warning.text },
  b90p:    { seg: STATUS.danger.solid,  val: STATUS.danger.text },
};
const AGING = AGING_BUCKETS.map((b) => ({ ...b, ...AGING_SEG[b.key] }));

const COL = {
  client:    { label: 'Client',      fr: '1.7fr',  num: false },
  claimJob:  { label: 'Claim · Job', fr: '1.7fr',  num: false },
  sent:      { label: 'Sent',        fr: '0.85fr', num: false },
  age:       { label: 'Age',         fr: '1fr',    num: false },
  total:     { label: 'Total',       fr: '1fr',    num: true },
  collected: { label: 'Collected',   fr: '1fr',    num: true },
  balance:   { label: 'Balance',     fr: '1.25fr', num: true },
};
const COL_ORDER = ['client', 'claimJob', 'sent', 'age', 'total', 'collected', 'balance'];
const LOCKED = ['client', 'balance'];

// Headers the user can click to sort (the rest stay plain labels). Each maps to a
// comparable primitive; a null value (undated / no due date) sinks to the bottom
// regardless of direction so an empty cell never sorts to the top.
const SORTABLE = ['sent', 'age', 'total', 'collected', 'balance'];
// Default order for the A/R table: most recently CREATED invoice first. 'created' isn't a
// visible column (no header arrow) — it just seeds the order; clicking any header overrides it.
const DEFAULT_SORT = { key: 'created', dir: 'desc' };
function sortValue(r, key, today) {
  switch (key) {
    case 'created':   return r.created_at ? new Date(r.created_at).getTime() : null;
    case 'sent':      return r.sent_at ? new Date(r.sent_at).getTime() : null;
    case 'age':       return daysPastDue(r.due_date, today);   // overdue > 0, future < 0, none = null
    case 'total':     return Number(r.total || 0);
    case 'collected': return Number(r.amount_paid || 0);
    case 'balance':   return Number(r.balance || 0);
    default:          return null;
  }
}

const numInput = { width: 88, padding: '6px 9px', border: `1px solid ${C.cardBorder}`, borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', color: C.ink, background: '#fff', outline: 'none' };

// Plain text, not pills — let the one status badge carry the row's color. Overdue
// is a soft red, future/today are quiet so the table reads calm at a glance.
function AgePill({ r, today }) {
  const base = { fontSize: 12.5, fontWeight: 500 };
  if (Number(r.balance || 0) <= 0.005) return <span style={{ ...base, color: C.faint2 }}>—</span>;
  const d = daysPastDue(r.due_date, today);
  if (d == null) return <span style={{ ...base, color: C.faint }}>No due date</span>;
  if (d > 0) return <span style={{ ...base, color: STATUS.danger.text, fontWeight: 600 }}>{d}d overdue</span>;
  if (d === 0) return <span style={{ ...base, color: STATUS.warning.text, fontWeight: 600 }}>Due today</span>;
  return <span style={{ ...base, color: C.muted }}>Due in {-d}d</span>;
}

// ─── SECTION: Component ──────────────
export default function ARDashboard({ db, navigate, period = 'All', modalOpen = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('open');                 // open | overdue | all
  const [filters, setFilters] = useState({ divisions: [], sync: [], minAmt: '', maxAmt: '' });
  const [cols, setCols] = useState({ client: true, claimJob: true, sent: true, age: true, total: true, collected: true, balance: true });
  const [sort, setSort] = useState(DEFAULT_SORT); // newest created first until a header is clicked

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
      toast('Failed to load A/R: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = useMemo(() => midnight(), []);

  // Period scopes the whole A/R view by invoice date (drafts / undated always shown).
  const periodRows = useMemo(() => {
    const range = periodRange(period);
    return rows.filter(r => inPeriod(r.invoice_date || r.sent_at, range));
  }, [rows, period]);

  // ─── SECTION: Derived totals (Outstanding / Overdue / aging across the period) ──
  const k = useMemo(() => {
    const open = periodRows.filter(r => Number(r.balance) > 0.005);
    let outstanding = 0, overdue = 0, overdueCount = 0;
    const aging = {}; AGING.forEach(b => { aging[b.key] = { amount: 0, count: 0 }; });
    open.forEach(r => {
      const bal = Number(r.balance || 0);
      outstanding += bal;
      const d = daysPastDue(r.due_date, today);
      if (d != null && d > 0) { overdue += bal; overdueCount += 1; }
      const bk = aging[bucketKey(d)]; bk.amount += bal; bk.count += 1;
    });
    return { open, outstanding, overdue, overdueCount, openCount: open.length, aging };
  }, [periodRows, today]);

  const divisionOptions = useMemo(() => {
    const set = new Set();
    rows.forEach(r => { const d = String(r.division || '').toLowerCase(); if (d) set.add(d); });
    return [...set];
  }, [rows]);

  const activeFilterCount = filters.divisions.length + filters.sync.length + ((filters.minAmt !== '' || filters.maxAmt !== '') ? 1 : 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodRows.filter(r => {
      const bal = Number(r.balance || 0);
      if (mode === 'open' && bal <= 0.005) return false;
      if (mode === 'overdue' && !(bal > 0.005 && (daysPastDue(r.due_date, today) || 0) > 0)) return false;
      if (mode === 'collected' && !(Number(r.amount_paid || 0) > 0.005)) return false;
      if (filters.divisions.length && !filters.divisions.includes(String(r.division || '').toLowerCase())) return false;
      if (filters.sync.length) {
        const st = r.qbo_sync_error ? 'error' : (r.qbo_invoice_id ? 'synced' : 'unsynced');
        if (!filters.sync.includes(st)) return false;
      }
      if (filters.minAmt !== '' && bal < Number(filters.minAmt)) return false;
      if (filters.maxAmt !== '' && bal > Number(filters.maxAmt)) return false;
      if (q) {
        const hay = `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.invoice_number || ''} ${r.qbo_doc_number || ''} ${r.division || ''} ${r.job_address || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [periodRows, mode, search, filters, today]);

  // ─── SECTION: Sorting (client-side) ──────────────
  // Default is newest-created-first (DEFAULT_SORT, key 'created'). Clicking a header
  // sets that key; clicking it again flips direction. A null key falls back to the
  // RPC's own order (only reachable via legacy state — defaults never set null now).
  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, sort.key, today), vb = sortValue(b, sort.key, today);
      const na = va == null || Number.isNaN(va), nb = vb == null || Number.isNaN(vb);
      if (na && nb) return 0;
      if (na) return 1;            // nulls always last, both directions
      if (nb) return -1;
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [filtered, sort, today]);

  const onSort = (key) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

  const footer = useMemo(() => {
    const open = filtered.filter(r => Number(r.balance) > 0.005);
    return { count: open.length, sum: open.reduce((a, r) => a + Number(r.balance || 0), 0) };
  }, [filtered]);

  const visible = COL_ORDER.filter(key => cols[key]);
  const gtc = visible.map(key => COL[key].fr).join(' ');

  const exportCsv = () => {
    const header = ['Client', 'Invoice', 'Claim', 'Job', 'Division', 'Sent', 'Due', 'Total', 'Collected', 'Balance', 'Status'];
    const data = filtered.map(r => [
      r.client_name || '', r.qbo_doc_number || r.invoice_number || '', r.claim_number || '', r.job_number || '',
      divLabel(r.division), r.sent_at ? fmtDate(r.sent_at) : '', r.due_date ? fmtDate(r.due_date) : '',
      Number(r.total || 0).toFixed(2), Number(r.amount_paid || 0).toFixed(2), Number(r.balance || 0).toFixed(2),
      invoiceStatusKind(r, today),
    ]);
    downloadCsv('ar-aging-report.csv', header, data);
  };

  if (loading) return <div className="coll-loading">Loading A/R…</div>;

  // ─── SECTION: Render ──────────────
  return (
    <div>
      {/* A/R summary — ONE module: Outstanding hero + Overdue callout (both
          click-to-filter the table) over the aging bar + buckets. Replaces the
          old 4-tile row + separate aging card, which showed the same money twice
          (Outstanding = the aging total; Overdue = its past-due buckets). */}
      <CollCard pad="18px 20px 20px" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.title }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: STATUS.info.solid }} />
            A/R aging<span style={{ fontWeight: 500, color: C.faint }}> · days outstanding</span>
          </div>
          {k.outstanding <= 0
            ? <Pill color={STATUS.success.text} bg={STATUS.success.tint} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px' }}>Nothing outstanding</Pill>
            : k.overdue <= 0
              ? <Pill color={STATUS.success.text} bg={STATUS.success.tint} style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px' }}>100% current</Pill>
              : null}
        </div>

        {/* Headline — Outstanding hero + Overdue callout; both filter the table */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <button type="button" className="coll-arhead" data-active={mode === 'open'} onClick={() => setMode('open')}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, letterSpacing: '-.01em', lineHeight: 1, ...tnum }}>{fmt$(k.outstanding)}</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>outstanding · {k.openCount} open invoice{k.openCount === 1 ? '' : 's'}</div>
          </button>
          <button type="button" className="coll-arhead coll-arhead-r" data-active={mode === 'overdue'} onClick={() => setMode('overdue')}>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.overdue > 0 ? STATUS.danger.text : C.faint, ...tnum }}>{fmt$(k.overdue)}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: k.overdue > 0 ? STATUS.danger.text : C.muted }}>{k.overdue > 0 ? `${k.overdueCount} past due` : 'nothing past due'}</div>
          </button>
        </div>

        <div style={{ display: 'flex', width: '100%', height: 10, borderRadius: 6, overflow: 'hidden', background: C.track, marginBottom: 16 }}>
          {k.outstanding > 0 && AGING.map(b => k.aging[b.key].amount > 0 && (
            <div key={b.key} style={{ width: `${(k.aging[b.key].amount / k.outstanding) * 100}%`, background: b.seg }} />
          ))}
        </div>
        <div className="coll-aging-buckets">
          {AGING.map(b => {
            const cell = k.aging[b.key];
            const has = cell.amount > 0;
            return (
              <div key={b.key} className="coll-aging-cell">
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: C.faint }}>{b.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0 2px', color: has ? b.val : C.faint2, ...tnum }}>{fmt$(cell.amount)}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: has ? C.muted : C.faintSub }}>{cell.count} invoice{cell.count === 1 ? '' : 's'}</div>
              </div>
            );
          })}
        </div>
      </CollCard>

      {/* Invoice table */}
      <CollCard pad={0} style={{ overflow: 'hidden' }}>
        <div className="coll-toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search client, claim, job, invoice…" style={{ flex: 1, minWidth: 220 }} />
          <SegControl options={[{ value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'all', label: 'All' }]} value={mode} onChange={setMode} size="sm" ariaLabel="Status filter" />
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
                <FilterGroup label="Balance amount">
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
                        onChange={() => {
                          if (locked) return;
                          setCols(c => ({ ...c, [key]: !c[key] }));
                          if (sort.key === key && cols[key]) setSort(DEFAULT_SORT); // hiding the active sort column → default order
                        }} />
                      {COL[key].label}
                    </label>
                  );
                })}
              </>
            )}
          </PopoverButton>
        </div>

        <div className="coll-tablewrap">
          <div style={{ minWidth: 840 }}>
            <div className="coll-thead" style={{ display: 'grid', gridTemplateColumns: gtc, gap: 14 }}>
              {visible.map(key => {
                if (!SORTABLE.includes(key)) return <div key={key} style={{ textAlign: COL[key].num ? 'right' : 'left' }}>{COL[key].label}</div>;
                const active = sort.key === key;
                const arrow = <span className="coll-th-arr">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>;
                return (
                  <button key={key} type="button" className="coll-th-sort" data-active={active}
                    onClick={() => onSort(key)} style={{ justifyContent: COL[key].num ? 'flex-end' : 'flex-start' }}>
                    {COL[key].num ? <>{arrow}<span>{COL[key].label}</span></> : <><span>{COL[key].label}</span>{arrow}</>}
                  </button>
                );
              })}
            </div>
            {sorted.length === 0 ? (
              <EmptyState title="No invoices match" sub="Try a different filter or search term." />
            ) : sorted.map(r => {
              const paid = Number(r.amount_paid || 0), total = Number(r.total || 0);
              // Append city only when the address line doesn't already contain it
              // (job data is inconsistent — some rows pack the full address into one field).
              const addr = r.job_address
                ? (r.job_city && !r.job_address.toLowerCase().includes(r.job_city.toLowerCase()) ? `${r.job_address}, ${r.job_city}` : r.job_address)
                : (r.job_city || null);
              return (
                <div key={r.invoice_id} className="coll-row"
                  style={{ display: 'grid', gridTemplateColumns: gtc, gap: 14 }}
                  onClick={() => navigate(`/invoices/${r.invoice_id}`)}>
                  {visible.map(key => {
                    if (key === 'client') return (
                      <div key={key} style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.client_name || '—'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span style={{ ...mono, fontSize: 11, color: C.muted }}>{r.qbo_doc_number || r.invoice_number}</span>
                          {r.qbo_sync_error && <Pill color={STATUS.danger.text} bg={STATUS.danger.tint}>⚠ QB</Pill>}
                        </div>
                      </div>
                    );
                    if (key === 'claimJob') return (
                      <div key={key} style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                        <span style={{ marginTop: 3, flex: 'none' }}><DivisionSquare division={r.division} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ ...mono, fontSize: 12, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.claim_number || '—'}</div>
                          <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{divLabel(r.division)}{r.job_number ? ` · ${r.job_number}` : ''}</div>
                          {addr && <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr}</div>}
                        </div>
                      </div>
                    );
                    if (key === 'sent') return <div key={key} style={{ fontSize: 12.5, fontWeight: 600, color: r.sent_at ? C.body : C.faint2, ...tnum }}>{fmtDate(r.sent_at)}</div>;
                    if (key === 'age') return <div key={key}><AgePill r={r} today={today} /></div>;
                    if (key === 'total') return <div key={key} style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.ink, ...tnum }}>{fmt$2(r.total)}</div>;
                    if (key === 'collected') return (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: paid > 0 ? STATUS.success.text : C.faint, ...tnum }}>{fmt$2(paid)}</span>
                        <div style={{ width: 84, maxWidth: '100%' }}><ProgressBar pct={total > 0 ? (paid / total) * 100 : 0} color={STATUS.success.solid} height={4} /></div>
                      </div>
                    );
                    return <div key={key} style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 800, color: C.ink, ...tnum }}>{fmt$2(r.balance)}</div>;
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="coll-foot">
          <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>
            {footer.count} open invoice{footer.count === 1 ? '' : 's'} · <b style={{ color: C.ink, fontWeight: 800, ...tnum }}>{fmt$2(footer.sum)}</b> outstanding
          </span>
          <button type="button" className="coll-link" onClick={exportCsv}>Export A/R report →</button>
        </div>
      </CollCard>

      {/* AI A/R Copilot — floating, page-aware. Reads the live on-screen rows (k.open for the
          authoritative totals, `sorted` for the on-screen list) + the current view state. */}
      <ARChatBubble
        rows={k.open}
        filteredRows={sorted}
        today={today}
        viewState={{ period, search, mode, filters, sort }}
        hidden={modalOpen}
      />
    </div>
  );
}
