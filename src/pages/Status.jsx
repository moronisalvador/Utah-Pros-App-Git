/**
 * ════════════════════════════════════════════════
 * FILE: Status.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A public, read-only page anyone can open without logging in that shows
 *   how far along the new CRM build is — which phases are done, in progress,
 *   or not started, and the checklist of steps inside each one. It's a
 *   public mirror of the internal /crm/roadmap page. Nothing on it can be
 *   clicked to change anything, and it doesn't link into the CRM app or any
 *   other part of UPR.
 *
 * WHERE IT LIVES:
 *   Route:        /status
 *   Rendered by:  src/App.jsx — a public route, outside ProtectedRoute/Layout,
 *                 the same way /login and /privacy render
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/supabase (the unauthenticated `db` singleton — deliberate,
 *              not useAuth()/db, since this page must work for a logged-out
 *              visitor; see CLAUDE.md rule 3's carve-out for public/bootstrapping
 *              calls, same pattern Login.jsx uses for its dev employee list),
 *              @/components/BuildProgressPhaseCard (shared with CrmRoadmap.jsx
 *              so both pages render the same phase/stage progress identically)
 *   Data:      reads  → crm_build_phases, crm_build_stages (via the
 *                       get_crm_build_progress RPC, GRANTED to anon)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This route must stay the ONLY public CRM surface. Do not add other
 *     /crm/* routes outside the page:crm-gated FeatureRoute in App.jsx.
 *   - get_crm_build_progress() only ever returns phase/stage metadata (key,
 *     title, status, done/total counts) — never contact/lead/financial data —
 *     so there is nothing here that needs auth-gating on the data side either.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/supabase';
import PhaseCard from '@/components/BuildProgressPhaseCard';

export default function Status() {
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
  }, []);

  useEffect(() => { load(); }, [load]);

  const overallPct = progress && progress.overall_total > 0
    ? Math.round((progress.overall_done / progress.overall_total) * 100)
    : 0;

  return (
    <div className="status-page">
      <div className="status-page-inner">
        <div className="login-logo">
          <div className="login-logo-icon">U</div>
          <span className="login-logo-text">UPR Platform</span>
        </div>

        <div className="page-header">
          <div>
            <h1 className="page-title">Build Status</h1>
            <p className="page-subtitle">Public, read-only progress on the new CRM build — no login required.</p>
          </div>
        </div>

        {loading && (
          <div className="loading-page"><div className="spinner" /></div>
        )}

        {!loading && (error || !progress) && (
          <div className="empty-state">
            <p className="empty-state-title">Couldn't load build progress</p>
            <p className="empty-state-text">Try refreshing the page.</p>
          </div>
        )}

        {!loading && !error && progress && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
