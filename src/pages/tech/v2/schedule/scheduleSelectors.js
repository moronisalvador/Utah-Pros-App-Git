/**
 * ════════════════════════════════════════════════
 * FILE: scheduleSelectors.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure "brain" math behind the v2 schedule screen — no React, no database,
 *   no clock. It turns a flat list of appointments into the shapes the calendar
 *   needs: which month a date belongs to, the exact date range to load for a
 *   month, the days in a week, appointments grouped and sorted by day, and the
 *   "just my work / a chosen crew / a division" filters. Keeping this logic here
 *   (instead of tangled inside the screen) means every rule can be unit-tested by
 *   hand and behaves identically to the old schedule page.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (pure helper module)
 *   Rendered by:  n/a — imported by TechScheduleV2 and its sub-views
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/scheduleUtils (fmtDate — the one date→'YYYY-MM-DD' formatter)
 *   Data:      none (operates on already-fetched appointment objects)
 *
 * NOTES / GOTCHAS:
 *   - Every date here is a LOCAL 'YYYY-MM-DD' string. We never `new Date('YYYY-MM-DD')`
 *     (that parses as UTC and shifts the day west of Greenwich). All parsing goes
 *     through `parseLocal` which builds a local-midnight Date, so month/week
 *     bucketing is timezone-safe.
 *   - Division parity: MITIGATION_DIVS matches the LEGACY TechSchedule page
 *     exactly (water/mold/contents — note it excludes 'fire', mirroring the live
 *     page so the filter behaves identically). See tests for the parity contract.
 * ════════════════════════════════════════════════
 */
import { fmtDate } from '@/lib/scheduleUtils';

// ─── SECTION: Helpers ──────────────

/** Zero-pad a number to 2 digits. */
export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse a 'YYYY-MM-DD' string into a LOCAL-midnight Date (never UTC).
 * @param {string} dateStr
 * @returns {Date}
 */
export function parseLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The month a date belongs to, as 'YYYY-MM'. Accepts a 'YYYY-MM-DD' string
 * (cheap slice — the first 7 chars ARE the month key) or a Date.
 * @param {string|Date} date
 * @returns {string}
 */
export function monthKeyOf(date) {
  if (date instanceof Date) return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  return date.slice(0, 7);
}

/**
 * Shift a 'YYYY-MM' month key by a whole number of months.
 * @param {string} monthKey
 * @param {number} delta - e.g. -1 (previous month), +2 (two months ahead)
 * @returns {string}
 */
export function addMonths(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12; // guard negative modulo
  return `${ny}-${pad2(nm + 1)}`;
}

/**
 * The month keys within ±radius of a month, oldest first. radius=1 → 3 keys.
 * @param {string} monthKey
 * @param {number} [radius=1]
 * @returns {string[]}
 */
export function monthKeysAround(monthKey, radius = 1) {
  const keys = [];
  for (let i = -radius; i <= radius; i++) keys.push(addMonths(monthKey, i));
  return keys;
}

/**
 * The inclusive date range covering a whole calendar month.
 * @param {string} monthKey - 'YYYY-MM'
 * @returns {{ start: string, end: string }} both 'YYYY-MM-DD'
 */
export function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  // Day 0 of the NEXT month = last day of THIS month (local, no UTC drift).
  const end = fmtDate(new Date(y, m, 0));
  return { start, end };
}

/**
 * Add n days to a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string. TZ-safe.
 * @param {string} dateStr
 * @param {number} n
 * @returns {string}
 */
export function addDaysStr(dateStr, n) {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/**
 * The start-of-week date (as 'YYYY-MM-DD') for a given date.
 * @param {string} dateStr
 * @param {number} [weekStartsOn=0] - 0 = Sunday (US calendar), 1 = Monday
 * @returns {string}
 */
export function startOfWeekStr(dateStr, weekStartsOn = 0) {
  const d = parseLocal(dateStr);
  const dow = d.getDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return fmtDate(d);
}

/**
 * The 7 date strings of the week that starts at weekStartStr.
 * @param {string} weekStartStr - a start-of-week 'YYYY-MM-DD'
 * @returns {string[]}
 */
export function weekDaysStr(weekStartStr) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(addDaysStr(weekStartStr, i));
  return out;
}

// ─── SECTION: Grouping & sorting ──────────────

/** Sort a copy of appts ascending by time_start ('' sorts first — all-day/no-time). */
export function sortByTime(appts) {
  return [...appts].sort((a, b) => (a.time_start || '').localeCompare(b.time_start || ''));
}

/**
 * Group appointments by their `date` ('YYYY-MM-DD'), each day's list sorted by
 * time. Appointments with no date are dropped (they can't be placed on a day).
 * @param {object[]} appts
 * @returns {Record<string, object[]>}
 */
export function groupByDate(appts) {
  const g = {};
  for (const a of appts) {
    if (!a.date) continue;
    (g[a.date] ||= []).push(a);
  }
  for (const key of Object.keys(g)) g[key] = sortByTime(g[key]);
  return g;
}

/** The date keys of a grouped map, ascending (string sort == chronological for ISO). */
export function sortedDateKeys(grouped) {
  return Object.keys(grouped).sort();
}

/** The set of dates that have at least one appointment (for strip/dot indicators). */
export function apptDateSet(appts) {
  const set = new Set();
  for (const a of appts) if (a.date) set.add(a.date);
  return set;
}

// ─── SECTION: Filter predicates (legacy parity) ──────────────

// Divisions the legacy TechSchedule page treats as "Mitigation". Intentionally
// mirrors the legacy page (excludes 'fire') so the filter is byte-parity — see
// the parity test. Do NOT "fix" this without changing the legacy page too.
export const MITIGATION_DIVS = ['water', 'mold', 'contents'];

/**
 * Does an appointment pass the crew/employee filter?
 * @param {object} appt
 * @param {'me'|'all'|string[]} filter - 'me', 'all', or an array of employee ids
 * @param {string} myId - the current employee's id (for 'me')
 * @returns {boolean}
 */
export function matchesEmployeeFilter(appt, filter, myId) {
  if (filter === 'all') return true;
  const crew = appt.appointment_crew || [];
  if (filter === 'me') return crew.some((c) => c.employee_id === myId);
  if (Array.isArray(filter)) return crew.some((c) => filter.includes(c.employee_id));
  return true;
}

/**
 * Does an appointment pass the division filter?
 * @param {object} appt
 * @param {'all'|'mitigation'|'reconstruction'} division
 * @returns {boolean}
 */
export function matchesDivisionFilter(appt, division) {
  if (division === 'mitigation') return MITIGATION_DIVS.includes(appt.jobs?.division);
  if (division === 'reconstruction') return appt.jobs?.division === 'reconstruction';
  return true; // 'all'
}

/**
 * Apply the employee + division filters (NOT search — that's a separate pass so
 * the crew list + date dots reflect the filtered-but-unsearched set, exactly
 * like the legacy page).
 * @param {object[]} appts
 * @param {{ employee: ('me'|'all'|string[]), division: string, myId: string }} opts
 * @returns {object[]}
 */
export function filterAppointments(appts, { employee, division, myId }) {
  return appts.filter(
    (a) => matchesEmployeeFilter(a, employee, myId) && matchesDivisionFilter(a, division),
  );
}

/**
 * Free-text search across title + job name/address/city/number (case-insensitive).
 * Empty/blank query returns the list unchanged. Matches the legacy fields exactly.
 * @param {object[]} appts
 * @param {string} query
 * @returns {object[]}
 */
export function searchAppointments(appts, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return appts;
  return appts.filter((a) => {
    const job = a.jobs;
    return (
      (a.title || '').toLowerCase().includes(q) ||
      (job?.insured_name || '').toLowerCase().includes(q) ||
      (job?.address || '').toLowerCase().includes(q) ||
      (job?.city || '').toLowerCase().includes(q) ||
      (job?.job_number || '').toLowerCase().includes(q)
    );
  });
}
