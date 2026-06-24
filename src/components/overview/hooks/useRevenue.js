/**
 * ════════════════════════════════════════════════
 * FILE: useRevenue.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Revenue recognized" card — total billed revenue for
 *   the selected period, split by division, plus an up/down vs the prior period.
 * RENDERED BY: Widgets.jsx (RevenueRecognized) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext · ../tokens · ./dashUtils
 *   Data: reads → RPC get_revenue_by_division (invoices + jobs) · writes → none
 * NOTES: delta is null when there's no prior-period revenue (widget hides the pill).
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { DIVISIONS } from '../tokens';
import { periodBounds, fmtK, fmtFull } from './dashUtils';

const POLL_MS = 60000;

export function useRevenue(period = 'MTD') {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const { start, end } = periodBounds(period);
      const r = await db.rpc('get_revenue_by_division', { p_start: start, p_end: end });
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
      setState({ data: { total: fmtFull(total), delta, segments }, loading: false, error: null });
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
