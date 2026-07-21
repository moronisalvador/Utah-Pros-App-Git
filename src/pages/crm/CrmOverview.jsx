/**
 * ════════════════════════════════════════════════
 * FILE: CrmOverview.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's front page — the one-glance business picture. Across the chosen
 *   time window it shows the headline numbers (ad spend, leads, estimates, won
 *   jobs, real revenue, return on ad spend), a strip of sales-and-response KPIs,
 *   the open sales pipeline (a donut plus a per-stage list with weighted dollar
 *   value), four donut charts (calls answered vs missed, leads by source, won
 *   jobs by division, leads by campaign), a lead-vs-won trend over time, and the
 *   spend → lead → estimate → won funnel. This is the screen that replaces
 *   flipping between five different tools to see the whole story.
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
 *              @/lib/attribution (rollupTotals, funnelStages, speedToLeadSummary,
 *                deriveConversionTrend, fmtMoney, fmtPct, fmtRatio),
 *              ./attributionParts (RangePicker, MetricCard, Funnel),
 *              ./attributionData (deriveRows, rangeToDates),
 *              @/lib/crmPipeline (sortStages, groupLeadsByStage,
 *                weightedPipelineValue),
 *              @/lib/crmCharts (callVolumeSplit, agingOverThreshold,
 *                leadsByCampaign, leadsByChannel, newLeadsSince),
 *              @/components/crm/OverviewKpiStrip,
 *              @/components/crm/PipelineStageCard,
 *              @/components/crm/OverviewCharts,
 *              @/components/crm/ConversionTrendCard,
 *              @/components/crm/OverdueTasksWidget (Phase 7 slot),
 *              @/components/crm/ForecastWidget (Phase 9 slot)
 *   Data:      reads  →
 *                get_attribution_rollup RPC (ad_spend + inbound_leads + estimates
 *                  + jobs, per channel),
 *                get_call_volume RPC (answered/missed calls),
 *                get_speed_to_lead RPC (response-time buckets),
 *                get_estimate_aging RPC (open-estimate aging buckets),
 *                get_conversion_trend RPC (leads → won over time),
 *                get_crm_revenue_by_division RPC (won jobs by division),
 *                get_pipeline_stages RPC (open pipeline stages),
 *                lead_pipeline_stage table (which stage each lead sits in),
 *                inbound_leads table (open leads: value, campaign, source, time)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - ROAS/cost metrics are computed on PAID channels only and can be "—"
 *     (no ad spend in the window) — that is correct, not a bug: a zero-spend
 *     window has no return-on-ad-spend to report.
 *   - A failed load renders a DISTINCT error card with a Retry button — never the
 *     funnel/empty success state, never a blank page (loading-error-states.md §1).
 *   - The loading gate fires on cold load AND on range change (range is a param
 *     change, so a gate is allowed there — it never fires on a resume/mutation).
 *   - All chart/pipeline math lives in the tested pure libs (attribution.js,
 *     crmPipeline.js, crmCharts.js); this page only wires + memoizes them.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { err } from '@/lib/toast';
import {
  rollupTotals,
  funnelStages,
  speedToLeadSummary,
  deriveConversionTrend,
  fmtMoney,
  fmtPct,
  fmtRatio,
} from '@/lib/attribution';
import { RangePicker, MetricCard, Funnel } from './attributionParts';
import { deriveRows, rangeToDates } from './attributionData';
import { sortStages, groupLeadsByStage, weightedPipelineValue } from '@/lib/crmPipeline';
import {
  callVolumeSplit,
  agingOverThreshold,
  leadsByCampaign,
  leadsByChannel,
  newLeadsSince,
} from '@/lib/crmCharts';
import OverviewKpiStrip from '@/components/crm/OverviewKpiStrip';
import PipelineStageCard from '@/components/crm/PipelineStageCard';
import OverviewCharts from '@/components/crm/OverviewCharts';
import ConversionTrendCard from '@/components/crm/ConversionTrendCard';
import OverdueTasksWidget from '@/components/crm/OverdueTasksWidget';
import ForecastWidget from '@/components/crm/ForecastWidget';
import { ErrorState } from '@/components/ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function CrmOverview() {
  const { db } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { start, end } = rangeToDates(range);
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
  }, [db, range]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Derivations (all from the tested pure libs) ──────────────
  const derived = useMemo(() => {
    if (!data) return null;

    const rows = deriveRows(data.rollup);
    const totals = rollupTotals(rows);
    const funnel = funnelStages(totals);
    const channels = leadsByChannel(rows);
    const callSplit = callVolumeSplit(data.callVolume);
    const sla = speedToLeadSummary(data.speed);
    const aging = agingOverThreshold(data.aging, 31);
    const trend = deriveConversionTrend(data.trend);

    const sorted = sortStages(data.stages);
    const grouped = groupLeadsByStage(data.leads, sorted, data.leadPositions);
    const { byStage } = weightedPipelineValue(data.leads, sorted, data.leadPositions);
    const openStages = sorted.filter((s) => !s.is_won && !s.is_lost);
    const pipelineRows = openStages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      count: (grouped[s.id] || []).length,
      value: byStage[s.id] || 0,
    }));
    const openTotalValue = pipelineRows.reduce((sum, r) => sum + (r.value || 0), 0);

    const campaigns = leadsByCampaign(data.leads, 6);
    const newLeads = newLeadsSince(data.leads, data.sinceISO);

    return {
      totals, funnel, channels, callSplit, sla, aging, trend,
      pipelineRows, openTotalValue, campaigns, newLeads, divisions: data.divisions,
    };
  }, [data]);

  const kpiStats = useMemo(() => {
    if (!derived) return [];
    const { totals, sla, callSplit, newLeads, openTotalValue, aging } = derived;
    return [
      { label: 'Closing rate', value: fmtPct(totals.estimate_to_won_rate), sub: 'estimate → won' },
      { label: 'Speed to lead', value: fmtPct(sla.sla_rate), sub: 'worked within 5 min' },
      { label: 'Call answer rate', value: fmtPct(callSplit.answer_rate), sub: `${callSplit.answered} of ${callSplit.total}` },
      { label: 'New leads', value: String(newLeads), sub: 'last 7 days' },
      { label: 'Open pipeline', value: fmtMoney(openTotalValue), sub: 'weighted' },
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
        <RangePicker value={range} onChange={setRange} />
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

          <OverviewKpiStrip stats={kpiStats} />

          <PipelineStageCard rows={derived.pipelineRows} openTotalValue={derived.openTotalValue} />

          <OverviewCharts
            calls={{ answered: derived.callSplit.answered, missed: derived.callSplit.missed, total: derived.callSplit.total }}
            channels={derived.channels}
            divisions={derived.divisions}
            campaigns={derived.campaigns}
          />

          <ConversionTrendCard trend={derived.trend} />

          <div className="crm-card">
            <h2 className="crm-section-title">Sales funnel</h2>
            <Funnel stages={derived.funnel} />
          </div>

          {/* Slot components filled by later wave phases (Phase F stubs render
              nothing): overdue tasks (Phase 7) + weighted forecast (Phase 9). */}
          <OverdueTasksWidget />
          <ForecastWidget />
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
