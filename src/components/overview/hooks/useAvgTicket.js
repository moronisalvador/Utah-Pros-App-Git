/**
 * ════════════════════════════════════════════════
 * FILE: useAvgTicket.js — "Avg ticket" card data (avg invoice per division for the
 *   period + avg total per claim/loss). Reads RPC get_avg_ticket.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIVISIONS } from '../tokens';
import { periodBounds, fmtK } from './dashUtils';
import { usePolledRpc } from './usePolledRpc';

export function useAvgTicket(period = 'MTD', enabled = true) {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const { start, end } = periodBounds(period);
    const r = await db.rpc('get_avg_ticket', { p_start: start, p_end: end });
    const byKey = Object.fromEntries((r?.divisions || []).map(s => [s.key, Number(s.avg) || 0]));
    const max = Math.max(...DIVISIONS.map(d => byKey[d.key] || 0), 1);
    const bars = DIVISIONS.map(d => {
      const avg = byKey[d.key] || 0;
      return { label: d.label, value: fmtK(avg), pct: max > 0 ? (avg / max) * 100 : 0, color: d.color };
    });
    return { bars, avgClaim: fmtK(Number(r?.avg_per_claim) || 0) };
  }, [db, period]);
  return usePolledRpc(load, 60000, enabled);
}
