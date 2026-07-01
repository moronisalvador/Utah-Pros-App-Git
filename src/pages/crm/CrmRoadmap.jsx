/**
 * ════════════════════════════════════════════════
 * FILE: CrmRoadmap.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows exactly where the CRM build stands right now — every phase, whether
 *   it's done, in progress, or not started yet, and the checklist of
 *   sub-steps inside each one. This page is the single place to look instead
 *   of trying to remember (or dig through git history) what's been built.
 *   Read-only — nothing on this page can be clicked to change anything.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/roadmap
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads  → crm_build_phases, crm_build_stages (via the
 *                       get_crm_build_progress RPC)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is the CRM build's system of record for progress — no external
 *     tracker (Asana/Trello). Every phase updates its own status/stage rows
 *     via set_crm_phase_status / set_crm_stage_status at close-out, and this
 *     page just reflects that.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_LABEL = { planned: 'Planned', in_progress: 'In Progress', shipped: 'Shipped' };

function PhaseCard({ phase }) {
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

export default function CrmRoadmap() {
  const { db } = useAuth();
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await db.rpc('get_crm_build_progress');
      setProgress(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  if (error || !progress) {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="empty-state-title">Couldn't load build progress</p>
          <p className="empty-state-text">Try refreshing the page.</p>
        </div>
      </div>
    );
  }

  const overallPct = progress.overall_total > 0
    ? Math.round((progress.overall_done / progress.overall_total) * 100)
    : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">CRM Build Roadmap</h1>
          <p className="page-subtitle">Where the CRM build stands — the single source of truth, not an external tracker.</p>
        </div>
      </div>

      <div className="card crm-roadmap-overall">
        <div className="card-body">
          <div className="crm-roadmap-progress-row">
            <div className="crm-roadmap-progress-track">
              <div className="crm-roadmap-progress-fill" style={{ width: `${overallPct}%` }} />
            </div>
            <span className="crm-roadmap-progress-count">{progress.overall_done}/{progress.overall_total} overall</span>
          </div>
        </div>
      </div>

      <div className="crm-roadmap-phase-list">
        {progress.phases.map(phase => <PhaseCard key={phase.phase_key} phase={phase} />)}
      </div>
    </div>
  );
}
