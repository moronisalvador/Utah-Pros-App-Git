/**
 * ════════════════════════════════════════════════
 * FILE: clockTime.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Works out, live, how long a tech has been on a job so far — split into travel
 *   time (from "On My Way"), on-site time (from "Start Work"), and the total of the
 *   two. Travel time is real labor cost, so the total is the number that reflects
 *   what a job is actually costing right now. Shared by the office Status Board and
 *   the Overview "Employee status" widget so both agree.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  src/components/StatusBoard.jsx, src/components/overview/hooks/useEmployeeStatus.js
 *
 * DEPENDS ON:
 *   Packages:  none · Internal: none · Data: none (operates on values already fetched)
 *
 * NOTES / GOTCHAS:
 *   - Timer model (see CLAUDE.md): travel_start = OMW, clock_in = Start Work.
 *     travel freezes at clock_in once on site; on-site accrues from clock_in and
 *     stops at paused_at while paused. total_paused_minutes is completed pauses only
 *     (the in-progress pause isn't counted until resume) — that's why on-site is
 *     measured to paused_at, not now, while paused.
 *   - Pass the row/entry shape { travel_start, clock_in, paused_at, total_paused_minutes }.
 *     Returns minutes (numbers), not formatted — call fmtMins() for display.
 * ════════════════════════════════════════════════
 */

// Live travel / on-site / total minutes for an open time entry (or board row).
export function liveClockMinutes(e, now = Date.now()) {
  if (!e || !e.travel_start) return { travel: 0, onSite: 0, total: 0 };
  const ts = new Date(e.travel_start).getTime();
  const ci = e.clock_in ? new Date(e.clock_in).getTime() : null;
  const pausedAt = e.paused_at ? new Date(e.paused_at).getTime() : null;
  const pausedMin = Number(e.total_paused_minutes || 0);

  // Travel: ongoing until they Start Work, then frozen at clock_in.
  const travelEnd = ci != null ? ci : now;
  const travel = Math.max(0, (travelEnd - ts) / 60000);

  // On-site: from clock_in to (paused_at while paused, else now), minus completed pauses.
  let onSite = 0;
  if (ci != null) {
    const siteEnd = pausedAt != null ? pausedAt : now;
    onSite = Math.max(0, (siteEnd - ci) / 60000 - pausedMin);
  }

  return { travel, onSite, total: travel + onSite };
}

// Minutes → compact label: "45m", "2h 5m", "1d 3h".
export function fmtMins(min) {
  if (min == null || min < 0) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}
