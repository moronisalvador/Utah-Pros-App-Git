/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingAccess.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the OOP calculator to the five roles approved by the owner and proves
 *   ordinary technicians and external or unknown identities stay excluded.
 *
 * DEPENDS ON:
 *   Packages:  Vitest
 *   Internal:  ./oopPricingAccess.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The database migration has its own role matrix tests; this is the client
 *     navigation/direct-route mirror only.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { canUseOopPricing, OOP_PRICING_ROLES } from './oopPricingAccess';

describe('OOP pricing role boundary', () => {
  it.each(['admin', 'office', 'supervisor', 'estimator', 'project_manager'])(
    'admits %s',
    (role) => expect(canUseOopPricing(role)).toBe(true),
  );

  it.each(['field_tech', 'crm_partner', null, undefined, '', 'manager'])(
    'denies %s',
    (role) => expect(canUseOopPricing(role)).toBe(false),
  );

  it('keeps the shared allowlist immutable', () => {
    expect(Object.isFrozen(OOP_PRICING_ROLES)).toBe(true);
  });
});
