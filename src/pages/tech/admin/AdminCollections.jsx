/**
 * ════════════════════════════════════════════════
 * FILE: AdminCollections.jsx  (Admin Mobile — Collections/AR STUB)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The collections / accounts-receivable screen inside the field-tech app — an
 *   empty placeholder for now. Foundation ships this shell so the route and menu
 *   entry work; the real worklist (AR aging, invoices, estimates, payments) and
 *   its deep-links into invoice/estimate detail are filled in by phase P2.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/collections  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  @/components/admin-mobile (AdminMobilePage)
 *   Data:      reads → none yet (P2 wires get_ar_invoices etc.) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - STUB: no feature logic. P2 owns this file next; AR/ledger content must
 *     reproduce the canAccess('overview_financials') gate (finding F-2).
 * ════════════════════════════════════════════════
 */
import { AdminMobilePage } from '@/components/admin-mobile';

export default function AdminCollections() {
  return (
    <AdminMobilePage title="Collections" subtitle="Accounts receivable">
      <div className="am-stub">Collections coming soon.</div>
    </AdminMobilePage>
  );
}
