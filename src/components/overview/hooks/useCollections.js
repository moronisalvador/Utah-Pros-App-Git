/**
 * ════════════════════════════════════════════════
 * FILE: useCollections.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Feeds the Overview dashboard's "Collections" card. It pulls the list of
 *   invoices (the same A/R query the Collections page uses), then sorts the
 *   money owed into three buckets — Past due, Due (sent, not yet late), and
 *   Unsent (still a draft) — and works out a rough "days outstanding" number.
 *   Refreshes every 60 seconds.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data hook)
 *   Rendered by:  src/components/overview/Widgets.jsx (Collections) via Dashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads  → RPC get_ar_invoices() (invoices + jobs + claims + contacts)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Bucketing mirrors src/components/collections/ARDashboard.jsx: balance>0 &
 *     overdue → Past due; balance>0 & sent & not overdue → Due; draft / never
 *     sent → Unsent; balance 0 → paid (excluded).
 *   - DSO here = average age (today − invoice_date) of invoices with an open
 *     balance — an approximation that reads cleanly for a small shop. Revisit
 *     with a proper credit-sales DSO once there's more invoice history.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const POLL_MS = 60000;
const DAY = 86400000;

function fmtMoney(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

export function useCollections() {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const rows = await db.rpc('get_ar_invoices');
      const list = Array.isArray(rows) ? rows : [];
      const today = startOfDay(Date.now());

      let pastDue = 0, due = 0, unsent = 0;
      let ageSum = 0, ageCount = 0;

      for (const r of list) {
        const bal = Number(r.balance) || 0;
        if (bal <= 0) continue; // paid / nothing owed → not in A/R

        const sent = !!r.sent_at || !!r.qbo_invoice_id;
        const isDraft = r.status === 'draft' || !sent;

        if (isDraft) {
          unsent += bal;
        } else {
          const dueTs = r.due_date ? startOfDay(`${r.due_date}T00:00:00`) : null;
          if (dueTs != null && dueTs < today) pastDue += bal;
          else due += bal;
        }

        if (r.invoice_date) { ageSum += Math.max(0, (today - startOfDay(`${r.invoice_date}T00:00:00`)) / DAY); ageCount++; }
      }

      const bars = [
        { label: 'Past due', value: fmtMoney(pastDue), amount: pastDue, kind: 'danger' },
        { label: 'Due',      value: fmtMoney(due),     amount: due,     kind: 'warning' },
        { label: 'Unsent',   value: fmtMoney(unsent),  amount: unsent,  kind: 'gray' },
      ];
      const dso = ageCount > 0 ? Math.round(ageSum / ageCount) : 0;

      setState({ data: { bars, dso }, loading: false, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e }));
    }
  }, [db]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return state;
}
