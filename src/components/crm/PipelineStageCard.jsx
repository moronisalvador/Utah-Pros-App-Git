/**
 * ════════════════════════════════════════════════
 * FILE: PipelineStageCard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   An Overview card that shows the sales pipeline at a glance. A donut ring
 *   shows the open-lead count and the relative size of each stage at a glance;
 *   a color-matched bar list beside it names each stage, its share of the open
 *   pipeline, and its count — the ONE place that breakdown is spelled out (the
 *   donut's own legend is turned off here so the same numbers aren't printed
 *   twice). The header shows the honest win rate — of the leads that reached a
 *   decision (won or lost), how many were won — plus the won/lost/open
 *   tallies. If there are no leads at all, it just says so.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a presentational slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (none directly — pure props render)
 *   Internal:  @/components/crm/charts/Donut (the donut chart),
 *              @/lib/crmCharts (paletteColor),
 *              @/lib/attribution (fmtPct)
 *   Data:      reads → none · writes → none
 *              (purely presentational — all data arrives via props; the page
 *               loads it, this component never calls useAuth/db or any RPC)
 *
 * NOTES / GOTCHAS:
 *   - This card is COUNT-based, deliberately: inbound leads carry no dollar
 *     `value` in this business (they are valued only once they become a job),
 *     so a weighted-$ pipeline is structurally $0 and was removed. Counts are
 *     the meaningful read here.
 *   - `rows` is one entry per OPEN pipeline stage: {id, name, color, count}.
 *     `color` is the stage's DB hex or null — when null we fall back to
 *     paletteColor(i) so the donut ring and the row's bar always agree on the
 *     same color (the donut's own legend is off — see showLegend below).
 *   - The bar width is count/maxCount (relative-to-largest, guarded against
 *     divide-by-zero) — a DIFFERENT read from the % shown beside the count
 *     (count/openCount, share-of-total). Both are shown because they answer
 *     different questions; showing only one would lose real information.
 *     `winRate` may be null (nothing decided yet) → "—".
 *   - Static only — no animation, no @keyframes (motion-review gate).
 * ════════════════════════════════════════════════
 */
import Donut from '@/components/crm/charts/Donut';
import { paletteColor } from '@/lib/crmCharts';
import { fmtPct } from '@/lib/attribution';

export default function PipelineStageCard({ rows, won = 0, lost = 0, winRate = null }) {
  const stages = Array.isArray(rows) ? rows : [];
  const hasStages = stages.length > 0;

  // ─── SECTION: Helpers ──────────────
  const stageColor = (row, i) => row?.color || paletteColor(i);
  const openCount = stages.reduce((sum, r) => sum + (Number(r?.count) || 0), 0);
  const maxCount = stages.reduce((max, r) => Math.max(max, Number(r?.count) || 0), 0);

  const donutSegments = stages.map((r, i) => ({
    label: r.name,
    value: Number(r.count) || 0,
    color: stageColor(r, i),
  }));

  // ─── SECTION: Render ──────────────
  return (
    <section className="crm-card crm-pipeline-card">
      <div className="crm-pipeline-header">
        <h2 className="crm-section-title">Sales pipeline</h2>
        <div className="crm-pipeline-summary">
          <span className="crm-pipeline-winrate">{fmtPct(winRate)}</span>
          <span className="crm-note">
            win rate · {won} won · {lost} lost · {openCount} open
          </span>
        </div>
      </div>

      {!hasStages ? (
        <p className="crm-note">No open leads in the pipeline right now.</p>
      ) : (
        <div className="crm-pipeline-layout">
          <Donut segments={donutSegments} total={openCount} label="OPEN" size={128} showLegend={false} />

          <ul className="crm-pipeline-rows">
            {stages.map((r, i) => {
              const count = Number(r.count) || 0;
              const barPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
              const sharePct = openCount > 0 ? Math.round((count / openCount) * 100) : 0;
              return (
                <li key={r.id ?? i} className="crm-pipeline-row">
                  <span className="crm-pipeline-name">{r.name}</span>
                  <span className="crm-pipeline-bar-track">
                    <span
                      className="crm-pipeline-bar-fill"
                      style={{ width: `${barPct}%`, background: stageColor(r, i) }}
                    />
                  </span>
                  <span className="crm-pipeline-count">{count}</span>
                  <span className="crm-pipeline-share">{sharePct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
