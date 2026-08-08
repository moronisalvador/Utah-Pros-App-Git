/**
 * ════════════════════════════════════════════════
 * FILE: adminMobileAccess.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the admin-mobile allow/deny rule: only an admin with the "Admin
 *   Mobile" switch on may enter. A non-admin is denied even with the switch on,
 *   and an admin is denied while the switch is off (the dark-launch guarantee).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./adminMobileAccess.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { canAccessAdminMobile, ADMIN_MOBILE_FLAG, ADMIN_MOBILE_ROLES } from './adminMobileAccess.js';

describe('canAccessAdminMobile — allow/deny matrix', () => {
  it.each(['admin', 'office', 'project_manager'])('ALLOWS %s when the flag is enabled', (role) => {
    expect(canAccessAdminMobile({ role, flagEnabled: true })).toBe(true);
  });

  it.each(['admin', 'office', 'project_manager'])('DENIES %s when the flag is disabled (dark-launch off)', (role) => {
    expect(canAccessAdminMobile({ role, flagEnabled: false })).toBe(false);
  });

  // The roles this widening is NOT about. supervisor and estimator matter most:
  // they are internal office-shell users who land on the Dashboard, so it would
  // be easy to assume they belong here. They do not — the money screens behind
  // this gate are server-gated to the billing three, so admitting them would
  // render surfaces the database refuses.
  it.each(['field_tech', 'crm_partner', 'supervisor', 'estimator'])(
    'DENIES %s even when the flag is enabled',
    (role) => {
      expect(canAccessAdminMobile({ role, flagEnabled: true })).toBe(false);
    },
  );

  it('DENIES an unknown or misspelled role', () => {
    expect(canAccessAdminMobile({ role: 'manager', flagEnabled: true })).toBe(false);
    expect(canAccessAdminMobile({ role: 'Office', flagEnabled: true })).toBe(false);
  });

  it('names exactly the three office roles, and never widens by accident', () => {
    expect([...ADMIN_MOBILE_ROLES].sort()).toEqual(['admin', 'office', 'project_manager']);
  });

  it('DENIES when role is missing', () => {
    expect(canAccessAdminMobile({ flagEnabled: true })).toBe(false);
  });

  it('DENIES when called with no arguments', () => {
    expect(canAccessAdminMobile()).toBe(false);
  });

  it('treats a non-boolean/truthy flag value as deny (must be strictly true)', () => {
    expect(canAccessAdminMobile({ role: 'admin', flagEnabled: undefined })).toBe(false);
    expect(canAccessAdminMobile({ role: 'admin', flagEnabled: 'yes' })).toBe(false);
  });

  it('exposes the canonical flag key', () => {
    expect(ADMIN_MOBILE_FLAG).toBe('page:admin_mobile');
  });
});
