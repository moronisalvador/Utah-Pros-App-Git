/**
 * ════════════════════════════════════════════════
 * FILE: CrmOverview.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's front page — the one-glance business picture. Across the chosen
 *   time window it shows, top to bottom: the headline numbers (ad spend, leads,
 *   estimates, won jobs, real revenue, return on ad spend) — estimates/won-jobs/
 *   revenue count ONLY business traceable to a CRM lead (see NOTES; company-wide
 *   totals live on the main Home dashboard, not here); four donut charts (calls
 *   answered vs missed — from CallRail, leads by source, won jobs by division,
 *   leads by campaign) right under the headline, so the at-a-glance breakdown
 *   comes before the KPI strip/pipeline/trend detail; a strip of sales-and-
 *   response KPIs (incl. an honest lead win rate — won ÷ decided, always ≤ 100%);
 *   and the open sales pipeline + the lead-vs-won trend side by side (each
 *   about half width — the pipeline board doesn't need a full row). This is
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
 *                pipelineOutcome),
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
 *                inbound_leads table (leads: value, campaign, source, time —
 *                  drives the pipeline, campaign donut, and new-leads KPI)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - ROAS/cost metrics are computed on PAID channels only and can be "—"
 *     (no ad spend in the window) — that is correct, not a bug: a zero-spend
 *     window has no return-on-ad-spend to report.
 *   - **"Won jobs" / "Estimates" / "Revenue" are CRM-TRACED ONLY, EVERYWHERE ON
 *     THIS PAGE** (fixed 2026-07-22, owner-directed) — a job/estimate counts
 *     only when its contact has a real CRM touch (crm_contact_is_traced: a
 *     lead_attribution row, or a non-spam inbound_leads link). This applies
 *     to the 3 headline MetricCards AND to get_conversion_trend (the trend
 *     chart) AND get_crm_revenue_by_division (the "Won jobs by division"
 *     donut) — every RPC on this page that touches won jobs/estimates/revenue
 *     shares the identical scope. Live check found only 24% of won jobs / 6%
 *     of revenue / 23% of estimates traced to a CRM lead at all — counting
 *     the rest made "won jobs" exceed "leads," which read as a broken/
 *     unreliable funnel. Company-WIDE totals (all business, not just
 *     CRM-traced) live on the main Home dashboard, not here — this page is
 *     deliberately the sales & marketing command center, not the P&L. Two
 *     related RPCs on the Reports page (get_contact_ltv, get_estimate_aging)
 *     are DELIBERATELY NOT scoped this way — see CrmReports.jsx's own NOTES.
 *   - "Lead win rate" (won ÷ decided, from the CRM lead pipeline stage) and the
 *     "Won jobs" headline (CRM-traced contacts, from QBO) are now much closer
 *     populations than before this fix, but still not identical — "traced"
 *     only requires ANY CRM touch ever existed, not that the lead specifically
 *     reached a "Won" pipeline stage. We still do NOT show won_jobs ÷ estimates
 *     as a naive closing rate.
 *   - Calls are sourced from CallRail's OWN answered/missed disposition
 *     (get_call_volume → raw_payload.answered), NOT the CRM pipeline stage and
 *     NOT a duration_sec proxy: a call can have real talk time (voicemail,
 *     brief greeting) and still be a miss by CallRail's own judgment — the old
 *     duration=0 proxy wildly undercounted misses (1 vs CallRail's real 20).
 *     get_call_volume's own null-p_start default derives a real floor from the
 *     org's earliest call (fixed 2026-07-22 — a hardcoded distant frontend
 *     floor here previously blew past PostgREST's 1000-row cap and silently
 *     showed 0 calls under "All time"; see UPR-Web-Context.md). This page
 *     just passes start/end straight through, same as every other RPC here.
 *   - A failed load renders a DISTINCT error card with a Retry button — never the
 *     funnel/empty success state, never a blank page (loading-error-states.md §1).
 *   - The loading gate fires on cold load AND on range change (range is a param
 *     change, so a gate is allowed there — it never fires on a resume/mutation).
 *   - All chart/pipeline math lives in the tested pure libs (attribution.js,
 *     crmPipeline.js, crmCharts.js); this page only wires + memoizes them.
 *   - Every count on this page already excludes confirmed spam via
 *     spam_flag=eq.false — set by the AI classifier (functions/api/
 *     transcribe-call.js) once it decides. An AI-screening-coverage caption
 *     (had the classifier even run on this call yet?) was tried and removed
 *     2026-07-22 — owner call, not worth the space — but the underlying
 *     transparency helper (crmCharts.callScreeningCoverage) is kept, tested,
 *     and available if this is ever needed again (see UPR-Web-Context.md).
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
} from '@/lib/crmCharts';
import OverviewKpiStrip from '@/components/crm/OverviewKpiStrip';
import PipelineStageCard from '@/components/crm/PipelineStageCard';
import OverviewCharts from '@/components/crm/OverviewCharts';
import ConversionTrendCard from '@/components/crm/ConversionTrendCard';
import OverdueTasksWidget from '@/components/crm/OverdueTasksWidget';
import { ErrorState } from '@/components/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

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
        db.rpc('get_call_volume', { p_start: start, p_end: end }),
        db.rpc('get_speed_to_lead', { p_start: start, p_end: end }),
        db.rpc('get_estimate_aging', {}),
        db.rpc('get_conversion_trend', { p_start: start, p_end: end }),
        db.rpc('get_crm_revenue_by_division', { p_start_date: start, p_end_date: end }),
        db.rpc('get_pipeline_stages', {}),
        db.select('lead_pipeline_stage', 'select=lead_id,stage_id'),
        db.select(
          'inbound_leads',
          'spam_flag=eq.false&merged_into_lead_id=is.null&select=id,value,campaign,source,occurred_at&order=occurred_at.desc&limit=1000',
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
    // lead pipeline — the one population where every count nests. Won here is
    // a won LEAD (reached the "Won" pipeline stage) — a narrower population
    // than the headline "Won jobs" (any CRM-traced contact's booked job), so
    // the two numbers can still differ even though both are CRM-scoped now.
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

    return {
      totals, channels, calls, sla, aging, trend,
      pipelineRows, outcome, campaigns, newLeads, divisions: data.divisions,
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
            <MetricCard label="Estimates" value={derived.totals.estimates.toLocaleString('en-US')} sub="sent · CRM-traced" />
            <MetricCard label="Won jobs" value={derived.totals.won_jobs.toLocaleString('en-US')} sub="booked · CRM-traced" />
            <MetricCard label="Revenue" value={fmtMoney(derived.totals.revenue)} sub="QBO invoiced · CRM-traced" />
            <MetricCard label="ROAS" value={fmtRatio(derived.totals.roas)} sub="paid channels" />
          </div>

          <p className="crm-note crm-scope-note">
            Estimates, won jobs, and revenue on this page (including the won-jobs-by-division and
            conversion-trend charts below) only count business traced to a CRM lead — company-wide
            totals live on the main Home dashboard, not here.
          </p>

          {/* The 4-donut charts grid sits right under the headline KPIs — the
              owner wants the at-a-glance breakdown (calls, source, division,
              campaign) as the top row, before the KPI strip/pipeline/trend. */}
          <OverviewCharts
            calls={{ answered: derived.calls.answered, missed: derived.calls.missed, total: derived.calls.total }}
            channels={derived.channels}
            divisions={derived.divisions}
            campaigns={derived.campaigns}
          />

          <OverviewKpiStrip stats={kpiStats} />

          {/* Pipeline + trend share a row (each ~half width) rather than each
              claiming a full-width card — the pipeline board doesn't need the
              whole row, and pairing it with the trend keeps "where things
              stand right now" next to "how that's moved over time". */}
          <div className="crm-pipeline-trend-row">
            <PipelineStageCard
              rows={derived.pipelineRows}
              won={derived.outcome.won}
              lost={derived.outcome.lost}
              winRate={derived.outcome.win_rate}
            />
            <ConversionTrendCard trend={derived.trend} />
          </div>

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
