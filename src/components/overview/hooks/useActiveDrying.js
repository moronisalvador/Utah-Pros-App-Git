/**
 * ════════════════════════════════════════════════
 * FILE: useActiveDrying.js — "Active drying" card (one row per job with drying
 *   equipment running: % to dry standard + pull/log-missing flag). Reads RPC
 *   get_active_drying_jobs; carries jobId for deep-links. Empty until Hydro is used.
 *   status: pct≥100 ⇒ ready to pull; reading older than 24h ⇒ log missing.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePolledRpc } from './usePolledRpc';

export function useActiveDrying() {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const raw = await db.rpc('get_active_drying_jobs');
    const list = Array.isArray(raw) ? raw : [];
    const rows = list.map(r => {
      const pct = Number(r.pct) || 0;
      const stale = r.hours_since_reading != null && r.hours_since_reading > 24;
      let status = 'info', badge;
      if (pct >= 100) { status = 'success'; badge = '✓ PULL EQUIP'; }
      else if (stale) { status = 'warning'; badge = '⚠ LOG MISSING'; }
      const loc = [r.city, `Day ${r.day}`].filter(Boolean).join(' · ');
      return { jobId: r.job_id || null, job: r.job, loc, pct, status, badge };
    });
    const ready = rows.filter(r => r.pct >= 100).length;
    const overdue = rows.filter(r => r.status === 'warning').length;
    return {
      rows,
      summary: `${rows.length} active · ${ready} ready to pull`,
      warn: overdue > 0 ? `⚠ ${overdue} log${overdue > 1 ? 's' : ''} overdue` : '',
    };
  }, [db]);
  return usePolledRpc(load, 120000);
}
