/**
 * ════════════════════════════════════════════════
 * FILE: owner.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One tiny helper that answers "is this the owner (Moroni)?". Several screens
 *   show owner-only links (Dev Tools, Homebuilding) or gate owner-only surfaces.
 *   Before this, six files each hardcoded the same email string; now they all
 *   ask this one function so the rule lives in a single place.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain helper module, not a screen)
 *   Rendered by:  n/a — imported by nav shells, SettingsLayout, App route guards
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The owner account is moroni@utah-pros.com. NOTE: moroni.s@utah-pros.com is
 *     a separate TEST account and is deliberately NOT the owner.
 * ════════════════════════════════════════════════
 */

export const OWNER_EMAIL = 'moroni@utah-pros.com';

/** True when the given employee record is the platform owner. */
export function isMoroni(employee) {
  return employee?.email === OWNER_EMAIL;
}
