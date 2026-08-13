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

/**
 * One lead — contact, stage, recording, transcript, activity.
 * A pushed screen rather than a sheet on purpose: the list has to stay a
 * scannable list, and this detail carries five sections that would otherwise
 * become an accordion wall on every row.
 */
export const adminLeadHref = (leadId) =>
  `${ADMIN_MOBILE_BASE}/leads/${leadId}`;

/** Single invoice — view / send / record payment. */
export const adminInvoiceHref = (invoiceId) =>
  `${ADMIN_MOBILE_BASE}/invoice/${invoiceId}`;

/** Start the customer → job flow for a new (or already-existing) job invoice. */
export const adminInvoiceCreateHref = () =>
  `${ADMIN_MOBILE_BASE}/invoice/new`;

/** Edit one invoice line in a pushed, invoice-scoped screen. */
export const adminInvoiceLineHref = (invoiceId, lineId) =>
  `${ADMIN_MOBILE_BASE}/invoice/${invoiceId}/line/${lineId}`;

/** Single-invoice receive payment — one allocation, pushed full-screen flow. */
export const adminInvoicePaymentHref = (invoiceId) =>
  `${ADMIN_MOBILE_BASE}/invoice/${invoiceId}/pay`;

/** Single estimate — view / send / convert. */
export const adminEstimateHref = (estimateId) =>
  `${ADMIN_MOBILE_BASE}/estimate/${estimateId}`;

/** Estimate create shell, plus the legacy id-bearing redirect to detail. */
export const adminEstimateEditorHref = (estimateId) =>
  estimateId
    ? `${ADMIN_MOBILE_BASE}/estimate/${estimateId}/edit`
    : `${ADMIN_MOBILE_BASE}/estimate/new`;

/** Add or edit one estimate line in a pushed, estimate-scoped screen. */
export const adminEstimateLineHref = (estimateId, lineId = 'new') =>
  `${ADMIN_MOBILE_BASE}/estimate/${estimateId}/line/${lineId}`;
