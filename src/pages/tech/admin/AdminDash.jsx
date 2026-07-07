/**
 * ════════════════════════════════════════════════
 * FILE: AdminDash.jsx  (Admin Mobile — Dashboard STUB)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The admin dashboard screen inside the field-tech app — but right now it's an
 *   empty placeholder. Foundation ships this shell so the route, the menu link,
 *   and the admin/flag gating can all be wired and tested; the real dashboard
 *   (revenue, jobs, AR, etc.) is filled in by a later phase (P1).
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/dash  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  @/components/admin-mobile (AdminMobilePage)
 *   Data:      reads → none yet (P1 wires the widget RPCs) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - STUB: no feature logic. P1 owns this file next and must reproduce the
 *     canAccess('overview_financials') gate for financial widgets (finding F-2).
 * ════════════════════════════════════════════════
 */
import { AdminMobilePage } from '@/components/admin-mobile';

export default function AdminDash() {
  return (
    <AdminMobilePage title="Admin Dashboard" subtitle="Field admin overview">
      <div className="am-stub">Dashboard coming soon.</div>
    </AdminMobilePage>
  );
}
