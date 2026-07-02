/**
 * ════════════════════════════════════════════════
 * FILE: CrmOverview.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's front page — the one-glance business picture. Across the chosen
 *   time window it shows the headline numbers (ad spend, leads, estimates, won
 *   jobs, real revenue, and return on ad spend) and the sales funnel: how many
 *   leads became estimates, and how many of those became won jobs. This is the
 *   screen that replaces flipping between five different tools to see the whole
 *   spend → lead → job → revenue story.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/overview
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/lib/attribution (rollupTotals, funnelStages, formatters),
 *              ./attributionParts (RangePicker, MetricCard, Funnel, deriveRows),
 *              @/components/crm/OverdueTasksWidget (Phase 7 slot),
 *              @/components/crm/ForecastWidget (Phase 9 slot)
 *   Data:      reads  → get_attribution_rollup RPC (joins ad_spend,
 *                       inbound_leads, estimates, jobs) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - ROAS/cost metrics are computed on PAID channels only and can be "—"
 *     (no ad spend in the window) — that is correct, not a bug: a zero-spend
 *     window has no return-on-ad-spend to report.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { rollupTotals, funnelStages, fmtMoney, fmtRatio } from '@/lib/attribution';
import { RangePicker, MetricCard, Funnel } from './attributionParts';
import { deriveRows, rangeToDates } from './attributionData';
import OverdueTasksWidget from '@/components/crm/OverdueTasksWidget';
import ForecastWidget from '@/components/crm/ForecastWidget';

export default function CrmOverview() {
  const { db } = useAuth();
  const [range, setRange] = useState('all');
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = rangeToDates(range);
      const rows = await db.rpc('get_attribution_rollup', { p_start_date: start, p_end_date: end });
      setRaw(rows || []);
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load overview', type: 'error' } }));
      setRaw([]);
    } finally {
      setLoading(false);
    }
  }, [db, range]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => deriveRows(raw), [raw]);
  const totals = useMemo(() => rollupTotals(rows), [rows]);
  const stages = useMemo(() => funnelStages(totals), [totals]);

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
        <div className="crm-loading">Loading…</div>
      ) : (
        <>
          <div className="crm-metric-grid">
            <MetricCard label="Ad spend" value={fmtMoney(totals.spend)} sub="Google + Meta" />
            <MetricCard label="Leads" value={totals.leads.toLocaleString('en-US')} sub="CallRail calls + forms" />
            <MetricCard label="Estimates" value={totals.estimates.toLocaleString('en-US')} sub="sent" />
            <MetricCard label="Won jobs" value={totals.won_jobs.toLocaleString('en-US')} sub="booked" />
            <MetricCard label="Revenue" value={fmtMoney(totals.revenue)} sub="QBO invoiced" />
            <MetricCard label="ROAS" value={fmtRatio(totals.roas)} sub="paid channels" />
          </div>

          <div className="crm-card">
            <h2 className="crm-section-title">Sales funnel</h2>
            <Funnel stages={stages} />
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
