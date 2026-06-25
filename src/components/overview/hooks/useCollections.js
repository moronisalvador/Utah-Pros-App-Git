/**
 * ════════════════════════════════════════════════
 * FILE: useCollections.js — "Collections" card data (A/R bucketed into Past due /
 *   Due / Unsent + an average-days-outstanding DSO). Reads RPC get_ar_invoices;
 *   bucketing mirrors src/components/collections/ARDashboard.jsx.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePolledRpc } from './usePolledRpc';

const DAY = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

function fmtMoney(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function useCollections(enabled = true) {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const rows = await db.rpc('get_ar_invoices');
    const list = Array.isArray(rows) ? rows : [];
    const today = startOfDay(Date.now());

    let pastDue = 0, due = 0, unsent = 0, ageSum = 0, ageCount = 0;
    for (const r of list) {
      const bal = Number(r.balance) || 0;
      if (bal <= 0) continue; // paid / nothing owed → not in A/R
      const sent = !!r.sent_at || !!r.qbo_invoice_id;
      const isDraft = r.status === 'draft' || !sent;
      if (isDraft) {
        unsent += bal;
      } else {
        const dueTs = r.due_date ? startOfDay(`${r.due_date}T00:00:00`) : null;
        if (dueTs != null && dueTs < today) pastDue += bal; else due += bal;
      }
      if (r.invoice_date) { ageSum += Math.max(0, (today - startOfDay(`${r.invoice_date}T00:00:00`)) / DAY); ageCount++; }
    }

    const bars = [
      { label: 'Past due', value: fmtMoney(pastDue), amount: pastDue, kind: 'danger' },
      { label: 'Due',      value: fmtMoney(due),     amount: due,     kind: 'warning' },
      { label: 'Unsent',   value: fmtMoney(unsent),  amount: unsent,  kind: 'gray' },
    ];
    const dso = ageCount > 0 ? Math.round(ageSum / ageCount) : 0;
    return { bars, dso };
  }, [db]);
  return usePolledRpc(load, 60000, enabled);
}
