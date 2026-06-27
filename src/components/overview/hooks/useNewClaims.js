/**
 * ════════════════════════════════════════════════
 * FILE: useNewClaims.js — "New claims booked" card data (period count + 30-day
 *   sparkline + 30-vs-30 delta). Counts only claims that have >= 1 REAL job (one
 *   that's authorized/billed — signed work-auth, QBO invoice, or approved estimate),
 *   via the get_real_claims_created RPC; estimate/lead-only claims are excluded and
 *   live in the Open-estimates tile. Floored to ~400 days so it never rescans the
 *   whole table. projected $ stays null until jobs.estimated_value lands.
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

export function useNewClaims(period = 'MTD') {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const now = Date.now();
    const floor = new Date(now - 400 * DAY).toISOString().slice(0, 10);
    // Only count claims that have >= 1 REAL job (authorized/billed) — excludes estimate/lead-only
    // claims. "Real" is set by signed work-auth / QBO invoice / approved estimate (see
    // 20260627_real_job_classification.sql); estimates remain in the Open-estimates tile.
    const rows = await db.rpc('get_real_claims_created', { p_floor: floor });
    const times = (rows || []).map(r => r.created_at && new Date(r.created_at).getTime()).filter(Boolean);

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
