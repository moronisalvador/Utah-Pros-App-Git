/**
 * ════════════════════════════════════════════════
 * FILE: useJobsClosed.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Feeds the "New Jobs Closed" box on the Overview dashboard. It counts how many
 *   jobs were actually SOLD in the chosen period (this month, last 30 days, etc.),
 *   draws the little 30-day trend line, and works out whether sales are up or down
 *   versus the previous 30 days. It does NOT count estimates that are still just
 *   quotes — only real sales.
 *
 * WHAT COUNTS AS A SALE (the one canonical rule — see the get_jobs_closed RPC):
 *   A job is "sold" when EITHER its estimate was converted to an invoice, OR it has
 *   a signed work authorization / reconstruction agreement. The sale date is the
 *   earliest of those events. All of that logic lives in the database view
 *   `job_sales`; this file just reads the count back per period.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (hook)
 *   Rendered by:  src/pages/Dashboard.jsx → NewJobsClosed card
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), ./usePolledRpc
 *   Data:      reads  → get_jobs_closed() RPC (which reads job_sales → estimates,
 *                       sign_requests, jobs)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Floors the query to ~400 days so it never rescans all-time history.
 *   - projected $ stays null (no projected-value line for sold jobs); the card
 *     hides that line when projected is falsy.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePolledRpc } from './usePolledRpc';

const DAY = 86400000;
const SPARK_DAYS = 30;
const VB_W = 234; // sparkline drawable width (viewBox 0 0 240 58)

function periodStartTs(period, now) {
  const d = new Date(now);
  if (period === 'QTD') return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime();
  if (period === 'YTD') return new Date(d.getFullYear(), 0, 1).getTime();
  if (period === 'Last 30') return now - 30 * DAY;
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); // MTD
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
    const y = +(50 - (c / max) * 43).toFixed(1);
    return `${x},${y}`;
  });
  const line = pts.join(' ');
  return { line, area: `${line} ${VB_W},58 0,58` };
}

export function useJobsClosed(period = 'MTD') {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const now = Date.now();
    const floor = new Date(now - 400 * DAY).toISOString().slice(0, 10);
    const rows = await db.rpc('get_jobs_closed', { p_floor: floor });
    const times = (rows || []).map(r => r.sale_date && new Date(r.sale_date).getTime()).filter(Boolean);

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
    return { count, projected: null, delta, line, area };
  }, [db, period]);
  return usePolledRpc(load);
}
