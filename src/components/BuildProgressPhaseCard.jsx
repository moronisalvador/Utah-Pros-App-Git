/**
 * ════════════════════════════════════════════════
 * FILE: BuildProgressPhaseCard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Draws one phase card — its title, status badge, progress bar, and
 *   checklist of steps — for the CRM build-progress trackers. Shared so the
 *   internal `/crm/roadmap` page and the public `/status` page always render
 *   the exact same look for the exact same data, instead of two copies that
 *   could quietly drift apart.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared component, not a routed page)
 *   Rendered by:  src/pages/crm/CrmRoadmap.jsx, src/pages/Status.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      reads  → none (pure presentational — takes a `phase` object
 *                       from get_crm_build_progress() as a prop)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - CSS lives in src/index.css under the `.crm-roadmap-*` block (plain app
 *     tokens, not the `.crm-shell`-scoped `--crm-*` tokens — this card is
 *     used outside the CRM shell too, on the public page).
 * ════════════════════════════════════════════════
 */
const STATUS_LABEL = { planned: 'Planned', in_progress: 'In Progress', shipped: 'Shipped' };

export default function BuildProgressPhaseCard({ phase }) {
  const pct = phase.total_count > 0 ? Math.round((phase.done_count / phase.total_count) * 100) : 0;
  return (
    <div className="card crm-roadmap-phase">
      <div className="card-body">
        <div className="crm-roadmap-phase-head">
          <div>
            <div className="crm-roadmap-phase-title">Phase {phase.phase_key} — {phase.title}</div>
            {phase.shipped_at && (
              <div className="crm-roadmap-phase-shipped">Shipped {new Date(phase.shipped_at).toLocaleDateString()}</div>
            )}
          </div>
          <span className={`status-badge crm-roadmap-status-${phase.status}`}>{STATUS_LABEL[phase.status] || phase.status}</span>
        </div>

        <div className="crm-roadmap-progress-row">
          <div className="crm-roadmap-progress-track">
            <div className="crm-roadmap-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="crm-roadmap-progress-count">{phase.done_count}/{phase.total_count}</span>
        </div>

        {phase.stages.length > 0 && (
          <ul className="crm-roadmap-stage-list">
            {phase.stages.map(stage => (
              <li key={stage.id} className={`crm-roadmap-stage crm-roadmap-stage-${stage.status}`}>
                <span className="crm-roadmap-stage-check" aria-hidden="true">{stage.status === 'done' ? '✓' : ''}</span>
                {stage.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
