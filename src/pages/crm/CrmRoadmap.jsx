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
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/components/BuildProgressPhaseCard (shared with src/pages/Status.jsx —
 *              the public /status page renders this same progress via the anon client)
 *   Data:      reads  → crm_build_phases, crm_build_stages (via the
 *                       get_crm_build_progress RPC)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is the CRM build's system of record for progress — no external
 *     tracker (Asana/Trello). Every phase updates its own status/stage rows
 *     via set_crm_phase_status / set_crm_stage_status at close-out, and this
 *     page just reflects that.
 *   - Dark mode is local to this page only (a `.crm-roadmap-page.dark`
 *     wrapper re-points the same `--bg-*`/`--text-*`/`--border-*` custom
 *     properties `.page`/`.card`/`.status-badge` already read — same scoped-
 *     token-override trick as `.tech-layout`/`.crm-shell`) — it defaults on
 *     and is plain component state (no `localStorage`), so it resets on
 *     reload rather than persisting, per the app's no-localStorage-for-state
 *     rule.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PhaseCard from '@/components/BuildProgressPhaseCard';

export default function CrmRoadmap() {
  const { db, employee } = useAuth();
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dark, setDark] = useState(true);

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

  // Internal build-status page — not for the marketing-agency CRM partner
  // role. CrmLayout already hides the sidebar link; this is the direct-URL
  // backstop, matching the layout-level redirect in Layout.jsx.
  if (employee?.role === 'crm_partner') return <Navigate to="/crm/leads" replace />;

  const pageClass = `crm-roadmap-page${dark ? ' dark' : ''}`;

  if (loading) return <div className={pageClass}><div className="loading-page"><div className="spinner" /></div></div>;

  if (error || !progress) {
    return (
      <div className={pageClass}>
        <div className="page">
          <div className="empty-state">
            <p className="empty-state-title">Couldn't load build progress</p>
            <p className="empty-state-text">Try refreshing the page.</p>
          </div>
        </div>
      </div>
    );
  }

  const overallPct = progress.overall_total > 0
    ? Math.round((progress.overall_done / progress.overall_total) * 100)
    : 0;

  return (
    <div className={pageClass}>
      <div className="page">
        <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
          <div>
            <h1 className="page-title">CRM Build Roadmap</h1>
            <p className="page-subtitle">Where the CRM build stands — the single source of truth, not an external tracker.</p>
          </div>
          <button
            type="button"
            className="crm-roadmap-theme-toggle"
            onClick={() => setDark(d => !d)}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
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
    </div>
  );
}
