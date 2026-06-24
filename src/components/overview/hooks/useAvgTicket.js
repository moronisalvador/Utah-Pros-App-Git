/**
 * ════════════════════════════════════════════════
 * FILE: useAvgTicket.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Avg ticket" card — average invoice per division for
 *   the period, plus the average total per claim/loss (all jobs under a claim).
 * RENDERED BY: Widgets.jsx (AvgTicket) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext · ../tokens · ./dashUtils
 *   Data: reads → RPC get_avg_ticket (invoices + jobs) · writes → none
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIVISIONS } from '../tokens';
import { periodBounds, fmtK } from './dashUtils';

const POLL_MS = 60000;

export function useAvgTicket(period = 'MTD') {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const { start, end } = periodBounds(period);
      const r = await db.rpc('get_avg_ticket', { p_start: start, p_end: end });
      const byKey = Object.fromEntries((r?.divisions || []).map(s => [s.key, Number(s.avg) || 0]));
      const max = Math.max(...DIVISIONS.map(d => byKey[d.key] || 0), 1);
      const bars = DIVISIONS.map(d => {
        const avg = byKey[d.key] || 0;
        return { label: d.label, value: fmtK(avg), pct: max > 0 ? (avg / max) * 100 : 0, color: d.color };
      });
      setState({ data: { bars, avgClaim: fmtK(Number(r?.avg_per_claim) || 0) }, loading: false, error: null });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e }));
    }
  }, [db, period]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return state;
}
