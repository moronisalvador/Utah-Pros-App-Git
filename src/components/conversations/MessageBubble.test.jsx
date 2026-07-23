import { describe, expect, it } from 'vitest';
import { isAmbiguousSend } from './messageUtils.js';

describe('MessageBubble ambiguous-send affordance', () => {
  it.each([
    'CALLRAIL_SEND_AMBIGUOUS',
    'TWILIO_SEND_AMBIGUOUS',
  ])('recognizes %s as non-resubmittable', (errorCode) => {
    expect(isAmbiguousSend({ error_code: errorCode })).toBe(true);
  });

  it('keeps a definite provider rejection retryable', () => {
    expect(isAmbiguousSend({ error_code: 'CALLRAIL_REJECTED' })).toBe(false);
    expect(isAmbiguousSend({ error_code: null })).toBe(false);
  });
});
