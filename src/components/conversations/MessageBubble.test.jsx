import { describe, expect, it } from 'vitest';
import { isAmbiguousSend, messageSenderName } from './messageUtils.js';

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

describe('MessageBubble sender labels', () => {
  it('names every staff-authored outbound message outside the bubble', () => {
    expect(messageSenderName({
      type: 'sms_outbound',
      sent_by: 'employee-a',
      employees: { display_name: 'Ben' },
    })).toBe('Ben');
    expect(messageSenderName({ type: 'sms_outbound', sent_by: null }))
      .toBe('Utah Pros');
  });

  it('names customers only when more than one customer shares the thread', () => {
    const message = { type: 'sms_inbound', sender_contact_id: 'contact-b' };
    const participants = [
      { contact_id: 'contact-a', contacts: { name: 'Ann' } },
      { contact_id: 'contact-b', contacts: { name: 'Ray' } },
    ];
    expect(messageSenderName(message, participants, true)).toBe('Ray');
    expect(messageSenderName(message, participants, false)).toBeNull();
  });

  it('keeps internal-note attribution in the note label', () => {
    expect(messageSenderName({
      type: 'internal_note',
      employees: { display_name: 'Ben' },
    })).toBeNull();
  });
});
