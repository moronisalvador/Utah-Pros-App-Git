/**
 * ════════════════════════════════════════════════
 * FILE: attribution.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The money math behind the CRM attribution dashboard. Given the raw
 *   counts the database hands back (how much was spent, how many leads,
 *   estimates, won jobs, and how much real revenue — per marketing channel),
 *   these pure functions work out cost-per-lead, return on ad spend (ROAS),
 *   cost-per-job, and the funnel conversion rates. It lives here as plain,
 *   testable JavaScript on purpose — a wrong number would misspend real ad
 *   budget, so every case is unit-tested (attribution.test.js) before it can
 *   reach the screen.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (utility module)
 *   Rendered by:  n/a — imported by src/pages/crm/CrmAttribution.jsx,
 *                 CrmOverview.jsx, CrmReports.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none directly — operates on rows the get_attribution_rollup /
 *              get_attribution_by_campaign RPCs return.
 *
 * NOTES / GOTCHAS:
 *   - The design record is docs/crm-phase3-attribution-model.md. Three zero
 *     cases are handled DIFFERENTLY on purpose:
 *       1. zero SPEND  → cost/return metrics are null (render "—", never "0" —
 *          a $0 "cost per lead" would falsely imply free, infinitely-efficient
 *          leads and pull budget the wrong way).
 *       2. zero DENOMINATOR in a ratio → null (divide-by-zero guard).
 *       3. zero NUMERATOR over a positive denominator → a real value: a 0%
 *          conversion rate, or a 0.0× ROAS on wasted spend — shown, not "—".
 *   - Blended efficiency (rollupTotals) is computed on PAID channels only, so
 *     ad ROAS is never inflated by organically-won revenue.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Helpers ──────────────
const PAID_CHANNELS = new Set(['google_ads', 'meta_ads']);

/** google_ads / meta_ads are the only channels that carry ad_spend. */
export function isPaidChannel(channel) {
  return PAID_CHANNELS.has(channel);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// ─── SECTION: Core metric primitives ──────────────
// Each returns null (→ rendered "—") rather than a misleading 0/Infinity/NaN
// when the input makes the metric meaningless. See NOTES above.

/** Cost per lead = spend / leads. Null for a zero-spend source or no leads. */
export function costPerLead(spend, leads) {
  if (num(spend) <= 0 || num(leads) <= 0) return null;
  return spend / leads;
}

/** ROAS = revenue / spend. Null ONLY when spend is 0 — $0 revenue on real
 *  spend is a legitimate 0.0× (wasted spend), not "no data". */
export function roas(revenue, spend) {
  if (num(spend) <= 0) return null;
  return num(revenue) / spend;
}

/** Cost per booked job = spend / won jobs. Null for zero spend or no jobs. */
export function costPerJob(spend, jobs) {
  if (num(spend) <= 0 || num(jobs) <= 0) return null;
  return spend / jobs;
}

/** Funnel conversion rate = numerator / denominator. Null only on a zero
 *  denominator (guard); a 0 numerator over a positive denominator is a real 0%. */
export function conversionRate(numerator, denominator) {
  if (num(denominator) <= 0) return null;
  return num(numerator) / denominator;
}

// ─── SECTION: Row + rollup derivations ──────────────

/**
 * Take one raw per-channel aggregate row
 * ({ channel, spend, leads, estimates, won_jobs, revenue }) and attach the
 * derived cost/return/rate metrics. Never mutates the input.
 */
export function deriveChannelMetrics(row) {
  const spend = num(row.spend);
  const leads = num(row.leads);
  const estimates = num(row.estimates);
  const wonJobs = num(row.won_jobs);
  const revenue = num(row.revenue);
  return {
    ...row,
    spend, leads, estimates, won_jobs: wonJobs, revenue,
    cost_per_lead: costPerLead(spend, leads),
    roas: roas(revenue, spend),
    cost_per_job: costPerJob(spend, wonJobs),
    lead_to_estimate_rate: conversionRate(estimates, leads),
    estimate_to_won_rate: conversionRate(wonJobs, estimates),
    lead_to_won_rate: conversionRate(wonJobs, leads),
  };
}

/**
 * Roll the per-channel rows up into the spend → lead → job → revenue totals.
 * Counts (leads/estimates/won/revenue) sum across ALL channels; the blended
 * cost/return metrics are computed on PAID channels only so ads are never
 * credited with organic/referral/insurance revenue. Funnel rates are over all.
 */
export function rollupTotals(rows) {
  const acc = {
    spend: 0, leads: 0, estimates: 0, won_jobs: 0, revenue: 0,
    paid_spend: 0, paid_leads: 0, paid_estimates: 0, paid_won_jobs: 0, paid_revenue: 0,
  };
  for (const r of rows || []) {
    acc.spend += num(r.spend);
    acc.leads += num(r.leads);
    acc.estimates += num(r.estimates);
    acc.won_jobs += num(r.won_jobs);
    acc.revenue += num(r.revenue);
    if (isPaidChannel(r.channel)) {
      acc.paid_spend += num(r.spend);
      acc.paid_leads += num(r.leads);
      acc.paid_estimates += num(r.estimates);
      acc.paid_won_jobs += num(r.won_jobs);
      acc.paid_revenue += num(r.revenue);
    }
  }
  return {
    ...acc,
    cost_per_lead: costPerLead(acc.paid_spend, acc.paid_leads),
    roas: roas(acc.paid_revenue, acc.paid_spend),
    cost_per_job: costPerJob(acc.paid_spend, acc.paid_won_jobs),
    lead_to_estimate_rate: conversionRate(acc.estimates, acc.leads),
    estimate_to_won_rate: conversionRate(acc.won_jobs, acc.estimates),
    lead_to_won_rate: conversionRate(acc.won_jobs, acc.leads),
  };
}

/**
 * The Overview funnel: Leads → Estimates → Won. Each stage carries its
 * step-over-previous rate and its share-of-top rate, both div-by-zero guarded.
 */
export function funnelStages({ leads = 0, estimates = 0, won_jobs = 0 } = {}) {
  const counts = [
    { key: 'leads', label: 'Leads', count: num(leads) },
    { key: 'estimates', label: 'Estimates', count: num(estimates) },
    { key: 'won', label: 'Won', count: num(won_jobs) },
  ];
  const top = counts[0].count;
  return counts.map((s, i) => ({
    ...s,
    rate_from_prev: i === 0 ? null : conversionRate(s.count, counts[i - 1].count),
    rate_from_top: i === 0 ? (top > 0 ? 1 : null) : conversionRate(s.count, top),
  }));
}

// ─── SECTION: Display formatters ──────────────
// The single place the "— not 0" rule becomes pixels: null → "—", a real 0 →
// "$0" / "0.0×" / "0%". Keeping this distinction in one tested place stops it
// from being re-implemented (and gotten wrong) per component.

/** Whole-dollar money, thousands-separated. null → "—". */
export function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** Ratio like ROAS, one decimal + "×". null → "—". */
export function fmtRatio(n) {
  if (n == null) return '—';
  return `${n.toFixed(1)}×`;
}

/** Percentage, whole number. null → "—". */
export function fmtPct(n) {
  if (n == null) return '—';
  return `${Math.round(n * 100)}%`;
}

// ─── SECTION: Phase 9 report derivations ──────────────
// The fixed-report money math, same conventions as above: a zero denominator is
// a guard (→ null → "—"); a zero numerator over a positive denominator is a real
// 0 (0%, $0). The report RPCs return raw counts only — the rates live here so
// they are unit-tested once, never re-derived (and gotten wrong) per component.

/** One conversion-trend period row → funnel rates + revenue/won attached. */
export function deriveConversionTrendRow(row) {
  const leads = num(row.leads);
  const estimates = num(row.estimates);
  const won = num(row.won_jobs);
  const revenue = num(row.revenue);
  return {
    ...row,
    leads, estimates, won_jobs: won, revenue,
    lead_to_estimate_rate: conversionRate(estimates, leads),
    estimate_to_won_rate: conversionRate(won, estimates),
    lead_to_won_rate: conversionRate(won, leads),
    revenue_per_won: won > 0 ? revenue / won : null,
  };
}

/** Raw conversion-trend rows → derived rows (one per period). */
export function deriveConversionTrend(rows) {
  return (rows || []).map(deriveConversionTrendRow);
}

/** One estimator leaderboard row → win rate + revenue/won (guarded). */
export function deriveEstimatorRow(row) {
  const totalJobs = num(row.total_jobs);
  const won = num(row.won_jobs);
  const revenue = num(row.revenue);
  return {
    ...row,
    total_jobs: totalJobs, won_jobs: won, revenue,
    win_rate: conversionRate(won, totalJobs),
    revenue_per_won: won > 0 ? revenue / won : null,
  };
}

/** Raw leaderboard rows → derived + sorted by revenue desc. */
export function deriveLeaderboard(rows) {
  return (rows || []).map(deriveEstimatorRow).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Speed-to-lead response-time buckets → SLA summary. Each bucket row carries a
 * `within_sla` flag from the RPC (true for the fastest bucket); the rate is
 * within-SLA responses over all responses, div-by-zero guarded (empty history
 * window → null, not 0/0).
 */
export function speedToLeadSummary(rows) {
  const buckets = rows || [];
  const total = buckets.reduce((s, b) => s + num(b.count), 0);
  const withinSla = buckets.reduce((s, b) => s + (b.within_sla ? num(b.count) : 0), 0);
  return { total, within_sla: withinSla, sla_rate: conversionRate(withinSla, total) };
}

/**
 * Contact-LTV rows → portfolio summary: total revenue, average LTV per contact,
 * and the repeat rate (contacts with more than one won job). Average + repeat
 * rate guard an empty portfolio to null rather than NaN.
 */
export function ltvSummary(rows) {
  const list = rows || [];
  const contactCount = list.length;
  const totalRevenue = list.reduce((s, r) => s + num(r.revenue), 0);
  const repeatCount = list.filter(r => num(r.jobs) > 1).length;
  return {
    contact_count: contactCount,
    total_revenue: totalRevenue,
    avg_ltv: contactCount > 0 ? totalRevenue / contactCount : null,
    repeat_count: repeatCount,
    repeat_rate: conversionRate(repeatCount, contactCount),
  };
}
