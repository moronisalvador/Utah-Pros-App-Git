/**
 * ════════════════════════════════════════════════
 * FILE: PublicRoadmap.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The roadmap page anyone can open WITHOUT logging in that shows everything
 *   the team is working on and how far along each effort is. It lives at the
 *   short public URL /roadmap (utahpros.app/roadmap) and is also linked from
 *   the side menu. Nothing on it can be clicked to change anything, it does not
 *   link into the rest of the app, and it does not read from the UPR database —
 *   the content is a plain hand-kept list baked into the app — so there is no
 *   data or permission to protect.
 *
 * WHERE IT LIVES:
 *   Route:        /roadmap  (the old /roadmap/public redirects here)
 *   Rendered by:  src/App.jsx — a public route, outside ProtectedRoute/Layout,
 *                 the same way /login, /privacy and /status render.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/roadmapData (ROADMAP_INITIATIVES, ROADMAP_UPDATED),
 *              @/components/RoadmapView (shared with the in-app /roadmap page)
 *   Data:      reads  → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - No useAuth(), no db, no RPC on purpose — this must render for a logged-out
 *     visitor. Because it touches no Supabase table, it needs no RLS/permission.
 *   - Reuses the .status-page shell from Status.jsx for a clean standalone look.
 * ════════════════════════════════════════════════
 */
import { ROADMAP_INITIATIVES, ROADMAP_UPDATED } from '@/lib/roadmapData';
import RoadmapView from '@/components/RoadmapView';

export default function PublicRoadmap() {
  return (
    <div className="status-page">
      <div className="status-page-inner">
        <div className="login-logo">
          <div className="login-logo-icon">U</div>
          <span className="login-logo-text">UPR Platform</span>
        </div>

        <div className="page-header">
          <div>
            <h1 className="page-title">Roadmap</h1>
            <p className="page-subtitle">
              What we're building and how far along each effort is — read-only, no login required.
              Updated {ROADMAP_UPDATED}.
            </p>
          </div>
        </div>

        <RoadmapView initiatives={ROADMAP_INITIATIVES} />
      </div>
    </div>
  );
}
