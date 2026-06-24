/**
 * ════════════════════════════════════════════════
 * FILE: useEmployeeStatus.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Feeds the Overview dashboard's live "Employee status" board. It asks the
 *   database who's clocked in right now (via the same get_tech_status_board the
 *   Time-Tracking page uses), refreshes every 30 seconds, works out how long
 *   each person has been on the clock, and flags anyone who's been "on" so long
 *   they probably forgot to clock out. It hands the widget a ready-to-draw list
 *   plus a one-line summary.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data hook)
 *   Rendered by:  src/components/overview/Widgets.jsx (EmployeeStatus) via Dashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads  → RPC get_tech_status_board() (job_time_entries, appointments,
 *                       appointment_crew, employees, jobs)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - get_tech_status_board() statuses: on_site | omw | paused | scheduled | idle.
 *     The dashboard board collapses these to 3 dots: green (clocked in), gray
 *     (not clocked in), red (likely forgot to clock out).
 *   - "Forgot to clock out" = clocked in (on_site/omw/paused) for ≥ 10h. Threshold
 *     is a heuristic; adjust FORGOT_CLOCKOUT_MIN if the office wants it tighter.
 *   - 30s poll mirrors StatusBoard.jsx; elapsed labels recompute each poll.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ─── SECTION: Helpers ──────────────
const ACTIVE = new Set(['on_site', 'omw', 'paused']);
const FORGOT_CLOCKOUT_MIN = 10 * 60; // 10h on the clock ⇒ probably forgot to clock out
const POLL_MS = 30000;

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

// Map one get_tech_status_board row → the shape EmployeeStatus expects.
function mapRow(r, now) {
  const active = ACTIVE.has(r.status);
  const name = firstName(r.full_name);

  if (!active) {
    return { name, dot: 'gray', detail: 'Not on a job', elapsed: '—', status: 'Not clocked in', statusKind: 'muted', _sort: 1 };
  }

  const elapsedMin = r.status_since ? Math.max(0, (now - new Date(r.status_since).getTime()) / 60000) : null;
  const forgot = elapsedMin != null && elapsedMin >= FORGOT_CLOCKOUT_MIN;

  if (forgot) {
    // Still clocked in (just stale) → group with the clocked-in rows on top (_sort 0).
    return { name, dot: 'danger', job: r.job_number, detailWarn: '⚠ likely forgot to clock out', elapsed: fmtElapsed(elapsedMin), status: 'Check clock-out', statusKind: 'danger', escal: true, _sort: 0 };
  }

  const detail = [cityOf(r.address), `since ${timeOfDay(r.status_since)}`].filter(Boolean).join(' · ');
  return { name, dot: 'success', job: r.job_number, detail, elapsed: fmtElapsed(elapsedMin), status: 'Clocked in', statusKind: 'success', _sort: 0 };
}

// ─── SECTION: Hook ──────────────
export function useEmployeeStatus() {
  const { db } = useAuth();
  const [rows, setRows] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await db.rpc('get_tech_status_board');
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), POLL_MS);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  const mapped = useMemo(() => {
    if (!rows) return null;
    const list = rows
      .map(r => mapRow(r, now))
      .sort((a, b) => a._sort - b._sort || a.name.localeCompare(b.name));
    const clockedIn = rows.filter(r => ACTIVE.has(r.status)).length;
    const missed = list.filter(x => x.escal).length;
    return {
      data: list,
      summary: {
        left: `${clockedIn} clocked in · ${rows.length - clockedIn} off`,
        warn: missed > 0 ? `⚠ ${missed} missed clock-out` : '',
      },
    };
  }, [rows, now]);

  return { data: mapped?.data ?? null, summary: mapped?.summary ?? null, loading, error };
}
