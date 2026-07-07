/**
 * ════════════════════════════════════════════════
 * FILE: adminMobileAccess.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One tiny yes/no rule that decides whether a person is allowed to see the
 *   admin screens that live inside the field-tech app. The answer is "yes" only
 *   when the person is an admin AND the "Admin Mobile" switch is turned on for
 *   them. Everyone else gets "no". Keeping this rule as its own plain function
 *   (separate from the screen that uses it) lets us test every allow/deny case
 *   without having to render the whole app.
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
 *   - Both conditions must hold: role === 'admin' AND the flag is enabled. The
 *     flag alone (dark-launch) is not enough, and admin alone is not enough.
 *   - The flag resolution (global-on / owner-only dev_only_user_id / per-user
 *     grant) is the caller's job via isFeatureEnabled('page:admin_mobile'); this
 *     function only takes the already-resolved boolean.
 * ════════════════════════════════════════════════
 */

export const ADMIN_MOBILE_FLAG = 'page:admin_mobile';

/**
 * Pure allow/deny decision for the admin-mobile surface.
 * @param {object} args
 * @param {string} [args.role]        employee.role (e.g. 'admin', 'field_tech')
 * @param {boolean} args.flagEnabled  isFeatureEnabled('page:admin_mobile') result
 * @returns {boolean} true only when an admin has the flag enabled
 */
export function canAccessAdminMobile({ role, flagEnabled } = {}) {
  return role === 'admin' && flagEnabled === true;
}
