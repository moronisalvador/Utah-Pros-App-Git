/**
 * ════════════════════════════════════════════════
 * FILE: sms-consent.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the cheap automated-SMS gate requires a phone and recorded opt-in,
 *   and refuses Do Not Disturb or explicit opt-out.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./sms-consent.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { consentAllows } from './sms-consent.js';

describe('consentAllows (SMS/TCPA)', () => {
  it('allows an opted-in, non-DND contact with a phone', () => {
    expect(consentAllows({
      phone: '+18014471917',
      opt_in_status: true,
      opt_out_at: null,
      dnd: false,
    })).toBe(true);
  });

  it('blocks when there is no phone number', () => {
    expect(consentAllows({ phone: null, opt_in_status: true, dnd: false })).toBe(false);
    expect(consentAllows({ phone: '', opt_in_status: true, dnd: false })).toBe(false);
  });

  it('blocks a Do Not Disturb contact even if opted in', () => {
    expect(consentAllows({ phone: '+18014471917', opt_in_status: true, dnd: true })).toBe(false);
  });

  it('blocks an explicit opt-out even if the legacy opt-in boolean is stale true', () => {
    expect(consentAllows({
      phone: '+18014471917',
      opt_in_status: true,
      opt_out_at: '2026-07-23T18:00:00.000Z',
      dnd: false,
    })).toBe(false);
  });

  it('blocks automated traffic without recorded opt-in', () => {
    expect(consentAllows({ phone: '+18014471917', opt_in_status: false, dnd: false })).toBe(false);
    expect(consentAllows({ phone: '+18014471917', opt_in_status: null, dnd: false })).toBe(false);
    expect(consentAllows({ phone: '+18014471917' })).toBe(false);
  });

  it('still blocks an objection even with no recorded opt-in', () => {
    expect(consentAllows({ phone: '+18014471917', opt_in_status: false, dnd: true })).toBe(false);
    expect(consentAllows({
      phone: '+18014471917',
      opt_in_status: false,
      opt_out_at: '2026-07-23T18:00:00.000Z',
    })).toBe(false);
  });

  it('blocks a null/undefined row', () => {
    expect(consentAllows(null)).toBe(false);
    expect(consentAllows(undefined)).toBe(false);
  });
});
