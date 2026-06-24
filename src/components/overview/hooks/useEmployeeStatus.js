/**
 * ════════════════════════════════════════════════
 * FILE: useEmployeeStatus.js — live "Employee status" clock-in board. Reads RPC
 *   get_tech_status_board (30s poll). Collapses the board's 5 statuses to 3 dots
 *   (green clocked-in / gray off / red likely-forgot-to-clock-out ≥10h), pins
 *   clocked-in techs on top, and carries jobId so rows deep-link to /jobs/:id.
 *   Elapsed is recomputed each poll (no separate ticker needed).
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePolledRpc } from './usePolledRpc';

const ACTIVE = new Set(['on_site', 'omw', 'paused']);
const FORGOT_CLOCKOUT_MIN = 10 * 60; // ≥10h on the clock ⇒ probably forgot to clock out

const firstName = (full) => (full || '').trim().split(/\s+/)[0] || '—';

function cityOf(addr) {
  if (!addr) return '';
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\s+(UT|UTAH)\b.*$/i, '').trim();
  return '';
}

function timeOfDay(ts) {
  if (!ts) return '';
  const s = new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return s.replace(/\s?AM$/i, 'a').replace(/\s?PM$/i, 'p');
}

function fmtElapsed(min) {
  if (min == null || min < 0) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

function mapRow(r, now) {
  const active = ACTIVE.has(r.status);
  const name = firstName(r.full_name);
  if (!active) {
    return { jobId: null, name, dot: 'gray', detail: 'Not on a job', elapsed: '—', status: 'Not clocked in', statusKind: 'muted', _sort: 1 };
  }
  const elapsedMin = r.status_since ? Math.max(0, (now - new Date(r.status_since).getTime()) / 60000) : null;
  const forgot = elapsedMin != null && elapsedMin >= FORGOT_CLOCKOUT_MIN;
  if (forgot) {
    // Still clocked in (just stale) → group with the clocked-in rows on top (_sort 0).
    return { jobId: r.job_id || null, name, dot: 'danger', job: r.job_number, detailWarn: '⚠ likely forgot to clock out', elapsed: fmtElapsed(elapsedMin), status: 'Check clock-out', statusKind: 'danger', escal: true, _sort: 0 };
  }
  const detail = [cityOf(r.address), `since ${timeOfDay(r.status_since)}`].filter(Boolean).join(' · ');
  return { jobId: r.job_id || null, name, dot: 'success', job: r.job_number, detail, elapsed: fmtElapsed(elapsedMin), status: 'Clocked in', statusKind: 'success', _sort: 0 };
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
