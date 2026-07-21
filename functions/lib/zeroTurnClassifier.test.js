/**
 * ════════════════════════════════════════════════
 * FILE: zeroTurnClassifier.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pure pieces of the zero-turn fallback classifier: how we
 *   format Deepgram's raw flat transcript + summary for the AI when there
 *   are no speaker turns to number, and how we safely read the AI's JSON
 *   answer back — degrading to a safe no-op (never a false spam-flag) on
 *   garbage input.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./zeroTurnClassifier.js
 *
 * NOTES / GOTCHAS:
 *   - Written test-first. The Claude API call itself is impure (in the
 *     worker); everything testable is factored into these pure functions.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { buildZeroTurnPrompt, parseZeroTurnResponse } from './zeroTurnClassifier.js';

describe('buildZeroTurnPrompt', () => {
  it('includes both the raw transcript and the summary when both exist', () => {
    const out = buildZeroTurnPrompt('Thank you for calling Utah Pros.', 'A brief inbound call.');
    expect(out).toContain('Thank you for calling Utah Pros.');
    expect(out).toContain('A brief inbound call.');
  });

  it('uses whichever of rawText/summary is present when only one exists', () => {
    expect(buildZeroTurnPrompt('Some raw words.', null)).toContain('Some raw words.');
    expect(buildZeroTurnPrompt('', 'Just a summary.')).toContain('Just a summary.');
    expect(buildZeroTurnPrompt(null, 'Just a summary.')).toContain('Just a summary.');
  });

  it('returns "" when there is nothing usable at all', () => {
    expect(buildZeroTurnPrompt('', '')).toBe('');
    expect(buildZeroTurnPrompt(null, null)).toBe('');
    expect(buildZeroTurnPrompt('   ', '   ')).toBe('');
    expect(buildZeroTurnPrompt(undefined, undefined)).toBe('');
  });
});

describe('parseZeroTurnResponse', () => {
  it('reads caller_never_responded true from a clean JSON object', () => {
    expect(parseZeroTurnResponse('{"caller_never_responded":true,"is_customer_inquiry":true}')).toEqual({
      callerNeverResponded: true,
      isCustomerInquiry: true,
    });
  });

  it('reads caller_never_responded false from a clean JSON object', () => {
    expect(parseZeroTurnResponse('{"caller_never_responded":false,"is_customer_inquiry":true}')).toEqual({
      callerNeverResponded: false,
      isCustomerInquiry: true,
    });
  });

  it('extracts JSON out of markdown fences or surrounding prose', () => {
    const fenced = '```json\n{"caller_never_responded":true,"is_customer_inquiry":true}\n```';
    expect(parseZeroTurnResponse(fenced)).toEqual({ callerNeverResponded: true, isCustomerInquiry: true });
    const chatty = 'Sure! Here is the result:\n{"caller_never_responded":true,"is_customer_inquiry":true}\nHope that helps.';
    expect(parseZeroTurnResponse(chatty)).toEqual({ callerNeverResponded: true, isCustomerInquiry: true });
  });

  it('reads caller_never_responded leniently — only a literal true counts, anything else (or missing) is false', () => {
    expect(parseZeroTurnResponse('{"caller_never_responded":"true"}').callerNeverResponded).toBe(false);
    expect(parseZeroTurnResponse('{"caller_never_responded":1}').callerNeverResponded).toBe(false);
    expect(parseZeroTurnResponse('{}').callerNeverResponded).toBe(false);
    expect(parseZeroTurnResponse('{"other_field":"x"}').callerNeverResponded).toBe(false);
  });

  it('reads is_customer_inquiry leniently in the OPPOSITE direction — only a literal false counts, anything else (or missing) defaults to true', () => {
    expect(parseZeroTurnResponse('{"is_customer_inquiry":false}').isCustomerInquiry).toBe(false);
    expect(parseZeroTurnResponse('{"is_customer_inquiry":"false"}').isCustomerInquiry).toBe(true);
    expect(parseZeroTurnResponse('{"is_customer_inquiry":0}').isCustomerInquiry).toBe(true);
    expect(parseZeroTurnResponse('{}').isCustomerInquiry).toBe(true);
    expect(parseZeroTurnResponse('{"other_field":"x"}').isCustomerInquiry).toBe(true);
  });

  it('returns null on garbage / no JSON / blank input — never a false positive from an unparseable answer', () => {
    expect(parseZeroTurnResponse('nope')).toBeNull();
    expect(parseZeroTurnResponse('')).toBeNull();
    expect(parseZeroTurnResponse(null)).toBeNull();
    expect(parseZeroTurnResponse(undefined)).toBeNull();
    expect(parseZeroTurnResponse('   ')).toBeNull();
  });
});
