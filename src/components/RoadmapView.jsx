/**
 * ════════════════════════════════════════════════
 * FILE: RoadmapView.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Draws the roadmap — the overall progress bar plus one card per initiative
 *   (mobile app, schedule, CRM, settings, security, and so on), each with its
 *   own progress bar and checklist. It is purely for display: it takes the
 *   list of initiatives handed to it and paints them. The same component is
 *   used by the public no-login /roadmap page (and stays a standalone
 *   presentational piece so any future roadmap surface can reuse it).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared component)
 *   Rendered by:  src/pages/PublicRoadmap.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/roadmapData (roadmapOverall helper)
 *   Data:      reads  → none (pure presentational — takes `initiatives` as a prop)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Reuses the existing `.crm-roadmap-*` styles in src/index.css so it matches
 *     the CRM build roadmap look and inherits its light/dark token handling.
 *   - Read-only by design: nothing here is clickable-to-change.
 * ════════════════════════════════════════════════
 */
import { roadmapOverall } from '@/lib/roadmapData';

const STATUS_LABEL = { planned: 'Planned', in_progress: 'In Progress', shipped: 'Shipped' };

function InitiativeCard({ init }) {
  const total = init.items.length;
  const done = init.items.filter(i => i.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="card crm-roadmap-phase">
      <div className="card-body">
        <div className="crm-roadmap-phase-head">
          <div>
            <div className="crm-roadmap-phase-title">{init.title}</div>
            {init.summary && <div className="crm-roadmap-phase-shipped">{init.summary}</div>}
          </div>
          <span className={`status-badge crm-roadmap-status-${init.status}`}>
            {STATUS_LABEL[init.status] || init.status}
          </span>
        </div>

        <div className="crm-roadmap-progress-row">
          <div className="crm-roadmap-progress-track">
            <div className="crm-roadmap-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="crm-roadmap-progress-count">{done}/{total}</span>
        </div>

        {init.items.length > 0 && (
          <ul className="crm-roadmap-stage-list">
            {init.items.map((item, i) => (
              <li key={i} className={`crm-roadmap-stage crm-roadmap-stage-${item.done ? 'done' : 'todo'}`}>
                <span className="crm-roadmap-stage-check" aria-hidden="true">{item.done ? '✓' : ''}</span>
                {item.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function RoadmapView({ initiatives }) {
  const overall = roadmapOverall(initiatives);

  return (
    <>
      <div className="card crm-roadmap-overall">
        <div className="card-body">
          <div className="crm-roadmap-progress-row">
            <div className="crm-roadmap-progress-track">
              <div className="crm-roadmap-progress-fill" style={{ width: `${overall.pct}%` }} />
            </div>
            <span className="crm-roadmap-progress-count">{overall.done}/{overall.total} overall</span>
          </div>
        </div>
      </div>

      <div className="crm-roadmap-phase-list">
        {initiatives.map(init => <InitiativeCard key={init.key} init={init} />)}
      </div>
    </>
  );
}
