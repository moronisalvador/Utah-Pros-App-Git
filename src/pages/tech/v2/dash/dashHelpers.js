/**
 * ════════════════════════════════════════════════
 * FILE: dashHelpers.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small, pure helper functions for the v2 tech dashboard. They turn the raw
 *   data from the get_tech_dashboard feed into the exact shapes the screen needs:
 *   a readable hours string (like "2h 30m"), the labeled travel + on-site + total
 *   breakdown, and the grouping of today's visits into active / scheduled /
 *   completed. It also decides which single appointment the "Now / Next" hero
 *   should show, reusing the shared pickNowNext rule. Keeping this logic here (and
 *   free of React) is what lets it be unit-tested without a browser or database.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module for Session D's dashboard)
 *   Rendered by:  n/a — imported by TechDashV2 and its dash/** subcomponents
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/components/tech/NowNextTile (frozen pickNowNext)
 *   Data:      none (operates on data already fetched by get_tech_dashboard)
 *
 * NOTES / GOTCHAS:
 *   - pickNowNext is FROZEN (Foundation-owned). We adapt the feed's payload to
 *     the shape it expects (crew[] + job_number) rather than touching it.
 *   - splitToday deliberately drops cancelled visits into no bucket (the RPC
 *     already excludes them; this is the client-side belt-and-suspenders for
 *     Finding 6).
 * ════════════════════════════════════════════════
 */
import { pickNowNext } from '@/components/tech/NowNextTile';

// ─── SECTION: Helpers ──────────────

/**
 * Decimal hours → a compact human string. 0 → "0h", 1 → "1h", 2.5 → "2h 30m",
 * 0.5 → "30m". Minutes are rounded to the nearest whole. Safe on null/NaN.
 * @param {number|null|undefined} h
 * @returns {string}
 */
export function fmtHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return '0h';
  const totalMin = Math.round(n * 60);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/**
 * A get_tech_dashboard hours bucket ({ travel, on_site, total }) → the labeled
 * three-part breakdown the UI renders. Never a bare number (tech-mobile-ux).
 * @param {{ travel?: number, on_site?: number, total?: number }|null} bucket
 * @returns {{ label: string, value: string }[]}
 */
export function hoursBreakdown(bucket) {
  const b = bucket || {};
  return [
    { label: 'Travel', value: fmtHours(b.travel) },
    { label: 'On-site', value: fmtHours(b.on_site) },
    { label: 'Total', value: fmtHours(b.total) },
  ];
}

/**
 * Adapt one get_tech_dashboard appointment to the shape pickNowNext expects:
 * a flat crew[] of { employee_id, full_name } and a top-level job_number. All
 * other fields (jobs, appointment_crew, status, …) are preserved so the hero can
 * still mount TimeTracker off the returned row.
 * @param {object} a
 * @returns {object}
 */
export function toPickShape(a) {
  const crew = (a.appointment_crew || []).map((c) => ({
    employee_id: c.employee_id,
    full_name: c.employees?.display_name || c.employees?.full_name || '',
  }));
  return { ...a, crew, job_number: a.jobs?.job_number || a.job_number || null };
}

/**
 * Decide the single appointment the "Now / Next" hero shows, across today +
 * upcoming. Returns { ctxType, appt } (appt is the full payload row) or null.
 * @param {{ appointments?: object[], upcoming?: object[] }} payload
 * @param {string} employeeId
 * @returns {{ ctxType: string, appt: object }|null}
 */
export function selectHero(payload, employeeId) {
  const today = payload?.appointments || [];
  const upcoming = payload?.upcoming || [];
  const shaped = [...today, ...upcoming].map(toPickShape);
  return pickNowNext(shaped, employeeId);
}

/**
 * Group today's visits for the timeline + sections. Active = en_route /
 * in_progress / paused; scheduled = scheduled / confirmed; completed = completed.
 * Cancelled rows land in NO bucket (Finding 6 belt-and-suspenders).
 * @param {object[]} appointments
 * @returns {{ active: object[], scheduled: object[], completed: object[] }}
 */
export function splitToday(appointments) {
  const list = appointments || [];
  const ACTIVE = ['en_route', 'in_progress', 'paused'];
  const SCHEDULED = ['scheduled', 'confirmed'];
  return {
    active: list.filter((a) => ACTIVE.includes(a.status)),
    scheduled: list.filter((a) => SCHEDULED.includes(a.status)),
    completed: list.filter((a) => a.status === 'completed'),
  };
}
