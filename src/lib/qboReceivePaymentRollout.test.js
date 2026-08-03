/**
 * Verifies the grouped receive-payment UI requires one exact, fail-closed
 * deployment value. The Worker and database gates remain independently tested.
 */
import { describe, expect, it } from 'vitest';
import { isQboReceivePaymentUiEnabled } from './qboReceivePaymentRollout.js';

describe('QBO receive-payment UI rollout gate', () => {
  it('opens only for the exact literal true', () => {
    expect(isQboReceivePaymentUiEnabled({
      VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED: 'true',
    })).toBe(true);
  });

  it.each([
    undefined,
    {},
    { VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED: '' },
    { VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED: 'false' },
    { VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED: 'TRUE' },
    { VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED: '1' },
    { VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED: true },
  ])('fails closed for %j', (env) => {
    expect(isQboReceivePaymentUiEnabled(env)).toBe(false);
  });
});
