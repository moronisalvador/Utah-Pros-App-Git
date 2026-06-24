/**
 * ════════════════════════════════════════════════
 * FILE: useActiveDrying.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES: Feeds the "Active drying" card — one row per job that has drying
 *   equipment running, showing % to dry standard and a pull-equipment / log-missing
 *   flag. Empty until techs use the moisture-logging (Hydro) feature.
 * RENDERED BY: Widgets.jsx (ActiveDrying) via Dashboard.jsx
 * DEPENDS ON: react · @/contexts/AuthContext
 *   Data: reads → RPC get_active_drying_jobs (equipment_placements + moisture_readings + jobs) · writes → none
 * NOTES: status — pct≥100 ⇒ ready to pull; reading older than 24h ⇒ log missing.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const POLL_MS = 120000;

export function useActiveDrying() {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const raw = await db.rpc('get_active_drying_jobs');
      const list = Array.isArray(raw) ? raw : [];
      const rows = list.map(r => {
        const pct = Number(r.pct) || 0;
        const stale = r.hours_since_reading != null && r.hours_since_reading > 24;
        let status = 'info', badge;
        if (pct >= 100) { status = 'success'; badge = '✓ PULL EQUIP'; }
        else if (stale) { status = 'warning'; badge = '⚠ LOG MISSING'; }
        const loc = [r.city, `Day ${r.day}`].filter(Boolean).join(' · ');
        return { job: r.job, loc, pct, status, badge };
      });
      const ready = rows.filter(r => r.pct >= 100).length;
      const overdue = rows.filter(r => r.status === 'warning').length;
      setState({
        data: {
          rows,
          summary: `${rows.length} active · ${ready} ready to pull`,
          warn: overdue > 0 ? `⚠ ${overdue} log${overdue > 1 ? 's' : ''} overdue` : '',
        },
        loading: false,
        error: null,
      });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e }));
    }
  }, [db]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return state;
}
