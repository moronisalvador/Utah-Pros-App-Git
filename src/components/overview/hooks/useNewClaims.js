/**
 * ════════════════════════════════════════════════
 * FILE: useNewClaims.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Feeds the Overview dashboard's "New claims booked" card. It loads when each
 *   claim was created, counts how many fall in the selected period (this month,
 *   last 30 days, this quarter, this year), draws a 30-day trend sparkline, and
 *   compares the last 30 days to the 30 before that for the up/down badge.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data hook)
 *   Rendered by:  src/components/overview/Widgets.jsx (NewClaimsBooked) via Dashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads  → claims (created_at) via db.select
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - All windows are computed inside the async load (re-runs when `period`
 *     changes) — never during render — so the metric stays React-pure.
 *   - "Projected $" is intentionally null: jobs created recently have no
 *     estimated_value yet, so there's no honest dollar figure. The widget hides
 *     that line when projected is null. Wire it once estimated_value lands.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ─── SECTION: Helpers ──────────────
const DAY = 86400000;
const POLL_MS = 60000;
const SPARK_DAYS = 30;
const VB_W = 234; // sparkline drawable width (viewBox is 0 0 240 58)

function periodStartTs(period, now) {
  const d = new Date(now);
  if (period === 'MTD') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (period === 'QTD') return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime();
  if (period === 'YTD') return new Date(d.getFullYear(), 0, 1).getTime();
  return now - 30 * DAY; // 'Last 30'
}

function buildSparkline(times, now) {
  const counts = new Array(SPARK_DAYS).fill(0);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const startTs = start.getTime() - (SPARK_DAYS - 1) * DAY;
  for (const t of times) {
    const idx = Math.floor((t - startTs) / DAY);
    if (idx >= 0 && idx < SPARK_DAYS) counts[idx]++;
  }
  const max = Math.max(...counts, 1);
  const pts = counts.map((c, i) => {
    const x = +((i / (SPARK_DAYS - 1)) * VB_W).toFixed(1);
    const y = +(50 - (c / max) * 43).toFixed(1); // 7 (high) … 50 (low)
    return `${x},${y}`;
  });
  const line = pts.join(' ');
  return { line, area: `${line} ${VB_W},58 0,58` };
}

// ─── SECTION: Hook ──────────────
export function useNewClaims(period = 'MTD') {
  const { db } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const rows = await db.select('claims', 'select=created_at&order=created_at.desc');
      const times = (rows || []).map(r => r.created_at && new Date(r.created_at).getTime()).filter(Boolean);
      const now = Date.now();

      const count = times.filter(t => t >= periodStartTs(period, now)).length;
      const last30 = times.filter(t => t >= now - 30 * DAY).length;
      const prior30 = times.filter(t => t >= now - 60 * DAY && t < now - 30 * DAY).length;

      let delta = null;
      if (prior30 > 0) {
        const pct = Math.round(((last30 - prior30) / prior30) * 100);
        delta = { dir: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct) };
      } else if (last30 > 0) {
        delta = { dir: 'up', pct: 100 };
      }

      const { line, area } = buildSparkline(times, now);
      setState({ data: { count, projected: null, delta, line, area }, loading: false, error: null });
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
