/**
 * ════════════════════════════════════════════════
 * FILE: crmPipeline.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The math behind the CRM's Leads pipeline board. Puts pipeline stages
 *   (New, Contacted, Qualified, ...) in the order the admin set in Settings,
 *   sorts leads into the right column, and works out a "weighted pipeline
 *   value" — how much of the open pipeline dollars is realistically likely
 *   to actually close, instead of just adding up every open lead's full
 *   value as if it were guaranteed.
 *
 * Exports:
 *   sortStages(stages) — stages sorted by sort_order (ascending).
 *   groupLeadsByStage(leads, stages, stagePositions) — { [stageId]: leads[] },
 *     a lead with no entry in stagePositions falls into the first stage.
 *   stageWeight(stage, sortedStages) — win-likelihood weight for one stage:
 *     1 for is_won, 0 for is_lost, else the admin-set
 *     pipeline_stages.win_probability (0..1) when present, otherwise a
 *     positional-ramp fallback that rises with the stage's position among the
 *     open (non-won/non-lost) stages.
 *   weightedPipelineValue(leads, stages, stagePositions) — { total, byStage }.
 *
 *   Lead scoring (Phase 9) — rule-based, deterministic, NO ML:
 *   classifyLeadChannel(source) — a raw source string → one of the six
 *     attribution channels (mirrors the SQL crm_channel_for_source buckets).
 *   scoreLeadFactors(lead) — the per-factor point breakdown (source,
 *     engagement, speed-to-first-touch, transcript sentiment, transcript
 *     topics); a spam lead hard-zeros to a single 'spam' factor.
 *   scoreLead(lead) — the clamped 0..LEAD_SCORE_MAX total of those factors.
 *   The SQL score_lead(p_lead_id) RPC mirrors this exact point table and
 *   persists the factors to lead_score_factors + inbound_leads.lead_score.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none — pure functions, no DB access
 * ════════════════════════════════════════════════
 */

export function sortStages(stages) {
  return [...stages].sort((a, b) => a.sort_order - b.sort_order);
}

export function groupLeadsByStage(leads, stages, stagePositions) {
  const sorted = sortStages(stages);
  const grouped = {};
  for (const stage of sorted) grouped[stage.id] = [];

  const fallbackStageId = sorted[0]?.id ?? null;
  for (const lead of leads) {
    const stageId = stagePositions?.[lead.id]?.stage_id ?? fallbackStageId;
    if (grouped[stageId]) grouped[stageId].push(lead);
  }
  return grouped;
}

export function stageWeight(stage, sortedStages) {
  // Won/lost are terminal and definitional — a realized outcome, never a guess.
  if (stage.is_won) return 1;
  if (stage.is_lost) return 0;

  // Prefer an admin-set win_probability (0..1). Anything null/undefined/garbage
  // or out of range falls through to the positional ramp so a mis-typed value
  // can never distort the forecast.
  if (stage.win_probability != null) {
    const p = Number(stage.win_probability);
    if (Number.isFinite(p) && p >= 0 && p <= 1) return p;
  }

  const openStages = sortedStages.filter(s => !s.is_won && !s.is_lost);
  const position = openStages.findIndex(s => s.id === stage.id);
  if (position === -1) return 0;

  return (position + 1) / (openStages.length + 1);
}

export function weightedPipelineValue(leads, stages, stagePositions) {
  const sorted = sortStages(stages);
  const grouped = groupLeadsByStage(leads, stages, stagePositions);

  const byStage = {};
  let total = 0;
  for (const stage of sorted) {
    const weight = stageWeight(stage, sorted);
    const stageLeads = grouped[stage.id] || [];
    const sum = stageLeads.reduce((acc, lead) => acc + (Number(lead.value) || 0) * weight, 0);
    byStage[stage.id] = sum;
    total += sum;
  }
  return { total, byStage };
}

// ─── SECTION: Lead scoring (Phase 9 — rule-based, deterministic, no ML) ────────
// The point tables below are the single source of truth for the score; the SQL
// score_lead RPC replicates them exactly. Keep the two in lockstep — a change
// here is a change to the RPC body migration.

export const LEAD_SCORE_MAX = 100;

// Points awarded per resolved marketing channel (restoration intent quality).
const SOURCE_POINTS = { referral: 20, insurance: 18, google_ads: 15, organic: 10, meta_ads: 8, other: 5 };

// Restoration-urgency keywords in transcript topics → a real job, not a tire-kick.
const URGENT_TOPIC_RX = /\b(water|flood|fire|smoke|mold|sewage|storm|leak|burst|emergenc|damage|restorat|asbestos|hail|wind)\b/i;

/**
 * Normalize a raw source string to one of the six attribution channels. Mirrors
 * the KEYWORD rules of the SQL crm_channel_for_source (incl. the organic-before-
 * paid ordering, so "Google My Business" is organic, not ads). It does NOT
 * replicate that function's secondary lookup against referral_sources.category,
 * so a keyword-less named source resolves to 'other' here but may resolve to a
 * real channel in SQL. That is fine: this JS path feeds only the unit-tested
 * scoreLead(); the score persisted + displayed is always the SQL score_lead's,
 * which is the single source of truth.
 */
export function classifyLeadChannel(source) {
  const v = String(source || '').trim().toLowerCase();
  if (!v) return 'other';
  if (/(facebook|instagram|meta ads|\bmeta\b|\bfb\b|\big\b)/.test(v)) return 'meta_ads';
  if (/(my business|business profile|gmb|seo|organic|website|nextdoor)/.test(v)) return 'organic';
  if (/(google|adwords|lsa|local service|ppc|paid search|sem)/.test(v)) return 'google_ads';
  if (/(insurance|adjuster|tpa|carrier)/.test(v)) return 'insurance';
  if (/(referral|word of mouth|repeat|neighbor|friend)/.test(v)) return 'referral';
  return 'other';
}

// How reachable/engaged the first contact was: a long answered call outranks a
// short one; a form fill outranks a missed call (which earns nothing here).
function engagementPoints(lead) {
  if (lead.source_type === 'call') {
    const d = Number(lead.duration_sec) || 0;
    if (d >= 120) return 20;
    if (d >= 60) return 12;
    if (d >= 20) return 6;
    return 0; // missed / near-instant hang-up
  }
  if (lead.source_type === 'form') return 10;
  return 5;
}

// Speed-to-first-touch: how fast we responded (minutes). A not-yet-touched lead
// (null) earns nothing but is not penalized; a negative/garbage gap is ignored.
function speedPoints(minutes) {
  if (minutes == null) return 0;
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return 0;
  if (m <= 5) return 15;
  if (m <= 30) return 10;
  if (m <= 120) return 5;
  if (m <= 1440) return 2;
  return 0;
}

function sentimentPoints(analysis) {
  const label = analysis?.sentiment?.label;
  if (label === 'positive') return 15;
  if (label === 'neutral') return 5;
  return 0; // negative, or no transcript analysis at all
}

function topicPoints(analysis) {
  const topics = Array.isArray(analysis?.topics) ? analysis.topics : [];
  return topics.some(t => URGENT_TOPIC_RX.test(String(t))) ? 15 : 0;
}

/**
 * The per-factor point breakdown for a lead. `lead.first_touch_minutes` is the
 * already-computed response gap (the SQL RPC derives it; here it is an input so
 * the math stays pure and deterministic). A spam lead short-circuits to a single
 * hard-zero factor.
 */
export function scoreLeadFactors(lead = {}) {
  if (lead.spam_flag) {
    return [{ factor: 'spam', points: 0, detail: { spam: true } }];
  }
  const channel = classifyLeadChannel(lead.source);
  const urgent = topicPoints(lead.transcript_analysis) > 0;
  return [
    { factor: 'source', points: SOURCE_POINTS[channel] ?? 5, detail: { channel, source: lead.source ?? null } },
    { factor: 'engagement', points: engagementPoints(lead), detail: { source_type: lead.source_type ?? null, duration_sec: lead.duration_sec ?? null } },
    { factor: 'speed_to_first_touch', points: speedPoints(lead.first_touch_minutes), detail: { first_touch_minutes: lead.first_touch_minutes ?? null } },
    { factor: 'sentiment', points: sentimentPoints(lead.transcript_analysis), detail: { label: lead.transcript_analysis?.sentiment?.label ?? null } },
    { factor: 'topics', points: topicPoints(lead.transcript_analysis), detail: { urgent } },
  ];
}

/** The lead's rule-based score: clamped 0..LEAD_SCORE_MAX sum of its factors. */
export function scoreLead(lead = {}) {
  const total = scoreLeadFactors(lead).reduce((s, f) => s + (Number(f.points) || 0), 0);
  return Math.max(0, Math.min(LEAD_SCORE_MAX, total));
}
