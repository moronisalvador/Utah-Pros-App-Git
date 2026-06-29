/**
 * ════════════════════════════════════════════════
 * FILE: dashUtils.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small shared helpers for the Overview dashboard's data hooks: turning a
 *   period choice (this month / previous full month / last 30 / this quarter /
 *   this year) into start and end dates, and formatting dollar amounts two ways
 *   — full ("$40,858") and short ("$40.9K").
 *
 * WHERE IT LIVES:
 *   Route:        n/a (utility module)
 *   Rendered by:  the overview data hooks (useRevenue, useAvgTicket, …)
 *
 * DEPENDS ON:
 *   Packages:  none · Internal: none · Data: none
 *
 * NOTES / GOTCHAS:
 *   - periodBounds uses new Date() — only ever called inside async hook loads
 *     (never during render), so it stays React-pure.
 * ════════════════════════════════════════════════
 */

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function periodBounds(period) {
  const now = new Date();
  let start;
  let end = now; // default: period runs through today
  if (period === 'Prev mo') {
    // Previous full calendar month: 1st → last day (NOT through today). `day 0`
    // of the current month resolves to the last day of the prior month.
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 0);
  }
  else if (period === 'QTD') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else if (period === 'YTD') start = new Date(now.getFullYear(), 0, 1);
  else if (period === 'Last 30') { start = new Date(now); start.setDate(start.getDate() - 29); }
  else start = new Date(now.getFullYear(), now.getMonth(), 1); // MTD (default)
  return { start: toISO(start), end: toISO(end) };
}

export function fmtK(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function fmtFull(n) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
}
