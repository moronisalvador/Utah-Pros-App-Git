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
import { canAccessAdminMobile, ADMIN_MOBILE_FLAG } from './adminMobileAccess.js';

describe('canAccessAdminMobile — allow/deny matrix', () => {
  it('ALLOWS an admin when the flag is enabled', () => {
    expect(canAccessAdminMobile({ role: 'admin', flagEnabled: true })).toBe(true);
  });

  it('DENIES an admin when the flag is disabled (dark-launch off)', () => {
    expect(canAccessAdminMobile({ role: 'admin', flagEnabled: false })).toBe(false);
  });

  it('DENIES a field_tech even when the flag is enabled', () => {
    expect(canAccessAdminMobile({ role: 'field_tech', flagEnabled: true })).toBe(false);
  });

  it('DENIES a crm_partner even when the flag is enabled', () => {
    expect(canAccessAdminMobile({ role: 'crm_partner', flagEnabled: true })).toBe(false);
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
