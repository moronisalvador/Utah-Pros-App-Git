/**
 * ════════════════════════════════════════════════
 * FILE: InvoiceActivity.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the history of an invoice — when it was saved to QuickBooks, when it
 *   was emailed, to whom, and who did it. It loads a page at a time, and shows
 *   nothing at all if the history feature is not switched on yet.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/pages/InvoiceEditor.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/components/ui (ErrorState)
 *   Data:      reads → get_invoice_activity RPC (public.invoice_activity)
 *
 * NOTES / GOTCHAS:
 *   - The history starts when the feature ships. Anything sent before that has
 *     no record, and the empty state says so rather than implying nothing
 *     happened.
 *   - "Emailed" means QuickBooks accepted the request, NOT that it reached an
 *     inbox. The copy says so deliberately.
 *   - If the RPC does not exist yet the whole section hides itself, so the page
 *     is unharmed when app code deploys ahead of the migration.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ErrorState from '@/components/ui/ErrorState';
import './invoice-send-review.css';

const PAGE = 20;

// A missing function or a role refusal are both "do not show this section",
// not "something broke". Anything else is a real error worth surfacing.
const isAbsent = (e) => /PGRST202|does not exist|not authorized|42501/i.test(String(e?.message || e));

const LABEL = {
  invoice_sent: 'Emailed to customer',
  invoice_saved_to_quickbooks: 'Saved to QuickBooks',
  send_presentation_changed: 'Message or CC edited',
};

function when(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function InvoiceActivity({ invoiceId }) {
  const { db } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState('loading'); // loading | ready | error | hidden
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(
    (nextOffset) => db.rpc('get_invoice_activity', {
      p_invoice_id: invoiceId, p_limit: PAGE, p_offset: nextOffset,
    }).then((result) => (Array.isArray(result) ? result[0] : result)),
    [db, invoiceId],
  );

  // First page. The `alive` guard is what stops a slow response for a previous
  // invoice from overwriting newer state after a route change (page-lifecycle
  // §2), and keeps the fetch out of a synchronous setState-in-effect.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchPage(0).then((page) => {
      if (!alive) return;
      setRows(page?.rows || []);
      setTotal(Number(page?.total || 0));
      setOffset(0);
      setState('ready');
    }).catch((e) => {
      if (alive) setState(isAbsent(e) ? 'hidden' : 'error');
    });
    return () => { alive = false; };
  }, [fetchPage, reloadKey]);

  const loadMore = async () => {
    setBusy(true);
    try {
      const next = offset + PAGE;
      const page = await fetchPage(next);
      setRows((prev) => [...prev, ...(page?.rows || [])]);
      setTotal(Number(page?.total || 0));
      setOffset(next);
    } catch { /* keep what is already on screen rather than blanking it */ }
    finally { setBusy(false); }
  };

  if (state === 'hidden') return null;
  if (state === 'loading') return null;

  if (state === 'error') {
    return <ErrorState message="Couldn’t load this invoice’s history." onRetry={() => setReloadKey((n) => n + 1)} />;
  }

  const more = rows.length < total;

  return (
    <div>
      {rows.length === 0 ? (
        <div className="inv-activity-empty">
          No recorded history yet. Activity is recorded from the point this feature shipped,
          so earlier sends do not appear here.
        </div>
      ) : (
        <>
          {rows.map((row) => (
            <div key={row.id} className="inv-activity-row">
              <div className="inv-activity-when">{when(row.occurred_at)}</div>
              <div style={{ minWidth: 0 }}>
                <div className="inv-activity-what">
                  {LABEL[row.event_type] || row.event_type}
                  {row.recipient_email ? ` → ${row.recipient_email}` : ''}
                  {row.cc_email ? ` (cc ${row.cc_email})` : ''}
                </div>
                <div className="inv-activity-who">
                  {row.actor_name || (row.actor_kind === 'employee' ? 'A teammate' : 'Automatic')}
                </div>
              </div>
            </div>
          ))}
          {more && (
            <button type="button" className="btn" disabled={busy} onClick={loadMore} style={{ marginTop: 10 }}>
              {busy ? 'Loading…' : `Show older (${total - rows.length} more)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
