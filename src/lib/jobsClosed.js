/**
 * ════════════════════════════════════════════════
 * FILE: jobsClosed.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Fetches the actual list of jobs that were SOLD ("closed") in a given time
 *   period — the same jobs the Overview dashboard's "New Jobs Closed" tile
 *   counts. It asks the database for every sold job, keeps only the ones whose
 *   sale falls inside the chosen period, and then looks up the friendly details
 *   (customer name, address, job number, division, value) so a page can show a
 *   real list instead of just a number.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared data module)
 *   Rendered by:  n/a — imported by src/pages/JobsClosed.jsx (and reusable by the
 *                 future reporting tool: one function = the canonical "sold jobs
 *                 in period X" query)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/reportPeriods (periodRange — same window the tile uses)
 *   Data:      reads → get_jobs_closed() RPC (the canonical sold-job set), then
 *                      hydrates from the jobs table (id=in.(…))
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Matches the tile BY CONSTRUCTION: identical RPC (get_jobs_closed) + identical
 *     period math (periodRange from reportPeriods.js). Change the definition of a
 *     "sold job" only in the RPC, never here, so the two can't diverge.
 *   - The RPC returns only { job_id, sale_date, sale_source }. We hydrate display
 *     fields in a second round-trip and stitch sale_date/sale_source back on, so
 *     each returned row carries both the sale metadata and the job's own columns.
 *   - Rows are returned newest-sale-first (the RPC already orders by sale_date
 *     DESC; we preserve that order through hydration).
 * ════════════════════════════════════════════════
 */

import { periodRange } from '@/lib/reportPeriods';

// Columns the drill-down list needs. Kept lean — this is a list view, not a detail
// page. Add here (not at the call site) if the list grows a new column.
const LIST_SELECT = [
  'id', 'job_number', 'insured_name', 'division', 'phase', 'status',
  'address', 'city', 'state', 'insurance_company', 'claim_number',
  'date_of_loss', 'estimated_value', 'approved_value', 'invoiced_value',
].join(',');

/**
 * Returns the sold ("closed") jobs for a period, hydrated for display.
 *
 * @param {object} db       the authenticated client from useAuth()
 * @param {string} period   one of REPORT_PERIODS ('MTD' | 'Prev mo' | …)
 * @param {number} [now]    epoch ms "now" (injectable for tests); defaults to Date.now()
 * @returns {Promise<{ count: number, rows: object[] }>}
 *          rows = job rows (LIST_SELECT columns) each with sale_date + sale_source
 *          attached, newest sale first. count === rows.length.
 */
export async function fetchJobsClosed(db, period, now = Date.now()) {
  // 1) Canonical sold-job set (same RPC the tile uses). Floor to ~400 days so it
  //    never rescans all-time history — the widest period (YTD) fits inside that.
  const floor = new Date(now - 400 * 86400000).toISOString().slice(0, 10);
  const closed = await db.rpc('get_jobs_closed', { p_floor: floor });

  // 2) Keep only sales inside the selected period window (same periodRange as the tile).
  const { startTs, endTs } = periodRange(period, now);
  const inWindow = (closed || []).filter((r) => {
    const t = r.sale_date && new Date(r.sale_date).getTime();
    return t && t >= startTs && t < endTs;
  });

  if (inWindow.length === 0) return { count: 0, rows: [] };

  // 3) Hydrate display fields for just those jobs. Preserve the RPC's newest-first
  //    order (db.select order isn't guaranteed to match, so we re-order by the
  //    sale metadata we already hold).
  const meta = new Map(inWindow.map((r) => [r.job_id, { sale_date: r.sale_date, sale_source: r.sale_source }]));
  const ids = inWindow.map((r) => r.job_id);
  const jobs = await db.select('jobs', `id=in.(${ids.join(',')})&select=${LIST_SELECT}`);

  const rows = (jobs || [])
    .map((j) => ({ ...j, ...(meta.get(j.id) || {}) }))
    .sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));

  return { count: rows.length, rows };
}
