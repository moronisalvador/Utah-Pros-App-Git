/**
 * ════════════════════════════════════════════════
 * FILE: useJobsCompleted.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Jobs completed" card — how many jobs reached a
 *   terminal phase (completed/closed) in the selected period, plus last month.
 * RENDERED BY: Widgets.jsx (JobsCompleted) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext · ./dashUtils
 *   Data: reads → RPC get_jobs_completed (jobs) · writes → none
 * NOTES: Reads ~0 until jobs are actually marked complete (no completion signal
 *   in the data yet — actual_completion is unset). Lights up automatically once
 *   the team starts closing jobs.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { periodBounds } from './dashUtils';

const POLL_MS = 60000;

export function useJobsCompleted(period = 'MTD') {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const { start, end } = periodBounds(period);
      const r = await db.rpc('get_jobs_completed', { p_start: start, p_end: end });
      setState({ data: { count: Number(r?.count) || 0, lastMonth: Number(r?.last_month) || 0 }, loading: false, error: null });
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
