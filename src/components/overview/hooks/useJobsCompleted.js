/**
 * ════════════════════════════════════════════════
 * FILE: useJobsCompleted.js — "Jobs completed" card data (terminal-phase job count
 *   for the period + last month). Reads RPC get_jobs_completed. Reads ~0 until
 *   jobs are actually marked complete; lights up automatically once they are.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { periodBounds } from './dashUtils';
import { usePolledRpc } from './usePolledRpc';

export function useJobsCompleted(period = 'MTD') {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const { start, end } = periodBounds(period);
    const r = await db.rpc('get_jobs_completed', { p_start: start, p_end: end });
    return { count: Number(r?.count) || 0, lastMonth: Number(r?.last_month) || 0 };
  }, [db, period]);
  return usePolledRpc(load);
}
