/**
 * ════════════════════════════════════════════════
 * FILE: twilio-errors.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Twilio error-code map turns each raw code into the right decision:
 *   an opt-out (21610) and an unreachable number (30006) suppress AND flag the
 *   contact, while a carrier filter (30007) and an unregistered A2P sender (30034)
 *   do NOT blame the contact. Also proves unknown/blank codes fall back safely.
 *   A pure unit test (no database) — committed with the map it tests (test-first).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio-errors.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { classifyTwilioError, TWILIO_ERROR_CODES, DEFAULT_TWILIO_ERROR } from './twilio-errors.js';

describe('classifyTwilioError', () => {
  it('21610 STOP → suppress + opt_out + blocked', () => {
    const r = classifyTwilioError(21610);
    expect(r.code).toBe(21610);
    expect(r.suppress).toBe(true);
    expect(r.contactFlag).toBe('opt_out');
    expect(r.uiClass).toBe('blocked');
  });

  it('30006 landline/unreachable → suppress + invalid_number + unreachable', () => {
    const r = classifyTwilioError(30006);
    expect(r.suppress).toBe(true);
    expect(r.contactFlag).toBe('invalid_number');
    expect(r.uiClass).toBe('unreachable');
  });

  it('30007 carrier filter → NOT suppressed, no contact flag, carrier', () => {
    const r = classifyTwilioError(30007);
    expect(r.suppress).toBe(false);
    expect(r.contactFlag).toBeNull();
    expect(r.uiClass).toBe('carrier');
  });

  it('30034 unregistered A2P sender → NOT suppressed, no contact flag, config', () => {
    const r = classifyTwilioError(30034);
    expect(r.suppress).toBe(false);
    expect(r.contactFlag).toBeNull();
    expect(r.uiClass).toBe('config');
  });

  it('accepts a string code (as Twilio sends it in webhook form fields)', () => {
    expect(classifyTwilioError('30007')).toBe(TWILIO_ERROR_CODES[30007]);
    expect(classifyTwilioError(' 21610 ')).toBe(TWILIO_ERROR_CODES[21610]);
  });

  it('unknown / blank / null codes fall back to DEFAULT (never suppress, no flag)', () => {
    for (const c of [null, undefined, '', 'abc', 99999, 0]) {
      const r = classifyTwilioError(c);
      expect(r).toBe(DEFAULT_TWILIO_ERROR);
      expect(r.suppress).toBe(false);
      expect(r.contactFlag).toBeNull();
      expect(r.uiClass).toBe('error');
    }
  });

  it('the four roadmap-required codes are all present', () => {
    for (const code of [21610, 30006, 30007, 30034]) {
      expect(TWILIO_ERROR_CODES[code]).toBeTruthy();
      expect(TWILIO_ERROR_CODES[code].code).toBe(code);
    }
  });
});
