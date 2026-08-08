/**
 * ════════════════════════════════════════════════
 * FILE: adminMobileAccess.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One tiny yes/no rule that decides whether a person is allowed to see the
 *   admin screens that live inside the mobile app. The answer is "yes" only when
 *   the person holds an office role AND the "Admin Mobile" switch is turned on
 *   for them. Everyone else gets "no". Keeping this rule as its own plain
 *   function (separate from the screen that uses it) lets us test every
 *   allow/deny case without having to render the whole app.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain rule module, not a screen)
 *   Rendered by:  n/a — imported by AdminMobileRoute.jsx (the route guard)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Both conditions must hold: the role is in ADMIN_MOBILE_ROLES AND the flag
 *     is enabled. The flag alone (dark-launch) is not enough, and the role alone
 *     is not enough.
 *   - The flag resolution (global-on / owner-only dev_only_user_id / per-user
 *     grant) is the caller's job via isFeatureEnabled('page:admin_mobile'); this
 *     function only takes the already-resolved boolean.
 *   - This is a PRESENTATION boundary — it decides which shell renders, not what
 *     the database will answer. The money screens behind it are separately gated
 *     server-side by public.billing_edit_access()
 *     (20260807230000_office_financial_read_boundary, ledger 20260808050037), and
 *     that gate is the one that actually protects the data.
 * ════════════════════════════════════════════════
 */

export const ADMIN_MOBILE_FLAG = 'page:admin_mobile';

/**
 * Who may render the admin surfaces inside the mobile app.
 *
 * Widened from `admin` only on 2026-08-08 under the owner's 2026-08-07 decision
 * that the mobile app is role-adaptive — "it has tech only tools for tech users
 * but also has admin tools, for other roles" — and that office and
 * project_manager own accounts receivable.
 *
 * Its own constant, NOT a reuse of BILLING_EDIT_ROLES, despite having the same
 * three members today. Same reasoning the repository already applied when
 * PAYOUT_MANAGE_ROLES had to be split back out of billing: "may see the admin
 * screens on a phone" and "may edit billing" are different questions that happen
 * to have the same answer right now. Sharing one array would mean the next
 * widening of either silently widens the other — if supervisor ever gains the
 * mobile ops screens, they must not thereby gain invoice editing.
 * tests/qa/unit/billing-role-surface-parity.test.js pins the two together so the
 * day they diverge is visible rather than silent.
 */
export const ADMIN_MOBILE_ROLES = Object.freeze(['admin', 'office', 'project_manager']);

/**
 * Pure allow/deny decision for the admin-mobile surface.
 * @param {object} args
 * @param {string} [args.role]        employee.role (e.g. 'admin', 'field_tech')
 * @param {boolean} args.flagEnabled  isFeatureEnabled('page:admin_mobile') result
 * @returns {boolean} true only when an office role has the flag enabled
 */
export function canAccessAdminMobile({ role, flagEnabled } = {}) {
  return ADMIN_MOBILE_ROLES.includes(role) && flagEnabled === true;
}
