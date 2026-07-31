/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingAccess.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps one list of the employee roles allowed to use the OOP calculator.
 *   Navigation, direct routes, and the field menu all read this same list.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - `estimator` is UPR's employee-role value for a sales representative.
 *   - This client mirror controls visibility and routing only. The database RPCs
 *     independently enforce the same roles before exposing quotes or rates.
 * ════════════════════════════════════════════════
 */

export const OOP_PRICING_ROLES = Object.freeze([
  'admin',
  'office',
  'supervisor',
  'estimator',
  'project_manager',
]);

export function canUseOopPricing(role) {
  return OOP_PRICING_ROLES.includes(role);
}
