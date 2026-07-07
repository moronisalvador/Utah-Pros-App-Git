/**
 * ════════════════════════════════════════════════
 * FILE: ArAgingTab.jsx  (admin-mobile Collections — A/R aging tab)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "AR aging" tab of the mobile Collections screen. It shows how much money
 *   customers still owe (outstanding), how much of that is past due (overdue), and
 *   how much cash came in during the chosen time window (collected). Below that it
 *   breaks the owed money into age bands (Current, 1–30 days, … 90+) and lists the
 *   open invoices, newest first, each tappable to open that invoice.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/collections (the "AR aging" tab)
 *   Rendered by:  src/pages/tech/admin/AdminCollections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/admin-mobile
 *              (MoneyStatCard, AmListRow), @/components/TabLoading, ./collFormat,
 *              ./collUi
 *   Data:      reads → get_ar_invoices(), get_payments_received(p_start,p_end)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - FINANCIAL: this tab is only mounted when canAccess('overview_financials') is
 *     true (the parent gate), so neither the render nor these fetches happen for a
 *     non-privileged admin (finding F-2).
 *   - A/R is a snapshot: the aging + outstanding always reflect ALL open invoices
 *     (aged debt can't hide behind a period). The period switch scopes ONLY the
 *     "Collected" stat (period cash via get_payments_received) — mirrors desktop.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MoneyStatCard, AmListRow } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import {
  summarizeAr, arRowView, byCreatedDesc, midnight,
  AGING_BUCKETS, fmt$, fmt$2, periodBoundsISO,
} from './collFormat';
import { StatusChip, CollSearch, CollEmpty, CollFoot } from './collUi';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

export default function ArAgingTab({ period = 'mtd' }) {
  const { db } = useAuth();
  const [rows, setRows] = useState([]);
  const [collected, setCollected] = useState(null); // period cash from get_payments_received
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState(null); // active aging-band filter

  // dbRef keeps load() stable across token-refresh re-renders (same pattern the
  // desktop lists use to avoid a loading "blink").
  const dbRef = useRef(db);
  dbRef.current = db;

  const loadInvoices = useCallback(async () => {
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
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  // Period-scoped collected cash — refetched when the period changes.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await dbRef.current.rpc('get_payments_received', periodBoundsISO(period));
        if (alive) setCollected(Number(r?.total) || 0);
      } catch {
        if (alive) setCollected(null);
      }
    })();
    return () => { alive = false; };
  }, [period]);

  const today = useMemo(() => midnight(), []);
  const k = useMemo(() => summarizeAr(rows, today), [rows, today]);

  const { views, shownSum } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const open = rows.filter((r) => Number(r.balance || 0) > 0.005).sort(byCreatedDesc);
    const list = open
      .map((r) => arRowView(r, today))
      .filter((v) => (!q || v.search.includes(q)) && (bucket ? v.bucket === bucket : true));
    const ids = new Set(list.map((v) => v.id));
    const sum = open.filter((r) => ids.has(r.invoice_id)).reduce((a, r) => a + Number(r.balance || 0), 0);
    return { views: list, shownSum: sum };
  }, [rows, search, today, bucket]);

  if (loading) return <TabLoading />;

  const outstanding = k.outstanding;

  return (
    <div className="am-coll">
      <div className="am-coll-stats">
        <MoneyStatCard label="Outstanding" value={fmt$(k.outstanding)} delta={`${k.openCount} open`} />
        <MoneyStatCard
          label="Overdue"
          value={fmt$(k.overdue)}
          delta={k.overdue > 0 ? `${k.overdueCount} past due` : 'none past due'}
          trend={k.overdue > 0 ? 'down' : null}
        />
        <MoneyStatCard label="Collected" value={collected == null ? '—' : fmt$(collected)} delta={periodLabel(period)} muted />
      </div>

      {/* Aging bands — tap one to filter the list to that age band. */}
      <div className="am-coll-aging">
        {AGING_BUCKETS.map((b) => {
          const cell = k.aging[b.key];
          const active = bucket === b.key;
          const has = cell.amount > 0;
          const pct = outstanding > 0 ? (cell.amount / outstanding) * 100 : 0;
          return (
            <button
              key={b.key}
              type="button"
              className={`am-coll-band am-coll-band--${b.key}${active ? ' am-coll-band--active' : ''}`}
              aria-pressed={active}
              disabled={!has && !active}
              onClick={() => setBucket((cur) => (cur === b.key ? null : b.key))}
            >
              <span className="am-coll-band-label">{b.label}</span>
              <span className="am-coll-band-amt">{fmt$(cell.amount)}</span>
              <span className="am-coll-band-meta">{cell.count} inv</span>
              <span className="am-coll-band-bar" style={{ width: `${pct}%` }} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <CollSearch value={search} onChange={setSearch} placeholder="Search client, claim, invoice…" />

      {views.length === 0 ? (
        <CollEmpty title="Nothing outstanding" sub={search || bucket ? 'Try a different filter or search.' : 'All invoices are paid up.'} />
      ) : (
        <div className="am-coll-list">
          {views.map((v) => (
            <AmListRow
              key={v.id}
              to={v.href}
              title={v.title}
              detail={v.detail}
              trailing={
                <span className="am-coll-trail">
                  <span className="am-coll-amt">{v.amount}</span>
                  {v.age && <span className={`am-coll-age${v.overdue ? ' am-coll-age--overdue' : ''}`}>{v.age}</span>}
                  <StatusChip kind={v.status} />
                </span>
              }
            />
          ))}
        </div>
      )}

      <CollFoot>
        {views.length} open · <b>{fmt$2(shownSum)}</b> shown
      </CollFoot>
    </div>
  );
}

function periodLabel(p) {
  return { mtd: 'this month', last30: 'last 30 days', qtd: 'this quarter', ytd: 'this year' }[p] || '';
}
