/**
 * ════════════════════════════════════════════════
 * FILE: OverviewCharts.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A four-panel grid of donut charts for the CRM Overview page. Each panel
 *   answers one question at a glance: how many phone calls were answered vs
 *   missed, where leads came from (source), which service divisions produced
 *   won jobs, and which marketing campaigns drove the most leads. It only
 *   draws what it is handed — it never loads any data itself.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (implicit — JSX only, no hooks)
 *   Internal:  @/components/crm/charts/Donut,
 *              @/lib/crmCharts (CHANNEL_LABELS, CHANNEL_COLOR, DIVISION_LABELS,
 *                               paletteColor)
 *   Data:      reads → none (presentational; all data arrives via props)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Purely presentational: no useAuth/db/RPC calls. The parent page loads and
 *     shapes the data (calls → callOutcome pipeline split, channels →
 *     leadsByChannel, divisions → get_crm_revenue_by_division, campaigns →
 *     leadsByCampaign).
 *   - "Missed" here is a PIPELINE judgment (the Missed Calls stage), not CallRail
 *     duration = 0 — see callOutcome. Most missed calls actually connected.
 *   - Empty datasets are handled by Donut's own muted empty ring — this file
 *     never fabricates slices.
 *   - Owned by Phase 9 (.claude/rules/crm-wave-ownership.md).
 * ════════════════════════════════════════════════
 */
import Donut from '@/components/crm/charts/Donut';
import { CHANNEL_LABELS, CHANNEL_COLOR, DIVISION_LABELS, paletteColor } from '@/lib/crmCharts';

// ─── Helpers ──────────────
function sumBy(arr, fn) {
  return (arr || []).reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);
}

export default function OverviewCharts({ calls, channels, divisions, campaigns }) {
  // ─── Calls: handled vs missed (pipeline-sourced) ──────────────
  const callSegments = [
    { label: 'Handled', value: Number(calls?.handled) || 0, color: 'var(--crm-success)' },
    { label: 'Missed', value: Number(calls?.missed) || 0, color: 'var(--crm-danger-text)' },
  ];
  const callsTotal = Number(calls?.total) || 0;

  // ─── Leads by source (channel) ──────────────
  const channelSegments = (channels || []).map((c) => ({
    label: CHANNEL_LABELS[c.channel] || c.channel,
    value: Number(c.count) || 0,
    color: CHANNEL_COLOR[c.channel] || paletteColor(0),
  }));
  const channelTotal = sumBy(channels, (c) => c.count);

  // ─── Won jobs by division ──────────────
  const divisionSegments = (divisions || []).map((d, i) => ({
    label: DIVISION_LABELS[d.division] || d.division,
    value: Number(d.won_jobs) || 0,
    color: paletteColor(i),
  }));
  const divisionTotal = sumBy(divisions, (d) => d.won_jobs);

  // ─── Leads by campaign ──────────────
  const campaignSegments = (campaigns || []).map((c, i) => ({
    label: c.label,
    value: Number(c.count) || 0,
    color: paletteColor(i),
  }));
  const campaignTotal = sumBy(campaigns, (c) => c.count);

  // ─── Render ──────────────
  return (
    <div className="crm-charts-grid">
      <div className="crm-card">
        <h2 className="crm-section-title">Calls</h2>
        <Donut segments={callSegments} total={callsTotal} label="CALLS" />
        <p className="crm-note">Missed = calls in the Missed Calls pipeline stage, not just unanswered rings.</p>
      </div>

      <div className="crm-card">
        <h2 className="crm-section-title">Leads by source</h2>
        <Donut segments={channelSegments} total={channelTotal} label="LEADS" />
      </div>

      <div className="crm-card">
        <h2 className="crm-section-title">Won jobs by division</h2>
        <Donut segments={divisionSegments} total={divisionTotal} label="JOBS" />
        <p className="crm-note">Service type is known once a lead becomes a won job.</p>
      </div>

      <div className="crm-card">
        <h2 className="crm-section-title">Leads by campaign</h2>
        <Donut segments={campaignSegments} total={campaignTotal} label="LEADS" />
      </div>
    </div>
  );
}
