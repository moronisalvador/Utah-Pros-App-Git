/**
 * ════════════════════════════════════════════════
 * FILE: Donut.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small ring-shaped chart (a "donut"). You hand it a list of things with a
 *   label and a number, and it draws a colored ring where each slice's size
 *   matches its share of the total, plus a big number in the middle and a little
 *   legend underneath that spells out each slice, its value, and its percentage.
 *   When there is nothing to show, it draws a plain gray ring instead of faking
 *   any slices.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a presentational chart component
 *   Rendered by:  src/components/crm/{OverviewCharts,PipelineStageCard}.jsx
 *                 and other CRM Overview cards
 *
 * DEPENDS ON:
 *   Packages:  react (implicit — JSX only)
 *   Internal:  @/lib/crmCharts (toDonutSegments)
 *   Data:      reads → none (props only) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Presentational only: no data fetching, no useAuth/db, no RPC. All numbers
 *     arrive via props.
 *   - Colors may be CSS var() strings — they work inside conic-gradient.
 *   - The slice math (drop <=0, cumulative from/to, percentages) lives entirely
 *     in toDonutSegments; this file just paints the result.
 *   - No animation by design (avoids the motion-review gate).
 *   - The CSS for the crm-donut-* class hooks is written by the Integrate phase.
 * ════════════════════════════════════════════════
 */
import { toDonutSegments } from '@/lib/crmCharts';

export default function Donut({ segments, total, label, sublabel, size = 128 }) {
  const computed = toDonutSegments(segments || []);
  const hasData = computed.length > 0;

  // Build the conic-gradient string: each segment paints from its cumulative
  // start% to its end%. Empty → a single muted full ring.
  const gradient = hasData
    ? `conic-gradient(${computed
        .map((s) => `${s.color} ${s.from}% ${s.to}%`)
        .join(', ')})`
    : 'conic-gradient(var(--crm-border) 0% 100%)';

  const dim = { width: `${size}px`, height: `${size}px` };

  return (
    <div className="crm-donut">
      <div className="crm-donut-ring" style={{ ...dim, background: gradient }}>
        <div className="crm-donut-hole">
          <div className="crm-donut-center">
            <span className="crm-donut-total">{total}</span>
            {label ? <span className="crm-donut-label">{label}</span> : null}
            {sublabel ? <span className="crm-donut-sub">{sublabel}</span> : null}
          </div>
        </div>
      </div>

      <div className="crm-donut-legend">
        {hasData ? (
          computed.map((s) => (
            <div className="crm-donut-legend-row" key={s.label}>
              <span
                className="crm-donut-swatch"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className="crm-donut-legend-label">{s.label}</span>
              <span className="crm-donut-legend-val">{s.value}</span>
              <span className="crm-donut-legend-pct">{s.pct}%</span>
            </div>
          ))
        ) : (
          <div className="crm-donut-empty">No data</div>
        )}
      </div>
    </div>
  );
}
