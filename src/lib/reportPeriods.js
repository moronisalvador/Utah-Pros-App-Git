/**
 * ════════════════════════════════════════════════
 * FILE: reportPeriods.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place that turns a time-period name ("MTD", "Last 30", "QTD"…) into
 *   an actual start-and-end date range. Both the Overview dashboard's "New Jobs
 *   Closed" tile and its drill-down page (and, later, the reporting tool) ask
 *   this file the same question — "what dates does MTD cover right now?" — so the
 *   number on the tile and the list on the page can never disagree about which
 *   month you're looking at.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared utility module)
 *   Rendered by:  n/a — imported by useJobsClosed.js, jobsClosed.js, JobsClosed.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - `periodRange` was previously inlined in useJobsClosed.js. It was lifted here
 *     unchanged so the tile's count and any list that reproduces it share ONE
 *     definition of every period boundary — no drift when the reporting tool lands.
 *   - Windows are [startTs, endTs): start inclusive, end exclusive. Every period
 *     except "Prev mo" ends at `now`; "Prev mo" is the bounded prior calendar month.
 *   - REPORT_PERIODS mirrors PERIODS in components/overview/tokens.js (kept separate
 *     because that file is intentionally dashboard-scoped). Keep the two lists in
 *     sync if a period is ever added.
 * ════════════════════════════════════════════════
 */

const DAY = 86400000;

// The canonical period keys, in display order. Mirrors PERIODS in
// components/overview/tokens.js (see NOTES).
export const REPORT_PERIODS = ['MTD', 'Prev mo', 'Last 30', 'QTD', 'YTD'];

// Human sublabel for a period — used in report/page headers so the viewer knows
// exactly what window they're looking at.
export const PERIOD_SUBTITLE = {
  'MTD':     'This month to date',
  'Prev mo': 'The previous calendar month',
  'Last 30': 'The last 30 days',
  'QTD':     'This quarter to date',
  'YTD':     'This year to date',
};

// Returns the [startTs, endTs) window (epoch ms) for the selected period. Every
// period except "Prev mo" runs through `now`; "Prev mo" is a bounded prior
// calendar month. MTD is the fallback for any unrecognized key.
export function periodRange(period, now = Date.now()) {
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

// True if `ts` (epoch ms) falls inside the period window. Convenience wrapper so
// callers don't re-implement the half-open [start, end) comparison.
export function inPeriod(ts, period, now = Date.now()) {
  const { startTs, endTs } = periodRange(period, now);
  return ts >= startTs && ts < endTs;
}
