/**
 * ════════════════════════════════════════════════
 * FILE: attributionData.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The non-visual helpers shared by the Phase 3 CRM dashboard screens: the
 *   channel display names, the date-range choices, and the small functions
 *   that turn the raw rows the database returns into ready-to-show, math-derived
 *   rows. It also owns the one company-wide-vs-CRM-traced sales-summary read so
 *   the Overview passes the exact same date window and normalizes PostgREST
 *   numeric values before they reach metric cards. Kept in a plain
 *   (non-component) file so React fast-refresh stays happy and the visual
 *   pieces live separately in attributionParts.jsx.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/attribution (deriveChannelMetrics — the tested money math)
 *   Data:      reads → get_crm_sales_summary RPC
 *              otherwise operates on get_attribution_rollup /
 *              get_attribution_by_campaign RPC rows.
 *
 * NOTES / GOTCHAS:
 *   - Numeric columns can arrive from PostgREST as strings; toNumberRow()
 *     coerces them before any math, or attribution.js's num() guard would read
 *     a "1000" string as 0.
 *   - get_crm_sales_summary returns both the traced headline and company-wide
 *     context from one canonical query. Do not rebuild either half in the UI.
 *   - rangeToDates('custom', customRange) reads the picked From/To dates
 *     instead of doing day-math off `RANGES` — mirrors CrmLeads.jsx's
 *     dateRangeFor(period, customRange) so the two custom-range pickers in
 *     the CRM behave identically.
 *   - Preset ranges are inclusive Denver calendar-day windows. Never derive
 *     them with the browser timezone or UTC string slicing.
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
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '12mo', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
];

const NUMERIC_FIELDS = ['spend', 'leads', 'estimates', 'won_jobs', 'revenue'];

const DENVER_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DENVER_DATE_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Return the America/Denver calendar date for an absolute instant. */
export function denverDateString(now = new Date()) {
  const parts = Object.fromEntries(
    DENVER_DATE_PARTS
      .formatToParts(now)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Subtract whole calendar dates without crossing a DST-length day. */
function subtractCalendarDays(yyyyMmDd, days) {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day - days));
  return utcDate.toISOString().slice(0, 10);
}

/**
 * Convert a Denver calendar date to its exact UTC midnight instant.
 *
 * Denver's offset changes across DST, so parsing a bare YYYY-MM-DD as UTC or
 * adding a fixed 24 hours gives the wrong reporting window. The short
 * iteration below asks Intl how a candidate instant renders in Denver and
 * corrects it to the requested local midnight.
 */
export function denverDateStartMs(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!match) return Number.NaN;

  const [, yearText, monthText, dayText] = match;
  const targetWallClock = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
  );
  let instant = targetWallClock + (7 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      DENVER_DATE_TIME_PARTS
        .formatToParts(new Date(instant))
        .filter(({ type }) => type !== 'literal')
        .map(({ type, value }) => [type, value]),
    );
    const renderedWallClock = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const correction = targetWallClock - renderedWallClock;
    instant += correction;
    if (correction === 0) break;
  }

  return instant;
}

/** Apply the same inclusive Denver calendar window used by the reporting RPCs. */
export function filterLeadsByDenverRange(leads, start, end) {
  const startTs = denverDateStartMs(start);
  const endExclusiveTs = end
    ? denverDateStartMs(subtractCalendarDays(end, -1))
    : null;

  return (leads || []).filter((lead) => {
    const occurredAt = Date.parse(lead?.occurred_at);
    if (!Number.isFinite(occurredAt)) return false;
    if (startTs != null && occurredAt < startTs) return false;
    if (endExclusiveTs != null && occurredAt >= endExclusiveTs) return false;
    return true;
  });
}

/**
 * Turn a range key into { start, end } YYYY-MM-DD (or nulls for "all time").
 * `key === 'custom'` reads the picked dates from `customRange` ({start, end},
 * each an "" or a YYYY-MM-DD string from a native <input type="date">) — an
 * empty side stays unbounded (null), matching CrmLeads.jsx's dateRangeFor.
 */
export function rangeToDates(key, customRange, now = new Date()) {
  if (key === 'custom') {
    return {
      start: customRange?.start || null,
      end: customRange?.end || null,
    };
  }
  const spec = RANGES.find((r) => r.key === key);
  if (!spec || spec.days == null) return { start: null, end: null };
  const end = denverDateString(now);
  const start = subtractCalendarDays(end, spec.days - 1);
  return { start, end };
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

const SALES_SUMMARY_FIELDS = [
  'total_won',
  'total_revenue',
  'traced_won',
  'traced_revenue',
];

/** Normalize the sales-summary JSON contract without allowing NaN into the UI. */
export function normalizeCrmSalesSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('Invalid CRM sales summary');
  }
  const normalized = {};
  for (const field of SALES_SUMMARY_FIELDS) {
    const rawValue = summary[field];
    const isNumber = typeof rawValue === 'number';
    const isNumericString = typeof rawValue === 'string' && rawValue.trim() !== '';
    const value = (isNumber || isNumericString) ? Number(rawValue) : Number.NaN;
    if (!Number.isFinite(value)) {
      throw new Error('Invalid CRM sales summary');
    }
    normalized[field] = value;
  }
  return normalized;
}

/**
 * Fetch both sides of the CRM sales story through the canonical single-query
 * RPC. The caller supplies the same inclusive Denver date strings used by the
 * rest of the Overview.
 */
export async function fetchCrmSalesSummary(db, start, end) {
  const summary = await db.rpc('get_crm_sales_summary', {
    p_start_date: start,
    p_end_date: end,
  });
  return normalizeCrmSalesSummary(summary);
}
