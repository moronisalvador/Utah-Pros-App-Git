/**
 * ════════════════════════════════════════════════
 * FILE: usePaymentsReceived.js — "Payments received" card data (cash collected by
 *   payment_date for the period + vs prior period, split by division). Reads RPC
 *   get_payments_received. Independent of invoice_date, so it stays correct after
 *   the "sales by loss date" invoice re-dating. delta is null when there's no
 *   prior-period cash (widget hides the pill).
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIVISIONS } from '../tokens';
import { periodBounds, fmtK, fmtFull } from './dashUtils';
import { usePolledRpc } from './usePolledRpc';

export function usePaymentsReceived(period = 'MTD', enabled = true) {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const { start, end } = periodBounds(period);
    const r = await db.rpc('get_payments_received', { p_start: start, p_end: end });
    const total = Number(r?.total) || 0;
    const prev = Number(r?.prev_total) || 0;
    const byKey = Object.fromEntries((r?.segments || []).map(s => [s.key, Number(s.value) || 0]));
    const segments = DIVISIONS.map(d => {
      const value = byKey[d.key] || 0;
      return { key: d.key, label: d.label, value: fmtK(value), pct: total > 0 ? (value / total) * 100 : 0, color: d.color };
    });
    let delta = null;
    if (prev > 0) {
      const pct = Math.round(((total - prev) / prev) * 100);
      delta = { dir: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct) };
    }
    return { total: fmtFull(total), delta, segments };
  }, [db, period]);
  return usePolledRpc(load, 60000, enabled);
}
