/**
 * ════════════════════════════════════════════════
 * FILE: CrmLayout.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The wrapper shell for every page under /crm. Right now it doesn't add
 *   anything visible — it just gives the CRM section of the app a single
 *   place to plug in a real sidebar and header later, without having to
 *   rewire routing again. Each CRM page renders as if it were a normal page.
 *
 * WHERE IT LIVES:
 *   Route:        wraps /crm/* (pathless layout route)
 *   Rendered by:  src/App.jsx (inside the main Layout's <Outlet/>)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (Outlet)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Deliberately bare for CRM Phase 0 (docs/crm-roadmap.md) — the real
 *     designed shell (contextual left sidebar, --crm-* scoped design tokens,
 *     SVG icon set) is Phase 1's job. This just establishes the route seam.
 *   - The whole /crm/* tree is gated by <FeatureRoute flag="page:crm"> in
 *     App.jsx, not by anything in this component.
 * ════════════════════════════════════════════════
 */
import { Outlet } from 'react-router-dom';

export default function CrmLayout() {
  return <Outlet />;
}
