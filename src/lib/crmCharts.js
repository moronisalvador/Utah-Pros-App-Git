/**
 * ════════════════════════════════════════════════
 * FILE: crmCharts.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The chart math and shared color choices behind the CRM Overview
 *   dashboard. Given the raw rows the database hands back (call counts,
 *   estimate-aging buckets, leads grouped by campaign or marketing source),
 *   these pure functions turn them into the exact shapes the little donut and
 *   bar charts need — cumulative slice percentages, answered-vs-missed call
 *   splits, "how much is aging past 30 days" totals, and top-N campaign
 *   groupings. It also holds the one shared palette and the label/color maps
 *   for the six marketing channels and the service divisions, so every chart
 *   colors the same thing the same way. Plain, testable JavaScript on purpose
 *   (crmCharts.test.js) — no React, no database.
 *
 * EXPORTS:
 *   Imported by the CRM Overview chart components (Donut, PipelineStageCard,
 *   OverviewCharts, ConversionTrendCard) and the CrmOverview page. Palette +
 *   channel/division maps, paletteColor, toDonutSegments, callVolumeSplit,
 *   agingOverThreshold, leadsByCampaign, leadsByChannel, newLeadsSince,
 *   pipelineOutcome (won/lost/open + bounded lead win rate).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none directly — operates on rows the get_call_volume /
 *              get_estimate_aging / get_crm_revenue_by_division RPCs and the
 *              lead/attribution helpers return.
 *
 * NOTES / GOTCHAS:
 *   - Every export is pure + deterministic. Zero / all-zero input never yields
 *     NaN or Infinity: donut segments → [], answer-rate → null, etc.
 *   - toDonutSegments DROPS non-positive values before computing percentages,
 *     so a chart never renders a zero-width or negative slice.
 *   - agingOverThreshold reads the FIRST integer in a bucket label ('31–60
 *     days' → 31, '60+ days' → 60) and includes buckets whose start >= days.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Palette & channel/division maps ──────────────

// Categorical palette for charts without a fixed semantic color.
export const CHART_PALETTE = [
  'var(--crm-accent)',
  'var(--crm-success)',
  'var(--crm-channel-insurance)',
  'var(--crm-integration-google)',
  'var(--crm-integration-meta)',
  'var(--crm-speaker)',
  'var(--crm-text-tertiary)',
  'var(--crm-danger-text)',
];

// The six attribution channels → a fixed CSS var, so a channel is always the
// same color across every chart.
export const CHANNEL_COLOR = {
  google_ads: 'var(--crm-integration-google)',
  meta_ads: 'var(--crm-integration-meta)',
  organic: 'var(--crm-success)',
  referral: 'var(--crm-accent)',
  insurance: 'var(--crm-channel-insurance)',
  other: 'var(--crm-text-tertiary)',
};

export const CHANNEL_LABELS = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  organic: 'Organic',
  referral: 'Referral',
  insurance: 'Insurance',
  other: 'Other / Direct',
};

export const DIVISION_LABELS = {
  water: 'Water',
  reconstruction: 'Reconstruction',
  mold: 'Mold',
  remodeling: 'Remodeling',
  contents: 'Contents',
  fire: 'Fire',
  general: 'General',
};

// ─── SECTION: Helpers ──────────────

// Cycle through the palette by index (wraps around).
export function paletteColor(index) {
  const i = Number(index);
  const safe = Number.isFinite(i) && i >= 0 ? Math.floor(i) : 0;
  return CHART_PALETTE[safe % CHART_PALETTE.length];
}

// Coerce to a finite number, else 0.
function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── SECTION: Donut segments ──────────────

/**
 * Turn [{label, value, color?}] into cumulative donut segments.
 * - value coerced to a finite number; items with value <= 0 are DROPPED.
 * - color defaults to paletteColor(i) when missing.
 * - from/to are cumulative percentages (0..100); segments tile 0 → 100.
 * - pct is each segment's share (0..100, one decimal).
 * Empty / all-zero input → [] (never divides by zero).
 */
export function toDonutSegments(items) {
  const list = Array.isArray(items) ? items : [];
  const cleaned = list
    .map((it) => ({ label: it?.label, value: num(it?.value), color: it?.color }))
    .filter((it) => it.value > 0);

  const total = cleaned.reduce((sum, it) => sum + it.value, 0);
  if (total <= 0) return [];

  let cumulative = 0;
  return cleaned.map((it, i) => {
    const pct = Math.round((it.value / total) * 1000) / 10;
    const from = Math.round((cumulative / total) * 1000) / 10;
    cumulative += it.value;
    const to = Math.round((cumulative / total) * 1000) / 10;
    return {
      label: it.label,
      value: it.value,
      color: it.color || paletteColor(i),
      pct,
      from,
      to,
    };
  });
}

// ─── SECTION: Call volume ──────────────

/**
 * Roll up get_call_volume rows into a single split.
 * Returns { total, answered, missed, answer_rate }; answer_rate is
 * answered/total, or null when total <= 0.
 */
export function callVolumeSplit(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let total = 0;
  let answered = 0;
  let missed = 0;
  for (const r of list) {
    total += num(r?.total);
    answered += num(r?.answered);
    missed += num(r?.missed);
  }
  const answer_rate = total > 0 ? answered / total : null;
  return { total, answered, missed, answer_rate };
}

// ─── SECTION: Estimate aging ──────────────

// Parse the first integer in a bucket label, else null.
function firstInt(label) {
  const m = String(label ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Sum count + total_amount over get_estimate_aging buckets whose label starts
 * at >= `days` days. '31–60 days' and '60+ days' count at days=31;
 * '15–30 days' does not. Returns { count, total_amount } (numbers).
 */
export function agingOverThreshold(rows, days = 31) {
  const list = Array.isArray(rows) ? rows : [];
  let count = 0;
  let total_amount = 0;
  for (const r of list) {
    const start = firstInt(r?.bucket);
    if (start != null && start >= days) {
      count += num(r?.count);
      total_amount += num(r?.total_amount);
    }
  }
  return { count, total_amount };
}

// ─── SECTION: Leads groupings ──────────────

/**
 * Group leads by campaign, keep the top N, fold the rest into a single
 * { label: 'Other', count }. null/empty/whitespace campaign → 'Direct / none'.
 * Returns [{label, count}] sorted desc by count.
 */
export function leadsByCampaign(leads, topN = 6) {
  const list = Array.isArray(leads) ? leads : [];
  const counts = new Map();
  for (const l of list) {
    const raw = l?.campaign;
    const label =
      raw != null && String(raw).trim() !== '' ? String(raw).trim() : 'Direct / none';
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const sorted = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const n = Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : sorted.length;
  const top = sorted.slice(0, n);
  const remainder = sorted.slice(n).reduce((sum, it) => sum + it.count, 0);
  if (remainder > 0) top.push({ label: 'Other', count: remainder });
  return top;
}

/**
 * From deriveRows output (each { channel, leads:number }) → [{channel, count}]
 * for channels with count > 0, sorted desc by count.
 */
export function leadsByChannel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((r) => ({ channel: r?.channel, count: num(r?.leads) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Count leads whose occurred_at (fallback created_at) >= sinceISO.
 * Guards bad dates on both sides.
 */
export function newLeadsSince(leads, sinceISO) {
  const list = Array.isArray(leads) ? leads : [];
  const since = Date.parse(sinceISO);
  if (!Number.isFinite(since)) return 0;
  let count = 0;
  for (const l of list) {
    const when = Date.parse(l?.occurred_at ?? l?.created_at);
    if (Number.isFinite(when) && when >= since) count += 1;
  }
  return count;
}

// ─── SECTION: Lead outcomes ──────────────

/**
 * Split the CRM leads into won / lost / open by their pipeline stage's
 * is_won / is_lost flags, and a BOUNDED win rate = won / (won + lost) — the
 * share of *decided* leads we won. A lead lost before an estimate ever exists
 * still sits in a lost stage, so it counts in the denominator; the rate can
 * never exceed 100% (unlike won_jobs ÷ estimates, where won jobs from the jobs
 * table are not a subset of tracked leads/estimates).
 *
 * `sortedStages` is get_pipeline_stages rows (each {id, is_won, is_lost, ...});
 * `grouped` is the {stageId: leads[]} map from crmPipeline.groupLeadsByStage.
 * win_rate is null when nothing is decided yet (guards 0/0).
 */
export function pipelineOutcome(sortedStages, grouped) {
  const stages = Array.isArray(sortedStages) ? sortedStages : [];
  let won = 0;
  let lost = 0;
  let open = 0;
  for (const s of stages) {
    const n = (grouped?.[s?.id] || []).length;
    if (s?.is_won) won += n;
    else if (s?.is_lost) lost += n;
    else open += n;
  }
  const decided = won + lost;
  return {
    won,
    lost,
    open,
    decided,
    total: won + lost + open,
    win_rate: decided > 0 ? won / decided : null,
  };
}

// ─── SECTION: Call outcomes (pipeline-sourced, not CallRail duration) ──────────

/**
 * Split call-type leads into handled vs missed using the CRM PIPELINE as the
 * source of truth, NOT CallRail's duration_sec. A call is "missed" when its
 * current stage is a missed-call stage (is_lost + a name matching /miss/i) —
 * because most real missed calls actually connected (voicemail, quick hangup,
 * ring-then-drop) and so carry duration_sec > 0, which the mechanical
 * duration=0 definition wrongly counts as "answered".
 *
 * `leads` are inbound_leads rows carrying {id, source_type}; `stages` are
 * get_pipeline_stages rows ({id, name, is_lost}); `positions` is the
 * {[lead_id]: {stage_id}} map. A call-lead with no/other stage is "handled".
 * handle_rate is handled/total, or null when there are no calls (guards 0/0).
 */
export function callOutcome(leads, stages, positions) {
  const list = Array.isArray(leads) ? leads : [];
  const missedStageIds = new Set(
    (Array.isArray(stages) ? stages : [])
      .filter((s) => s?.is_lost && /miss/i.test(String(s?.name ?? '')))
      .map((s) => s?.id),
  );
  let total = 0;
  let missed = 0;
  for (const l of list) {
    if (l?.source_type !== 'call') continue;
    total += 1;
    const stageId = positions?.[l?.id]?.stage_id;
    if (stageId != null && missedStageIds.has(stageId)) missed += 1;
  }
  const handled = total - missed;
  return { total, handled, missed, handle_rate: total > 0 ? handled / total : null };
}
