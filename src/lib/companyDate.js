/**
 * ════════════════════════════════════════════════
 * FILE: companyDate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers "what day is it for the company?" — always in Utah time, no matter
 *   where the phone thinks it is. Before this, screens worked out today's date
 *   in a way that flipped over at 6 p.m. our time, so a technician creating an
 *   appointment in the evening got TOMORROW's date on it.
 *
 * Exports:
 *   COMPANY_TIME_ZONE              'America/Denver'
 *   todayInCompanyTimeZone()       'YYYY-MM-DD' for right now
 *   companyDateOf(instant)         'YYYY-MM-DD' for any Date
 *
 * DEPENDS ON:
 *   Packages:  none (Intl is built in)
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - `new Date().toISOString().split('T')[0]` is the trap this replaces. It
 *     slices the UTC date, and Mountain Time is 6-7 hours behind UTC, so from
 *     ~6 p.m. local onward it returns TOMORROW. A repo-wide grep found 26 such
 *     lines across 24 files; the audit named 2 of them.
 *   - database-standard.md §7: all day/week bucketing is America/Denver, never
 *     UTC and never server-local. This is the client-side counterpart to
 *     functions/lib/date-mt.js, which is worker-only and cannot be imported here.
 *   - Mirrors that worker helper's approach deliberately: en-CA + formatToParts,
 *     so both sides derive the same calendar day from the same instant.
 *   - Returns a STRING, not a Date. A Date would immediately be re-interpreted
 *     in the device's zone and reintroduce the bug one call later.
 * ════════════════════════════════════════════════
 */

export const COMPANY_TIME_ZONE = 'America/Denver';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar date in company time for any instant, as 'YYYY-MM-DD'.
 * Falls back to the device's local date if Intl misbehaves — a wrong-by-a-day
 * default is bad, but a crashed form is worse for someone standing in a
 * basement.
 */
export function companyDateOf(instant = new Date()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const year = get('year');
    const month = get('month');
    const day = get('day');
    if (!year || !month || !day) throw new Error('incomplete parts');
    return `${year}-${month}-${day}`;
  } catch {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/** Today, in company time, as 'YYYY-MM-DD'. */
export function todayInCompanyTimeZone() {
  return companyDateOf(new Date());
}
