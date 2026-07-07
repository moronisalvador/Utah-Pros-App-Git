/**
 * ════════════════════════════════════════════════
 * FILE: EstimatesTab.jsx  (admin-mobile Collections — Estimates tab)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Estimates" tab of the mobile Collections screen — the pre-sale quote
 *   pipeline. A searchable list of estimates, newest first, each showing the
 *   customer, reference, amount, and where it stands (Draft → Sent → Converted).
 *   Tapping a row opens that estimate.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/collections (the "Estimates" tab)
 *   Rendered by:  src/pages/tech/admin/AdminCollections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/admin-mobile (AmListRow),
 *              @/components/TabLoading, ./collFormat, ./collUi
 *   Data:      reads → get_estimates() · writes → none
 *
 * NOTES / GOTCHAS:
 *   - No period switch here (matches the desktop Estimates tab) — just search +
 *     the status chip on each row.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AmListRow } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import { estimateRowView, byCreatedDesc, fmt$ } from './collFormat';
import { StatusChip, CollSearch, CollEmpty, CollFoot } from './collUi';

const toast = (m, t = 'error') => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: m, type: t } }));

export default function EstimatesTab() {
  const { db } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const dbRef = useRef(db);
  dbRef.current = db;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dbRef.current.rpc('get_estimates');
      setRows(data || []);
    } catch (e) {
      toast('Failed to load estimates: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { views, openValue, openCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort(byCreatedDesc);
    const list = sorted.map(estimateRowView).filter((v) => !q || v.search.includes(q));
    const open = rows.filter((r) => !r.converted_invoice_id);
    return {
      views: list,
      openValue: open.reduce((a, r) => a + Number(r.amount || 0), 0),
      openCount: open.length,
    };
  }, [rows, search]);

  if (loading) return <TabLoading />;

  return (
    <div className="am-coll">
      <CollSearch value={search} onChange={setSearch} placeholder="Search customer, claim, estimate…" />
      {views.length === 0 ? (
        <CollEmpty title="No estimates" sub={rows.length === 0 ? 'Estimates appear here as they are created.' : 'Try a different search term.'} />
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
                  <StatusChip kind={v.status} estimate />
                </span>
              }
            />
          ))}
        </div>
      )}
      <CollFoot>
        {openCount} open · <b>{fmt$(openValue)}</b> potential
      </CollFoot>
    </div>
  );
}
