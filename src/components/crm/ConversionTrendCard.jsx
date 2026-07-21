/**
 * ════════════════════════════════════════════════
 * FILE: ConversionTrendCard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   An Overview card that shows how the business is doing over time. It takes a
 *   list of time periods (each with how many leads came in and how many turned
 *   into won jobs) and draws a small bar chart comparing the two. Below the chart
 *   it prints one line summing up the total money brought in across the whole
 *   window, so you can see the trend and the payoff at a glance.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (implicit — JSX only)
 *   Internal:  @/components/crm/charts/MiniTrend (the bar chart),
 *              @/lib/attribution (fmtMoney)
 *   Data:      reads → none (presentational — all data arrives via the `trend`
 *              prop) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Purely presentational: it does NOT call useAuth/db or any RPC. The page
 *     (CrmOverview.jsx) loads the data and passes it in. `trend` comes from
 *     deriveConversionTrend (each item: { period, leads, estimates, won_jobs,
 *     revenue, ... }).
 *   - Empty/missing trend → a single crm-note instead of an empty chart.
 *   - Owned by Phase 9 (.claude/rules/crm-wave-ownership.md).
 * ════════════════════════════════════════════════
 */
import MiniTrend from '@/components/crm/charts/MiniTrend';
import { fmtMoney } from '@/lib/attribution';

export default function ConversionTrendCard({ trend }) {
  const rows = Array.isArray(trend) ? trend : [];

  if (rows.length === 0) {
    return (
      <div className="crm-card">
        <h2 className="crm-section-title">Conversion trend</h2>
        <p className="crm-note">No activity in this window.</p>
      </div>
    );
  }

  const totalRevenue = rows.reduce((sum, t) => sum + (Number(t?.revenue) || 0), 0);
  const series = rows.map((t) => ({ label: t.period, leads: t.leads, won: t.won_jobs }));

  return (
    <div className="crm-card">
      <h2 className="crm-section-title">Conversion trend</h2>
      <MiniTrend series={series} />
      <p className="crm-note">{fmtMoney(totalRevenue)} in revenue over this window</p>
    </div>
  );
}
