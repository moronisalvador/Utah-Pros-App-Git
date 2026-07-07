/**
 * ════════════════════════════════════════════════
 * FILE: href.js  (admin-mobile link helpers)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single place that knows the web addresses of every admin screen inside
 *   the field-tech app. Instead of typing "/tech/admin/invoice/123" by hand in a
 *   dozen files (easy to get wrong), screens call these little helpers to build
 *   the link. If a route ever moves, we change it here once.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain helper module)
 *   Rendered by:  n/a — imported by the admin-mobile pages/components
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - These strings are the FROZEN route contract for the wave: the subrouter in
 *     AdminMobileRoutes.jsx wires exactly these paths, and list screens deep-link
 *     into detail screens through these helpers (never hardcoded paths).
 *   - ADMIN_MOBILE_BASE is the mount point of AdminMobileRoutes inside the tech
 *     shell; keep it in sync with the delegating <Route> in src/App.jsx.
 * ════════════════════════════════════════════════
 */

export const ADMIN_MOBILE_BASE = '/tech/admin';

/** Admin dashboard (also the index landing of the admin-mobile surface). */
export const adminDashHref = () => `${ADMIN_MOBILE_BASE}/dash`;

/** Collections / AR worklist (aging · invoices · estimates · payments). */
export const adminCollectionsHref = () => `${ADMIN_MOBILE_BASE}/collections`;

/** Lead Center (leads · call playback · transcripts). */
export const adminLeadsHref = () => `${ADMIN_MOBILE_BASE}/leads`;

/** Single invoice — view / send / record payment. */
export const adminInvoiceHref = (invoiceId) =>
  `${ADMIN_MOBILE_BASE}/invoice/${invoiceId}`;

/** Single estimate — view / send / convert. */
export const adminEstimateHref = (estimateId) =>
  `${ADMIN_MOBILE_BASE}/estimate/${estimateId}`;

/**
 * Estimate builder (create + line items). With an id → edit that estimate's
 * line items; without → the create shell for a brand-new estimate.
 */
export const adminEstimateEditorHref = (estimateId) =>
  estimateId
    ? `${ADMIN_MOBILE_BASE}/estimate/${estimateId}/edit`
    : `${ADMIN_MOBILE_BASE}/estimate/new`;
