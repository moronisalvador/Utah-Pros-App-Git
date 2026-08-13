/**
 * ════════════════════════════════════════════════
 * FILE: nativeAdminMobileShim.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that native builds cannot turn on or navigate into the browser-only
 *   admin-mobile area, even for an administrator with the rollout switch on.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/routes/nativeAdminMobileShim.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Server and database authorization still remain independent boundaries;
 *     this test covers only native bundle and navigation behavior.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  ADMIN_MOBILE_BASE,
  AmIcons,
  adminCollectionsHref,
  adminDashHref,
  adminEstimateEditorHref,
  adminEstimateHref,
  adminEstimateLineHref,
  adminInvoiceCreateHref,
  adminInvoiceHref,
  adminLeadsHref,
  canAccessAdminMobile,
} from './nativeAdminMobileShim.js';

describe('nativeAdminMobileShim', () => {
  it.each([
    undefined,
    {},
    { role: 'field_tech', flagEnabled: true },
    { role: 'admin', flagEnabled: false },
    { role: 'admin', flagEnabled: true },
  ])('denies admin-mobile access for %j', (input) => {
    expect(canAccessAdminMobile(input)).toBe(false);
  });

  it('keeps every leftover admin href on the field home', () => {
    expect(ADMIN_MOBILE_BASE).toBe('/tech');
    expect([
      adminDashHref(),
      adminCollectionsHref(),
      adminLeadsHref(),
      adminInvoiceHref('invoice-id'),
      adminInvoiceCreateHref(),
      adminEstimateHref('estimate-id'),
      adminEstimateEditorHref('estimate-id'),
      adminEstimateLineHref('estimate-id', 'line-id'),
    ]).toEqual(Array(8).fill('/tech'));
  });

  it('does not expose admin-mobile implementation icons', () => {
    expect(AmIcons).toEqual({});
    expect(Object.isFrozen(AmIcons)).toBe(true);
  });
});
