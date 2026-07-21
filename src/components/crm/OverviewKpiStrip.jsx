/**
 * ════════════════════════════════════════════════
 * FILE: OverviewKpiStrip.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows a small row of headline numbers on the CRM Overview screen — things
 *   like how many calls came in and how fast the team responded. It just
 *   displays numbers it is handed; it never looks anything up on its own.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (presentational component)
 *   Rendered by:  CrmOverview.jsx (built in the Integrate phase)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/pages/crm/attributionParts (MetricCard)
 *   Data:      none — receives already-formatted stats via props.
 *
 * NOTES / GOTCHAS:
 *   - Purely presentational: no data fetching, no useAuth/db, no RPC calls.
 *   - `stats` values are pre-formatted strings; this component does no math.
 * ════════════════════════════════════════════════
 */
import { MetricCard } from '@/pages/crm/attributionParts';

export default function OverviewKpiStrip({ stats }) {
  return (
    <div className="crm-card">
      <h2 className="crm-section-title">Sales &amp; response</h2>
      <div className="crm-metric-grid">
        {stats.map((s) => (
          <MetricCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>
    </div>
  );
}
