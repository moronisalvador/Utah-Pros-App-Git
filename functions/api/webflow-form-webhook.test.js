/**
 * ════════════════════════════════════════════════
 * FILE: webflow-form-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two pure pieces of the Webflow lead-webhook's routing logic:
 *   (1) which registered UPR form (and schema) a submission's field shape maps
 *   to — the R2 site design vs. the still-live legacy pages — and (2) whether
 *   the visitor ticked the SMS-consent checkbox, regardless of which of the
 *   two casings ("SMS-consent" vs "SMS-Consent") or value shape (boolean vs.
 *   the string a real Webflow POST delivers) it arrives as.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./webflow-form-webhook.js (resolveForm, consentFromData,
 *              R2_FORM_ID, LEGACY_FORM_ID)
 *
 * NOTES / GOTCHAS:
 *   - Only the pure helpers are unit-tested; the handler's DB writes/side
 *     effects are integration territory — same convention as
 *     twilio-webhook.test.js / callrail-webhook (see forms.test.js for the
 *     shared isTruthy behavior this leans on).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { resolveForm, consentFromData, R2_FORM_ID, LEGACY_FORM_ID } from './webflow-form-webhook.js';

describe('resolveForm (R2 vs legacy shape detection)', () => {
  it('routes an R2-shaped submission to the R2 form id', () => {
    const data = { 'Full-name': 'Jane Doe', Phone: '3855551234', Email: 'jane@example.com', Mold: 'true' };
    expect(resolveForm(data)).toEqual({ formId: R2_FORM_ID, schema: expect.any(Object) });
  });

  it('routes a legacy-shaped submission to the legacy form id', () => {
    const data = { Name: 'Jane Doe', 'Phone Number': '3855551234', 'Kind of damage': 'Mold' };
    expect(resolveForm(data)).toEqual({ formId: LEGACY_FORM_ID, schema: expect.any(Object) });
  });

  it('returns null for an unrecognized shape (never guesses)', () => {
    expect(resolveForm({ foo: 'bar' })).toBe(null);
    expect(resolveForm({})).toBe(null);
    expect(resolveForm(null)).toBe(null);
  });
});

describe('consentFromData (SMS-consent detection, either casing)', () => {
  it('detects the R2 casing ("SMS-consent")', () => {
    expect(consentFromData({ 'SMS-consent': 'true' })).toBe(true);
    expect(consentFromData({ 'SMS-consent': 'false' })).toBe(false);
  });

  it('detects the legacy casing ("SMS-Consent")', () => {
    expect(consentFromData({ 'SMS-Consent': true })).toBe(true);
  });

  it('is false when the field is missing or unchecked', () => {
    expect(consentFromData({})).toBe(false);
    expect(consentFromData({ 'SMS-consent': '' })).toBe(false);
    expect(consentFromData(null)).toBe(false);
  });
});
