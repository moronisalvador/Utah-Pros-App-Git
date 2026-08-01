/**
 * ════════════════════════════════════════════════
 * FILE: MessageBubble.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks how conversation messages are labeled and whether uncertain delivery
 *   results can be sent again safely. It also checks when customer names appear
 *   in conversations shared by more than one customer.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:url
 *   Internal:  ./messageUtils.js, ./MessageBubble.jsx
 *   Data:      reads  → none (in-memory test values only)
 *              writes → none (in-memory test values only)
 *
 * NOTES / GOTCHAS:
 *   - This test never connects to a live database or messaging provider.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAmbiguousSend, messageSenderName } from './messageUtils.js';

const messageBubbleSource = readFileSync(
  fileURLToPath(new URL('./MessageBubble.jsx', import.meta.url)),
  'utf8',
);

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

describe('MessageBubble private-media lifecycle', () => {
  it('skips signed-URL refreshes while hidden and uses the shared resume subscription', () => {
    expect(messageBubbleSource).toContain("import { subscribeResume } from '@/hooks/useResumeRefetch'");
    expect(messageBubbleSource).toContain("typeof document !== 'undefined' && document.hidden");
    expect(messageBubbleSource).toContain('unsubscribeResume?.()');
  });

  it('announces private attachment loading and failure without interrupting the user', () => {
    expect(messageBubbleSource).toMatch(
      /className="conv-media-file"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
    );
    expect(messageBubbleSource).toContain('aria-atomic="true"');
  });
});
