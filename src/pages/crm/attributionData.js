/**
 * ════════════════════════════════════════════════
 * FILE: attributionData.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The non-visual helpers shared by the Phase 3 CRM dashboard screens: the
 *   channel display names, the date-range choices, and the small functions
 *   that turn the raw rows the database returns into ready-to-show, math-derived
 *   rows. Kept in a plain (non-component) file so React fast-refresh stays happy
 *   and the visual pieces live separately in attributionParts.jsx.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data/helper module)
 *   Rendered by:  n/a — imported by attributionParts.jsx + the CRM Phase 3 pages
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/attribution (deriveChannelMetrics — the tested money math)
 *   Data:      none directly — operates on get_attribution_rollup /
 *              get_attribution_by_campaign RPC rows.
 *
 * NOTES / GOTCHAS:
 *   - Numeric columns can arrive from PostgREST as strings; toNumberRow()
 *     coerces them before any math, or attribution.js's num() guard would read
 *     a "1000" string as 0.
 *   - rangeToDates('custom', customRange) reads the picked From/To dates
 *     instead of doing day-math off `RANGES` — mirrors CrmLeads.jsx's
 *     dateRangeFor(period, customRange) so the two custom-range pickers in
 *     the CRM behave identically.
 * ════════════════════════════════════════════════
 */
import { deriveChannelMetrics } from '@/lib/attribution';

export const CHANNEL_LABELS = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  organic: 'Organic',
  referral: 'Referral',
  insurance: 'Insurance',
  other: 'Other / Direct',
};

export const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '12mo', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
];

const NUMERIC_FIELDS = ['spend', 'leads', 'estimates', 'won_jobs', 'revenue'];

const pad = (d) => d.toISOString().slice(0, 10);

/**
 * Turn a range key into { start, end } YYYY-MM-DD (or nulls for "all time").
 * `key === 'custom'` reads the picked dates from `customRange` ({start, end},
 * each an "" or a YYYY-MM-DD string from a native <input type="date">) — an
 * empty side stays unbounded (null), matching CrmLeads.jsx's dateRangeFor.
 */
export function rangeToDates(key, customRange) {
  if (key === 'custom') {
    return {
      start: customRange?.start || null,
      end: customRange?.end || null,
    };
  }
  const spec = RANGES.find((r) => r.key === key);
  if (!spec || spec.days == null) return { start: null, end: null };
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - spec.days);
  return { start: pad(start), end: pad(end) };
}

/** Coerce a raw RPC row's numeric fields (which may be strings) to numbers. */
export function toNumberRow(r) {
  const out = { ...r };
  for (const f of NUMERIC_FIELDS) out[f] = Number(r[f] ?? 0) || 0;
  return out;
}

/** Raw RPC rows → per-channel rows with derived cost/return/rate metrics. */
export function deriveRows(rows) {
  return (rows || []).map((r) => deriveChannelMetrics(toNumberRow(r)));
}
