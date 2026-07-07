/**
 * ════════════════════════════════════════════════
 * FILE: InvoicesTab.jsx  (admin-mobile Collections — Invoices tab)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Invoices" tab of the mobile Collections screen — every invoice (open,
 *   paid, or draft) in one searchable list scoped to the chosen time window,
 *   newest first. Each row shows the customer, the invoice/claim reference, the
 *   balance, and a status word; tapping a row opens that invoice.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/collections (the "Invoices" tab)
 *   Rendered by:  src/pages/tech/admin/AdminCollections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/admin-mobile (AmListRow),
 *              @/components/TabLoading, ./collFormat, ./collUi
 *   Data:      reads → get_ar_invoices() · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Reuses get_ar_invoices() (same RPC as the AR tab) so amounts/status always
 *     agree; this tab shows ALL invoices in the period, the AR tab shows only open.
 *   - The period switch filters by invoice date (undated drafts always show).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AmListRow } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import { invoiceRowView, byCreatedDesc, inPeriod, midnight, fmt$ } from './collFormat';
import { StatusChip, CollSearch, CollEmpty, CollFoot } from './collUi';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

export default function InvoicesTab({ period = 'mtd' }) {
  const { db } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
  const { views, billed } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inWindow = rows.filter((r) => inPeriod(r.invoice_date || r.sent_at, period)).sort(byCreatedDesc);
    const list = inWindow.map((r) => invoiceRowView(r, today)).filter((v) => !q || v.search.includes(q));
    const ids = new Set(list.map((v) => v.id));
    const sum = inWindow.filter((r) => ids.has(r.invoice_id)).reduce((a, r) => a + Number(r.total || 0), 0);
    return { views: list, billed: sum };
  }, [rows, search, period, today]);

  if (loading) return <TabLoading />;

  return (
    <div className="am-coll">
      <CollSearch value={search} onChange={setSearch} placeholder="Search customer, claim, invoice…" />
      {views.length === 0 ? (
        <CollEmpty title="No invoices" sub="Try a different period or search term." />
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
                  <StatusChip kind={v.status} />
                </span>
              }
            />
          ))}
        </div>
      )}
      <CollFoot>
        {views.length} invoice{views.length === 1 ? '' : 's'} · <b>{fmt$(billed)}</b> billed
      </CollFoot>
    </div>
  );
}
