/**
 * ════════════════════════════════════════════════
 * FILE: PipelineStageCard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   An Overview card that shows the sales pipeline at a glance. On one side a
 *   donut splits the open leads by which stage they are sitting in; on the other
 *   a short list names each stage, how many leads are in it, a little bar showing
 *   the dollars in that stage relative to the biggest one, and the stage's dollar
 *   total. The header shows the "weighted open pipeline" — the expected dollar
 *   value of everything still open. If there are no open leads, it just says so.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a presentational slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx (built in a later phase)
 *
 * DEPENDS ON:
 *   Packages:  react (none directly — pure props render)
 *   Internal:  @/components/crm/charts/Donut (the donut chart),
 *              @/lib/crmCharts (paletteColor),
 *              @/lib/attribution (fmtMoney)
 *   Data:      reads → none · writes → none
 *              (purely presentational — all data arrives via props; the page
 *               loads it, this component never calls useAuth/db or any RPC)
 *
 * NOTES / GOTCHAS:
 *   - `rows` is one entry per OPEN pipeline stage: {id, name, color, count,
 *     value}. `color` is the stage's DB hex or null — when null we fall back to
 *     paletteColor(i) so the donut and the list agree on the same color.
 *   - The horizontal bar width is value/maxValue, so it is a relative-to-largest
 *     read, not an absolute one. maxValue guards against divide-by-zero.
 *   - Static only — no animation, no @keyframes (motion-review gate).
 * ════════════════════════════════════════════════
 */
import Donut from '@/components/crm/charts/Donut';
import { paletteColor } from '@/lib/crmCharts';
import { fmtMoney } from '@/lib/attribution';

export default function PipelineStageCard({ rows, openTotalValue }) {
  const stages = Array.isArray(rows) ? rows : [];
  const hasStages = stages.length > 0;

  // ─── SECTION: Helpers ──────────────
  const stageColor = (row, i) => row?.color || paletteColor(i);
  const totalCount = stages.reduce((sum, r) => sum + (Number(r?.count) || 0), 0);
  const maxValue = stages.reduce((max, r) => Math.max(max, Number(r?.value) || 0), 0);

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
        <div className="crm-pipeline-total">
          <span className="crm-pipeline-total-val">{fmtMoney(openTotalValue)}</span>
          <span className="crm-note">weighted open pipeline</span>
        </div>
      </div>

      {!hasStages ? (
        <p className="crm-note">No open pipeline yet.</p>
      ) : (
        <div className="crm-pipeline-layout">
          <Donut
            segments={donutSegments}
            total={totalCount}
            label="LEADS"
            size={128}
          />

          <ul className="crm-pipeline-rows">
            {stages.map((r, i) => {
              const value = Number(r.value) || 0;
              const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
              return (
                <li key={r.id ?? i} className="crm-pipeline-row">
                  <span className="crm-pipeline-name">{r.name}</span>
                  <span className="crm-pipeline-count">{Number(r.count) || 0}</span>
                  <span className="crm-pipeline-bar-track">
                    <span
                      className="crm-pipeline-bar-fill"
                      style={{ width: `${pct}%`, background: stageColor(r, i) }}
                    />
                  </span>
                  <span className="crm-pipeline-val">{fmtMoney(value)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
