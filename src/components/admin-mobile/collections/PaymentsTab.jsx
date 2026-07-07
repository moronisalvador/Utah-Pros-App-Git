/**
 * ════════════════════════════════════════════════
 * FILE: PaymentsTab.jsx  (admin-mobile Collections — Payments ledger tab)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Payments ledger" tab of the mobile Collections screen — the record of
 *   cash that has come in, newest first. It shows total collected and how many
 *   payments reached QuickBooks, then a searchable list of each cleared payment
 *   (who paid, on which claim/invoice, how much, and whether it synced). A payment
 *   tied to an invoice taps through to that invoice.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/collections (the "Payments" tab)
 *   Rendered by:  src/pages/tech/admin/AdminCollections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/admin-mobile
 *              (MoneyStatCard, AmListRow), @/components/TabLoading, ./collFormat,
 *              ./collUi
 *   Data:      reads → get_payments_ledger(p_limit) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - FINANCIAL: only mounted when canAccess('overview_financials') is true (the
 *     parent gate), so neither render nor fetch happens for a non-privileged admin.
 *   - get_payments_ledger returns CLEARED payments only (no in-flight state).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { MoneyStatCard, AmListRow } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import { paymentRowView, fmt$, fmt$2 } from './collFormat';
import { CollSearch, CollEmpty, CollFoot } from './collUi';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

export default function PaymentsTab() {
  const { db } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const dbRef = useRef(db);
  dbRef.current = db;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dbRef.current.rpc('get_payments_ledger', { p_limit: 1000 });
      setRows(data || []);
    } catch (e) {
      toast('Failed to load payments: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const k = useMemo(() => {
    let total = 0, synced = 0;
    rows.forEach((r) => { total += Number(r.amount || 0); if (r.qbo_payment_id) synced += 1; });
    return { total, synced, count: rows.length };
  }, [rows]);

  const { views, shownSum } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchIds = new Set(
      rows.map(paymentRowView).filter((v) => !q || v.search.includes(q)).map((v) => v.id),
    );
    const list = rows.filter((r) => matchIds.has(r.payment_id));
    const sum = list.reduce((a, r) => a + Number(r.amount || 0), 0);
    return { views: list.map(paymentRowView), shownSum: sum };
  }, [rows, search]);

  if (loading) return <TabLoading />;

  return (
    <div className="am-coll">
      <div className="am-coll-stats">
        <MoneyStatCard label="Collected" value={fmt$(k.total)} delta={`${k.count} payment${k.count === 1 ? '' : 's'}`} />
        <MoneyStatCard
          label="Synced to QBO"
          value={`${k.synced}/${k.count}`}
          delta={k.synced === k.count ? 'all synced' : `${k.count - k.synced} awaiting`}
          trend={k.synced === k.count ? 'up' : null}
          muted
        />
      </div>

      <CollSearch value={search} onChange={setSearch} placeholder="Search client, claim, reference…" />

      {views.length === 0 ? (
        <CollEmpty title={rows.length === 0 ? 'No payments recorded yet' : 'No payments match'} sub={rows.length === 0 ? 'Payments appear here as they clear.' : 'Try a different search term.'} />
      ) : (
        <div className="am-coll-list">
          {views.map((v) => (
            <AmListRow
              key={v.id}
              to={v.href || undefined}
              title={v.title}
              detail={[v.date, v.detail].filter(Boolean).join(' · ')}
              trailing={
                <span className="am-coll-trail">
                  <span className="am-coll-amt">{v.amount}</span>
                  <span
                    className={`am-coll-sync${v.synced ? ' am-coll-sync--ok' : v.syncError ? ' am-coll-sync--err' : ''}`}
                    title={v.synced ? 'Synced to QuickBooks' : v.syncError ? 'Sync error' : 'Not synced'}
                  >
                    {v.synced ? '✓ QBO' : v.syncError ? '! QBO' : '— QBO'}
                  </span>
                </span>
              }
            />
          ))}
        </div>
      )}
      <CollFoot>
        {views.length} payment{views.length === 1 ? '' : 's'} · <b>{fmt$2(shownSum)}</b> shown
      </CollFoot>
    </div>
  );
}
