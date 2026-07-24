/**
 * ════════════════════════════════════════════════
 * FILE: CrmOverview.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's front page — the one-glance business picture. Across the chosen
 *   time window it shows, top to bottom: the headline numbers (ad spend, leads,
 *   estimates, won jobs, real revenue, return on ad spend) — estimates/won-jobs/
 *   revenue count ONLY business traceable to a CRM lead, with the matching
 *   company-wide won/revenue total labeled beside each traced headline (see
 *   NOTES); four donut charts (calls
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
 *                leadsByCampaign, leadsByChannel, pipelineOutcome),
 *              @/components/ui (ErrorState),
 *              @/components/crm/OverviewKpiStrip,
 *              @/components/crm/PipelineStageCard,
 *              @/components/crm/OverviewCharts,
 *              @/components/crm/ConversionTrendCard,
 *              @/components/crm/OverdueTasksWidget (Phase 7 slot)
 *   Data:      reads  →
 *                get_attribution_rollup RPC (ad_spend + inbound_leads + estimates
 *                  + jobs, per channel),
 *                get_crm_sales_summary RPC (company-wide and CRM-traced won/
 *                  revenue from one canonical query for the same window),
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
 *     unreliable funnel. The Won jobs and Revenue cards keep the CRM-traced
 *     value as their headline and label the matching company-wide total beside
 *     it. Both numbers come from get_crm_sales_summary, one canonical query
 *     using the same sale rule/date/window, so the comparison cannot be built
 *     from two drifting UI calculations. This page remains the sales &
 *     marketing command center, not the P&L. Two
 *     related RPCs on the Reports page (get_contact_ltv, get_estimate_aging)
 *     are DELIBERATELY NOT scoped this way — see CrmReports.jsx's own NOTES.
 *   - ⭐ **"Won jobs" uses THE canonical company-wide sale rule — `jobs.
 *     is_real_job` — never a local proxy.** See UPR-Web-Context.md "What counts
 *     as a SALE / REAL JOB (THE canonical rule)": a job is a real sale when a
 *     work-auth/recon agreement is SIGNED, a QBO invoice is created, or an
 *     estimate is APPROVED. Sale DATE = `COALESCE(claims.created_at,
 *     jobs.created_at)`, identical to `get_jobs_closed` (the Home dashboard's
 *     "New Jobs Closed" card), so the CRM and the main dashboard finally count
 *     the same thing the same way. Fixed 2026-07-22 (owner-caught live):
 *     all five CRM reporting RPCs had reinvented the rule as `phase <> 'lead'`,
 *     which counts `job_received` — the phase a job enters the moment work is
 *     booked, INCLUDING a free inspection. A 7-day window showed 12 "won jobs",
 *     every one `job_received` with null/$0 invoiced value (which is why
 *     Revenue read $0 beside it); the honest number was 1. All-time
 *     CRM-traced: 31 → 8. See 20260722_crm_won_jobs_use_canonical_real_job_
 *     rule.sql. **If you need "did we sell this", read `is_real_job`.**
 *   - All CRM reporting windows are Denver calendar days. The SQL functions
 *     use mt_date()/mt_today() and this page passes the same start/end pair to
 *     the traced rollup and company-wide sales summary.
 *   - "Lead win rate" (won ÷ decided, from the CRM lead pipeline stage) and the
 *     "Won jobs" headline are DIFFERENT OBJECTS and will legitimately differ:
 *     the former counts LEADS that reached a "Won" pipeline stage (a sales-board
 *     position a human sets), the latter counts real SOLD JOBS per the canonical
 *     rule above. Both are now window-scoped, so neither is a lifetime number,
 *     but they are not expected to be equal. We still do NOT show
 *     won_jobs ÷ estimates as a naive closing rate.
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
 *   - `data.leads` (the single inbound_leads select) is intentionally UNBOUNDED
 *     by date — the sales pipeline needs every currently-open lead regardless
 *     of when it was created, not just ones from the selected window. The
 *     "Leads by campaign" donut and "New leads" KPI, though, must match the
 *     window every OTHER number on this page uses — `derived` filters
 *     `data.leads` down to `windowLeads` (by `rangeStart`/`rangeEnd`, captured
 *     from the SAME rangeToDates() call the RPCs above use) before handing it
 *     to leadsByCampaign/the newLeads count. Fixed 2026-07-22 (owner-caught
 *     live): a "7 days" pick showed 27 leads-by-source but 67 leads-by-
 *     campaign, and "New leads" was hardcoded to a fixed "last 7 days" cutoff
 *     regardless of the picker — both silently counted against the full
 *     unscoped up-to-1000-row fetch instead of the chosen window.
 *   - `windowLeads` is further filtered to `countableWindowLeads` via
 *     `isCountableLead` (crmCharts.js) before feeding the campaign donut/
 *     New-leads KPI — a call that rang and was never answered has no
 *     recording/transcript, so the AI classifier can never flag it as spam,
 *     and it would otherwise inflate every marketing "Leads" number forever
 *     (fixed 2026-07-22, owner-caught live: 13 of 29 leads in a 7-day window
 *     were unanswered calls with zero content — see migration
 *     20260722_crm_leads_exclude_unanswered_calls.sql, which applies the
 *     identical rule server-side in get_attribution_rollup/
 *     get_conversion_trend). The sales pipeline stays on the UNFILTERED
 *     windowLeads/data.leads — staff still need to see a missed call in
 *     order to actually call the person back; this is a marketing-metric
 *     fix, not a change to ops/triage visibility.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import {
  deriveRows,
  fetchCrmSalesSummary,
  filterLeadsByDenverRange,
  rangeToDates,
} from './attributionData';
import { sortStages, groupLeadsByStage } from '@/lib/crmPipeline';
import {
  callVolumeSplit,
  agingOverThreshold,
  isCountableLead,
  leadsByCampaign,
  leadsByChannel,
  pipelineOutcome,
} from '@/lib/crmCharts';
import OverviewKpiStrip from '@/components/crm/OverviewKpiStrip';
import PipelineStageCard from '@/components/crm/PipelineStageCard';
import OverviewCharts from '@/components/crm/OverviewCharts';
import ConversionTrendCard from '@/components/crm/ConversionTrendCard';
import OverdueTasksWidget from '@/components/crm/OverdueTasksWidget';
import { ErrorState } from '@/components/ui';

export default function CrmOverview() {
  const { db } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [range, setRange] = useState('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadRequestId = useRef(0);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setError(false);
    try {
      const { start, end } = rangeToDates(range, customRange);
      const [
        rollup,
        salesSummary,
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
        fetchCrmSalesSummary(db, start, end),
        db.rpc('get_call_volume', { p_start: start, p_end: end }),
        db.rpc('get_speed_to_lead', { p_start: start, p_end: end }),
        db.rpc('get_estimate_aging', {}),
        db.rpc('get_conversion_trend', { p_start: start, p_end: end }),
        db.rpc('get_crm_revenue_by_division', { p_start_date: start, p_end_date: end }),
        db.rpc('get_pipeline_stages', {}),
        db.select('lead_pipeline_stage', 'select=lead_id,stage_id'),
        db.select(
          'inbound_leads',
          'spam_flag=eq.false&merged_into_lead_id=is.null' +
            '&select=id,value,campaign,source,occurred_at,source_type,duration_sec,answered:raw_payload->>answered' +
            '&order=occurred_at.desc&limit=1000',
        ),
      ]);

      const leadPositions = {};
      for (const r of posRows || []) leadPositions[r.lead_id] = { stage_id: r.stage_id };

      if (requestId !== loadRequestId.current) return;
      setData({
        rollup: rollup || [],
        salesSummary,
        callVolume: callVolume || [],
        speed: speed || [],
        aging: aging || [],
        trend: trend || [],
        divisions: divisions || [],
        stages: stages || [],
        leads: leads || [],
        leadPositions,
        rangeStart: start,
        rangeEnd: end,
      });
    } catch {
      if (requestId !== loadRequestId.current) return;
      err('Failed to load overview');
      setError(true);
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [db, range, customRange]);

  useEffect(() => {
    load();
    return () => { loadRequestId.current += 1; };
  }, [load]);

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

    // `data.leads` is fetched unbounded by date (one select, up to 1000 rows);
    // EVERY consumer below scopes it to the picker's window first, so no card
    // on this page silently reports a different population than its neighbours.
    // rangeStart/rangeEnd are bare Denver YYYY-MM-DD values (the same values
    // the RPCs receive). Convert them through the shared DST-aware helper so
    // every local lead-derived card covers the identical reporting window.
    const windowLeads = filterLeadsByDenverRange(
      data.leads,
      data.rangeStart,
      data.rangeEnd,
    );

    const sorted = sortStages(data.stages);
    // Scoped to the picker (owner decision 2026-07-22): the pipeline card used
    // to group ALL leads ever, so it sat on a windowed page showing a lifetime
    // snapshot with no label saying so — a "7 days" pick showed 13 won here
    // next to a 7-day headline, and neither matched the Leads board's own 6.
    // It now filters on `occurred_at` exactly like CrmLeads.jsx's board does,
    // so this card and the Leads board report the identical population for the
    // same window. NOTE: this is leads-by-CURRENT-stage (a sales-board view),
    // deliberately NOT the same question as the headline "Won jobs" (real
    // SOLD jobs per `jobs.is_real_job`) — a won LEAD and a won JOB are
    // different objects and will legitimately differ.
    const grouped = groupLeadsByStage(windowLeads, sorted, data.leadPositions);
    const outcome = pipelineOutcome(sorted, grouped);
    const openStages = sorted.filter((s) => !s.is_won && !s.is_lost);
    const pipelineRows = openStages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      count: (grouped[s.id] || []).length,
    }));
    // A call that rang and was never picked up has no recording/transcript,
    // so the AI classifier can never flag it as spam — it would otherwise
    // silently inflate the campaign donut and New-leads KPI with pure noise
    // (verified live: 13 of 29 "leads" in a 7-day window were unanswered
    // calls with zero content). Same predicate the RPCs feeding "Leads" and
    // "Leads by source" already apply server-side (crm_call_is_answered) —
    // isCountableLead is its client-side twin. The PIPELINE above stays on
    // the unfiltered windowLeads/data.leads — staff still need to see a
    // missed call to actually call the person back.
    const countableWindowLeads = windowLeads.filter(isCountableLead);

    const campaigns = leadsByCampaign(countableWindowLeads, 6);
    const newLeads = countableWindowLeads.length;

    return {
      totals, channels, calls, sla, aging, trend, sales: data.salesSummary,
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
      { label: 'New leads', value: String(newLeads), sub: 'in this window' },
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
            <MetricCard
              label="Won jobs"
              value={derived.sales.traced_won.toLocaleString('en-US')}
              sub={(
                <span className="crm-metric-sub-strong">
                  CRM-traced · {derived.sales.total_won.toLocaleString('en-US')} sold company-wide
                </span>
              )}
            />
            <MetricCard
              label="Revenue"
              value={fmtMoney(derived.sales.traced_revenue)}
              sub={(
                <span className="crm-metric-sub-strong">
                  CRM-traced · {fmtMoney(derived.sales.total_revenue)} company-wide
                </span>
              )}
            />
            <MetricCard label="ROAS" value={fmtRatio(derived.totals.roas)} sub="paid channels" />
          </div>

          <p className="crm-note crm-scope-note">
            Estimates, won jobs, and revenue on this page (including the won-jobs-by-division and
            conversion-trend charts below) only count business traced to a CRM lead. The company-wide
            totals beside Won jobs and Revenue cover all sold work in the same selected window; older
            jobs may predate the CRM and therefore cannot be attributed to a lead.
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
