/**
 * ════════════════════════════════════════════════
 * FILE: AuthContext.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Supplies a fake signed-in field technician to the Notifications Settings
 *   browser fixture without using a real account or database connection.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → synthetic fixture state only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This file is loaded only through exact aliases in the local QA runner.
 * ════════════════════════════════════════════════
 */
export function useAuth() {
  return {
    db: {},
    employee: { id: 'fixture-employee', role: 'field_tech' },
    isFeatureEnabled: () => true,
    pwaOwnerLease: { owner: 'v1.synthetic-owner-lease' },
  };
}
