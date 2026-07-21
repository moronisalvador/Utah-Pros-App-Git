/**
 * ════════════════════════════════════════════════
 * FILE: CrmOverview.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's front page — the one-glance business picture. Across the chosen
 *   time window it shows the headline numbers (ad spend, leads, estimates, won
 *   jobs, real revenue, return on ad spend), a strip of sales-and-response KPIs
 *   (incl. an honest lead win rate — won ÷ decided, always ≤ 100%), the open
 *   sales pipeline (a donut plus a per-stage count list), four donut charts
 *   (calls answered vs missed — from CallRail, leads by source, won jobs by
 *   division, leads by campaign), and a lead-vs-won trend over time. A small
 *   caption reports how much of the counted calls have actually been through
 *   the AI spam classifier (not a judgment of its own — see NOTES). This is
 *   the screen that replaces flipping between five different tools to see the
 *   whole story.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/overview
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/lib/toast (err),
 *              @/lib/attribution (rollupTotals, speedToLeadSummary,
 *                deriveConversionTrend, fmtMoney, fmtPct, fmtRatio),
 *              ./attributionParts (RangePicker, MetricCard),
 *              ./attributionData (deriveRows, rangeToDates),
 *              @/lib/crmPipeline (sortStages, groupLeadsByStage),
 *              @/lib/crmCharts (callVolumeSplit, agingOverThreshold,
 *                leadsByCampaign, leadsByChannel, newLeadsSince,
 *                pipelineOutcome, callScreeningCoverage),
 *              @/components/ui (ErrorState),
 *              @/components/crm/OverviewKpiStrip,
 *              @/components/crm/PipelineStageCard,
 *              @/components/crm/OverviewCharts,
 *              @/components/crm/ConversionTrendCard,
 *              @/components/crm/OverdueTasksWidget (Phase 7 slot)
 *   Data:      reads  →
 *                get_attribution_rollup RPC (ad_spend + inbound_leads + estimates
 *                  + jobs, per channel),
 *                get_call_volume RPC (CallRail's own answered/missed
 *                  disposition — raw_payload.answered, NOT a duration proxy),
 *                get_speed_to_lead RPC (response-time buckets),
 *                get_estimate_aging RPC (open-estimate aging buckets),
 *                get_conversion_trend RPC (leads → won over time),
 *                get_crm_revenue_by_division RPC (won jobs by division),
 *                get_pipeline_stages RPC (all pipeline stages + won/lost flags),
 *                lead_pipeline_stage table (which stage each lead sits in),
 *                inbound_leads table (leads: value, campaign, source,
 *                  source_type, time, transcript_analysis — drives the
 *                  pipeline, campaign donut, new-leads KPI, and the AI
 *                  spam-screening coverage caption)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - ROAS/cost metrics are computed on PAID channels only and can be "—"
 *     (no ad spend in the window) — that is correct, not a bug: a zero-spend
 *     window has no return-on-ad-spend to report.
 *   - "Lead win rate" (won ÷ decided, from the CRM lead pipeline) is a DIFFERENT
 *     population from the "Won jobs" headline (all booked jobs from QBO, most of
 *     which arrive through non-CRM channels). We do NOT show won_jobs ÷ estimates
 *     as a closing rate — those populations don't nest, so it can exceed 100%.
 *   - Calls are sourced from CallRail's OWN answered/missed disposition
 *     (get_call_volume → raw_payload.answered), NOT the CRM pipeline stage and
 *     NOT a duration_sec proxy: a call can have real talk time (voicemail,
 *     brief greeting) and still be a miss by CallRail's own judgment — the old
 *     duration=0 proxy wildly undercounted misses (1 vs CallRail's real 20).
 *     get_call_volume defaults to a 30-day window when a bound is null, so
 *     under "All time" we pass ALL_TIME_FLOOR to keep the window aligned.
 *   - A failed load renders a DISTINCT error card with a Retry button — never the
 *     funnel/empty success state, never a blank page (loading-error-states.md §1).
 *   - The loading gate fires on cold load AND on range change (range is a param
 *     change, so a gate is allowed there — it never fires on a resume/mutation).
 *   - All chart/pipeline math lives in the tested pure libs (attribution.js,
 *     crmPipeline.js, crmCharts.js); this page only wires + memoizes them.
 *   - The spam-screening caption does NOT re-judge spam — the AI classifier
 *     (functions/api/transcribe-call.js) already does that and, once it
 *     decides, calls set_lead_spam_flag(), which every count on this page
 *     already excludes via spam_flag=eq.false. This caption only reports
 *     COVERAGE (has the classifier even run on this call yet?) via
 *     callScreeningCoverage, so the leads count is never read as more
 *     certain than it is — an unscreened call could still turn out to be
 *     spam once the classifier catches up (see UPR-Web-Context.md for the
 *     classifier's own docs).
 *   - get_attribution_rollup's leads count now excludes merged repeat-call
 *     duplicates (merged_into_lead_id), matching the Kanban board's own
 *     definition of a lead — fixed 2026-07-21 (see UPR-Web-Context.md).
 *   - RangePicker also supports a custom From/To range (same popover pattern
 *     as CrmLeads.jsx's date filter); `range==='custom'` reads `customRange`
 *     via rangeToDates('custom', customRange) — both are in load()'s dep
 *     array so picking new custom dates refetches even though `range` itself
 *     doesn't change string value.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { err } from '@/lib/toast';
import {
  rollupTotals,
  speedToLeadSummary,
  deriveConversionTrend,
  fmtMoney,
  fmtPct,
  fmtRatio,
} from '@/lib/attribution';
import { RangePicker, MetricCard } from './attributionParts';
import { deriveRows, rangeToDates } from './attributionData';
import { sortStages, groupLeadsByStage } from '@/lib/crmPipeline';
import {
  callVolumeSplit,
  agingOverThreshold,
  leadsByCampaign,
  leadsByChannel,
  newLeadsSince,
  pipelineOutcome,
  callScreeningCoverage,
} from '@/lib/crmCharts';
import OverviewKpiStrip from '@/components/crm/OverviewKpiStrip';
import PipelineStageCard from '@/components/crm/PipelineStageCard';
import OverviewCharts from '@/components/crm/OverviewCharts';
import ConversionTrendCard from '@/components/crm/ConversionTrendCard';
import OverdueTasksWidget from '@/components/crm/OverdueTasksWidget';
import { ErrorState } from '@/components/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

// get_call_volume defaults to the last 30 days when a bound is null — which would
// silently show a 30-day answer rate under an "All time" range. Pass an explicit
// floor so the call window matches the rest of the page.
const ALL_TIME_FLOOR = '2000-01-01';

export default function CrmOverview() {
  const { db } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [range, setRange] = useState('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { start, end } = rangeToDates(range, customRange);
      const callStart = start ?? ALL_TIME_FLOOR;
      const callEnd = end ?? new Date().toISOString().slice(0, 10);
      const [
        rollup,
        callVolume,
        speed,
        aging,
        trend,
        divisions,
        stages,
        posRows,
        leads,
      ] = await Promise.all([
        db.rpc('get_attribution_rollup', { p_start_date: start, p_end_date: end }),
        db.rpc('get_call_volume', { p_start: callStart, p_end: callEnd }),
        db.rpc('get_speed_to_lead', { p_start: start, p_end: end }),
        db.rpc('get_estimate_aging', {}),
        db.rpc('get_conversion_trend', { p_start: start, p_end: end }),
        db.rpc('get_crm_revenue_by_division', { p_start_date: start, p_end_date: end }),
        db.rpc('get_pipeline_stages', {}),
        db.select('lead_pipeline_stage', 'select=lead_id,stage_id'),
        db.select(
          'inbound_leads',
          'spam_flag=eq.false&merged_into_lead_id=is.null&select=id,value,campaign,source,source_type,occurred_at,transcript_analysis&order=occurred_at.desc&limit=1000',
        ),
      ]);

      const leadPositions = {};
      for (const r of posRows || []) leadPositions[r.lead_id] = { stage_id: r.stage_id };

      setData({
        rollup: rollup || [],
        callVolume: callVolume || [],
        speed: speed || [],
        aging: aging || [],
        trend: trend || [],
        divisions: divisions || [],
        stages: stages || [],
        leads: leads || [],
        leadPositions,
        sinceISO: new Date(Date.now() - 7 * DAY_MS).toISOString(),
      });
    } catch {
      err('Failed to load overview');
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [db, range, customRange]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Derivations (all from the tested pure libs) ──────────────
  const derived = useMemo(() => {
    if (!data) return null;

    const rows = deriveRows(data.rollup);
    const totals = rollupTotals(rows);
    const channels = leadsByChannel(rows);
    // Calls are sourced from CallRail's OWN answered/missed disposition
    // (get_call_volume, backed by raw_payload.answered) — not the CRM pipeline.
    // The pipeline's "Missed Calls" stage is a curated business judgment, not a
    // telephony fact; CallRail is the source of truth for what happened on the
    // call itself.
    const calls = callVolumeSplit(data.callVolume);
    const sla = speedToLeadSummary(data.speed);
    const aging = agingOverThreshold(data.aging, 31);
    const trend = deriveConversionTrend(data.trend);

    const sorted = sortStages(data.stages);
    const grouped = groupLeadsByStage(data.leads, sorted, data.leadPositions);
    // Honest, bounded lead outcome (won / lost / open + win rate) from the CRM
    // lead pipeline — the one population where every count nests. Won here is a
    // won LEAD (pipeline stage), distinct from the headline "Won jobs" (all
    // booked jobs from QBO, which come through many non-CRM channels).
    const outcome = pipelineOutcome(sorted, grouped);
    const openStages = sorted.filter((s) => !s.is_won && !s.is_lost);
    const pipelineRows = openStages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      count: (grouped[s.id] || []).length,
    }));

    const campaigns = leadsByCampaign(data.leads, 6);
    const newLeads = newLeadsSince(data.leads, data.sinceISO);
    // How much of the counted call-leads have actually been through the AI
    // spam classifier vs. still unscreened — a transparency read, not a new
    // spam judgment (that stays entirely the classifier's job; see
    // crmCharts.callScreeningCoverage).
    const screening = callScreeningCoverage(data.leads);

    return {
      totals, channels, calls, sla, aging, trend,
      pipelineRows, outcome, campaigns, newLeads, screening, divisions: data.divisions,
    };
  }, [data]);

  const kpiStats = useMemo(() => {
    if (!derived) return [];
    const { sla, calls, newLeads, aging, outcome } = derived;
    return [
      { label: 'Lead win rate', value: fmtPct(outcome.win_rate), sub: `${outcome.won} won of ${outcome.decided} decided` },
      { label: 'Speed to lead', value: fmtPct(sla.sla_rate), sub: `${sla.within_sla} of ${sla.total} within 5 min` },
      { label: 'Calls answered', value: fmtPct(calls.answer_rate), sub: `${calls.missed} missed of ${calls.total}` },
      { label: 'New leads', value: String(newLeads), sub: 'last 7 days' },
      { label: 'Open leads', value: String(outcome.open), sub: 'in pipeline' },
      { label: 'Aging estimates', value: fmtMoney(aging.total_amount), sub: `${aging.count} · 31+ days` },
    ];
  }, [derived]);

  // ─── SECTION: Render ──────────────
  return (
    <div className="crm-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Overview</h1>
          <p className="crm-page-subtitle">Spend → leads → estimates → won jobs → revenue, all in one place.</p>
        </div>
        <RangePicker
          value={range}
          onChange={setRange}
          onCustomRange={(start, end) => setCustomRange({ start, end })}
        />
      </div>

      {loading ? (
        <OverviewSkeleton />
      ) : error || !derived ? (
        <ErrorState message="Couldn't load the overview. This is usually a brief hiccup." onRetry={load} />
      ) : (
        <>
          <div className="crm-metric-grid">
            <MetricCard label="Ad spend" value={fmtMoney(derived.totals.spend)} sub="Google + Meta" />
            <MetricCard label="Leads" value={derived.totals.leads.toLocaleString('en-US')} sub="CallRail calls + forms" />
            <MetricCard label="Estimates" value={derived.totals.estimates.toLocaleString('en-US')} sub="sent" />
            <MetricCard label="Won jobs" value={derived.totals.won_jobs.toLocaleString('en-US')} sub="booked" />
            <MetricCard label="Revenue" value={fmtMoney(derived.totals.revenue)} sub="QBO invoiced" />
            <MetricCard label="ROAS" value={fmtRatio(derived.totals.roas)} sub="paid channels" />
          </div>

          {derived.screening.call_leads > 0 && (
            <p className="crm-note crm-screening-note">
              {derived.screening.unscreened === 0
                ? `All ${derived.screening.call_leads} calls have been AI-screened for spam.`
                : `${derived.screening.screened} of ${derived.screening.call_leads} calls AI-screened for spam · ${derived.screening.unscreened} pending (confirmed spam is already excluded from the counts above).`}
            </p>
          )}

          <OverviewKpiStrip stats={kpiStats} />

          <PipelineStageCard
            rows={derived.pipelineRows}
            won={derived.outcome.won}
            lost={derived.outcome.lost}
            winRate={derived.outcome.win_rate}
          />

          <OverviewCharts
            calls={{ answered: derived.calls.answered, missed: derived.calls.missed, total: derived.calls.total }}
            channels={derived.channels}
            divisions={derived.divisions}
            campaigns={derived.campaigns}
          />

          <ConversionTrendCard trend={derived.trend} />

          {/* Overdue tasks (Phase 7 slot). The weighted-forecast widget is
              intentionally not rendered here: inbound leads carry no dollar
              value in this business, so it is structurally $0 — the honest
              lead win rate + open-lead count above replace it. */}
          <OverdueTasksWidget />
        </>
      )}
    </div>
  );
}

// ─── SECTION: Helpers ──────────────

/** Static, muted cold-load / range-change placeholder (no shimmer — perf + motion gate). */
function OverviewSkeleton() {
  return (
    <div className="crm-skeleton" aria-hidden="true">
      <div className="crm-skeleton-card" style={{ height: 96 }} />
      <div className="crm-skeleton-card" style={{ height: 96 }} />
      <div className="crm-skeleton-card" style={{ height: 260 }} />
      <div className="crm-skeleton-card" style={{ height: 240 }} />
    </div>
  );
}
