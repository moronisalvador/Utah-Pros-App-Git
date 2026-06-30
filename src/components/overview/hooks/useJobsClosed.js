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
 *   quotes — only real (sold) jobs.
 *
 * WHAT COUNTS AS A SOLD JOB (one canonical rule — see get_jobs_closed RPC):
 *   A job is "real / sold" when a Work Authorization or Reconstruction Agreement is
 *   signed, a QBO invoice is created, or its estimate is approved — captured by the
 *   jobs.is_real_job flag (20260627_real_job_classification.sql, also used by billing).
 *   The sale date is jobs.real_job_marked_at (when it became real). get_jobs_closed
 *   returns one row per real job since a floor date; this file counts them per period.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (hook)
 *   Rendered by:  src/pages/Dashboard.jsx → NewJobsClosed card
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), ./usePolledRpc
 *   Data:      reads  → get_jobs_closed() RPC (reads jobs.is_real_job / real_job_marked_at)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Floors the query to ~400 days so it never rescans all-time history.
 *   - Counts JOBS, not claims — mitigation & reconstruction on one claim count
 *     separately (each is its own sold job).
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

// Returns the [startTs, endTs) window for the selected period. Every period
// except "Prev mo" runs through `now`; "Prev mo" is a bounded prior calendar month.
function periodRange(period, now) {
  const d = new Date(now);
  if (period === 'Prev mo') {
    return {
      startTs: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
      endTs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), // 1st of this month (exclusive)
    };
  }
  if (period === 'QTD') return { startTs: new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime(), endTs: now };
  if (period === 'YTD') return { startTs: new Date(d.getFullYear(), 0, 1).getTime(), endTs: now };
  if (period === 'Last 30') return { startTs: now - 30 * DAY, endTs: now };
  return { startTs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), endTs: now }; // MTD
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
    // Count REAL (sold) jobs — jobs.is_real_job set by signed work-auth / QBO invoice /
    // approved estimate (20260627_real_job_classification.sql). Dated by real_job_marked_at.
    const rows = await db.rpc('get_jobs_closed', { p_floor: floor });
    const times = (rows || []).map(r => r.sale_date && new Date(r.sale_date).getTime()).filter(Boolean);

    const { startTs, endTs } = periodRange(period, now);
    const count = times.filter(t => t >= startTs && t < endTs).length;
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
