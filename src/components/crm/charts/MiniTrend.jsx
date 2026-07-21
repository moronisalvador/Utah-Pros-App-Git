/**
 * ════════════════════════════════════════════════
 * FILE: MiniTrend.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small side-by-side bar chart that shows, for each time period, how many
 *   leads came in versus how many turned into won jobs. Every period gets two
 *   little bars — a "Leads" bar and a "Won" bar — so you can eyeball the trend
 *   at a glance. It draws itself as a plain inline picture (SVG) and does not
 *   fetch any data; whoever uses it hands it the numbers to draw.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a presentational chart component
 *   Rendered by:  src/components/crm/ConversionTrendCard.jsx (and, through it,
 *                 the CRM Overview page)
 *
 * DEPENDS ON:
 *   Packages:  react (JSX only — no hooks, no state)
 *   Internal:  none — pure props in, SVG out
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Presentational only: it takes a `series` prop and never calls useAuth/db
 *     or any RPC. All data loading happens on the page.
 *   - Bars are scaled to the largest value across BOTH leads and won so the two
 *     series share one axis and stay comparable. An all-zero series still draws
 *     an empty baseline (never divides by zero).
 *   - X-axis labels are thinned (every Nth) once there are enough periods to
 *     crowd, so the labels never overlap.
 *   - No animation by design (keeps it out of the motion-review gate). Colors
 *     come from CRM tokens (var(--crm-accent) = Leads, var(--crm-success) = Won).
 * ════════════════════════════════════════════════
 */

// ─── Helpers ──────────────
const VB_HEIGHT = 140;      // viewBox height
const COL_WIDTH = 44;       // horizontal space per period
const BAR_WIDTH = 15;       // width of each of the two bars
const BAR_GAP = 3;          // gap between the leads/won pair
const TOP_PAD = 8;          // headroom above the tallest bar
const LABEL_BAND = 20;      // vertical space reserved for x-axis labels
const MAX_LABELS = 8;       // cap on how many period labels we render

// Coerce a possibly-string/undefined value to a finite non-negative number.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function MiniTrend({ series }) {
  const rows = Array.isArray(series) ? series : [];

  if (rows.length === 0) {
    return <div className="crm-minitrend-empty">No trend data yet</div>;
  }

  const chartH = VB_HEIGHT - TOP_PAD - LABEL_BAND;
  const baseline = TOP_PAD + chartH;
  const vbWidth = Math.max(rows.length * COL_WIDTH, COL_WIDTH);

  // Shared scale across both series so the bars stay comparable.
  const maxVal = Math.max(
    1,
    ...rows.map((r) => Math.max(num(r.leads), num(r.won))),
  );

  // Thin the labels so they never crowd.
  const labelStep = Math.max(1, Math.ceil(rows.length / MAX_LABELS));

  const barH = (v) => (num(v) / maxVal) * chartH;

  return (
    <div className="crm-minitrend">
      <svg
        className="crm-minitrend-svg"
        viewBox={`0 0 ${vbWidth} ${VB_HEIGHT}`}
        width="100%"
        height={VB_HEIGHT}
        role="img"
        aria-label="Leads versus won jobs by period"
        preserveAspectRatio="xMidYMid meet"
      >
        {rows.map((r, i) => {
          const colX = i * COL_WIDTH;
          const pairWidth = BAR_WIDTH * 2 + BAR_GAP;
          const pairX = colX + (COL_WIDTH - pairWidth) / 2;

          const leadsH = barH(r.leads);
          const wonH = barH(r.won);
          const leadsX = pairX;
          const wonX = pairX + BAR_WIDTH + BAR_GAP;

          const showLabel = i % labelStep === 0;

          return (
            <g key={i}>
              <rect
                x={leadsX}
                y={baseline - leadsH}
                width={BAR_WIDTH}
                height={leadsH}
                fill="var(--crm-accent)"
                rx="2"
              />
              <rect
                x={wonX}
                y={baseline - wonH}
                width={BAR_WIDTH}
                height={wonH}
                fill="var(--crm-success)"
                rx="2"
              />
              {showLabel && (
                <text
                  x={colX + COL_WIDTH / 2}
                  y={VB_HEIGHT - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--crm-text-tertiary)"
                >
                  {r.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="crm-minitrend-legend">
        <span className="crm-minitrend-legend-row">
          <span
            className="crm-minitrend-swatch"
            style={{ background: 'var(--crm-accent)' }}
          />
          Leads
        </span>
        <span className="crm-minitrend-legend-row">
          <span
            className="crm-minitrend-swatch"
            style={{ background: 'var(--crm-success)' }}
          />
          Won
        </span>
      </div>
    </div>
  );
}
