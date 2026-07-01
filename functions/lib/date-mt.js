/**
 * ════════════════════════════════════════════════
 * FILE: date-mt.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers "what day was yesterday, and has it been N days" using Utah's
 *   actual calendar day (Mountain Time), not the server's UTC day. Everything
 *   in the database is stored in UTC, but the business's day boundary is
 *   Denver's midnight — so a naive UTC calculation can attribute ad spend to
 *   the wrong day or call a lead "stale" a day early/late. This file is the
 *   one place that math happens, per docs/crm-roadmap.md's "pick one timezone
 *   convention, once" rule.
 *
 * DEPENDS ON:
 *   Packages:  none — pure functions, only the platform Intl/Date APIs
 *   Internal:  none
 *
 * NOTES / GOTCHAS:
 *   - Uses Intl.DateTimeFormat with timeZone 'America/Denver' to read the
 *     wall-clock calendar date, so DST transitions (MST/MDT) are handled by
 *     the platform's tz database, never hand-rolled.
 *   - Both functions take the "now" instant as an explicit parameter rather
 *     than calling `new Date()` internally — keeps them pure and unit-testable,
 *     and matches the mirrored SQL usage in ad-spend workers where the cron's
 *     own timestamp is threaded through.
 * ════════════════════════════════════════════════
 */

const TIMEZONE = 'America/Denver';

// Returns the MT calendar date for a given UTC instant as [year, monthIndex, day].
function mtDateParts(utcInstant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utcInstant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return [get('year'), get('month') - 1, get('day')];
}

// The Mountain-Time calendar date, one day before `nowUtc`, as 'YYYY-MM-DD'.
// This is "yesterday" as Utah Pros' own day boundary defines it — the date
// the ad-spend cron pulls each morning.
export function mountainYesterday(nowUtc) {
  const now = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  const [y, m, d] = mtDateParts(now);
  const yesterday = new Date(Date.UTC(y, m, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

// True when at least `days` Mountain-Time calendar days have elapsed between
// `lastUtc` and `nowUtc`. A missing `lastUtc` (never contacted) counts as stale.
export function isStale(lastUtc, nowUtc, days) {
  if (!lastUtc) return true;
  const last = lastUtc instanceof Date ? lastUtc : new Date(lastUtc);
  const now = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  const [ly, lm, ld] = mtDateParts(last);
  const [ny, nm, nd] = mtDateParts(now);
  const diffDays = Math.round((Date.UTC(ny, nm, nd) - Date.UTC(ly, lm, ld)) / 86400000);
  return diffDays >= days;
}
