/**
 * ════════════════════════════════════════════════
 * FILE: useEmployeeStatus.js — live "Employee status" clock-in board. Reads RPC
 *   get_tech_status_board (30s poll). Collapses the board's 5 statuses to 3 dots
 *   (green clocked-in / gray off / red likely-forgot-to-clock-out ≥10h), pins
 *   clocked-in techs on top, and surfaces each tech's full name + client + job
 *   address (so the owner sees who is working where, for whom). Carries jobId so
 *   rows deep-link to /jobs/:id. Elapsed shown is the FULL time on the job so far
 *   (travel + on-site — travel is real labor cost), recomputed each poll.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePolledRpc } from './usePolledRpc';
import { liveClockMinutes } from '@/lib/clockTime';

const ACTIVE = new Set(['on_site', 'omw', 'paused']);
const FORGOT_CLOCKOUT_MIN = 10 * 60; // ≥10h on the clock ⇒ probably forgot to clock out

function fmtElapsed(min) {
  if (min == null || min < 0) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

// One board row → the shape the EmployeeStatus widget renders. get_tech_status_board
// already returns full_name, client_name and address (the same fields the Time-Tracking
// StatusBoard uses), so we surface them directly instead of first-name + city only.
function mapRow(r, now) {
  const name = (r.full_name || '').trim() || '—';
  const active = ACTIVE.has(r.status);
  if (!active) {
    return { jobId: null, name, dot: 'gray', client: '', job: '', address: '', detail: 'Not on a job', elapsed: '—', status: 'Not clocked in', statusKind: 'muted', _sort: 1 };
  }
  // Full time on the job so far = travel + on-site (travel is real labor cost).
  const elapsedMin = liveClockMinutes(r, now).total;
  const base = {
    jobId: r.job_id || null, name,
    client: r.client_name || '', job: r.job_number || '', address: r.address || '',
    elapsed: fmtElapsed(elapsedMin),
  };
  if (elapsedMin != null && elapsedMin >= FORGOT_CLOCKOUT_MIN) {
    // Still clocked in (just stale) → group with the clocked-in rows on top (_sort 0).
    return { ...base, dot: 'danger', status: 'Check clock-out', statusKind: 'danger', escal: true, _sort: 0 };
  }
  return { ...base, dot: 'success', status: 'Clocked in', statusKind: 'success', _sort: 0 };
}

export function useEmployeeStatus() {
  const { db } = useAuth();
  const load = useCallback(async () => {
    const rows = await db.rpc('get_tech_status_board');
    const list = Array.isArray(rows) ? rows : [];
    const now = Date.now();
    const mapped = list
      .map(r => mapRow(r, now))
      .sort((a, b) => a._sort - b._sort || a.name.localeCompare(b.name));
    const clockedIn = list.filter(r => ACTIVE.has(r.status)).length;
    const missed = mapped.filter(x => x.escal).length;
    return {
      rows: mapped,
      summary: {
        left: `${clockedIn} clocked in · ${list.length - clockedIn} off`,
        warn: missed > 0 ? `⚠ ${missed} missed clock-out` : '',
      },
    };
  }, [db]);

  const s = usePolledRpc(load, 30000);
  return { data: s.data?.rows ?? null, summary: s.data?.summary ?? null, loading: s.loading, error: s.error, reload: s.reload };
}
