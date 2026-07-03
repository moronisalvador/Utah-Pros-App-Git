/**
 * ════════════════════════════════════════════════
 * FILE: twilio-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two pure pieces of the inbound-SMS webhook's compliance logic:
 *   (1) which keyword an incoming text maps to (STOP / START / HELP / none),
 *   and (2) what auto-reply we send back — including that we stay SILENT when
 *   Twilio's Advanced Opt-Out is handling the reply (so customers never get two
 *   texts) and that the HELP reply shows the correct SMS support contact.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio-webhook.js (detectKeyword, keywordReplyBody)
 *
 * NOTES / GOTCHAS:
 *   - Only the pure helpers are unit-tested; the handler's DB writes/side effects
 *     are integration territory. The helpers are exported precisely so the
 *     keyword→reply decision is testable without mocking Supabase/Twilio.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { detectKeyword, keywordReplyBody } from './twilio-webhook.js';

describe('detectKeyword (CTIA keyword mapping)', () => {
  it('maps STOP and its synonyms (case-insensitive)', () => {
    for (const w of ['STOP', 'stop', ' Stop ', 'unsubscribe', 'cancel', 'end', 'quit']) {
      expect(detectKeyword(w)).toBe('stop');
    }
  });

  it('maps START and its synonyms', () => {
    for (const w of ['START', 'unstop', 'subscribe', 'yes']) {
      expect(detectKeyword(w)).toBe('start');
    }
  });

  it('maps HELP and its synonyms', () => {
    for (const w of ['HELP', 'help', 'info']) {
      expect(detectKeyword(w)).toBe('help');
    }
  });

  it('returns null for normal messages and empty input', () => {
    for (const w of ['hello', 'when can you come?', 'stop by tomorrow', '', null, undefined]) {
      expect(detectKeyword(w)).toBe(null);
    }
  });
});

describe('keywordReplyBody (auto-reply copy + Advanced Opt-Out gate)', () => {
  it('HELP reply carries the correct SMS support contact (matches Privacy Policy)', () => {
    const body = keywordReplyBody('help', { advancedOptOut: false });
    expect(body).toContain('(385) 336-0611');
    expect(body).toContain('restoration@utah-pros.com');
    // The stale contact info must be gone.
    expect(body).not.toContain('(801) 477-5590');
    expect(body).not.toContain('info@utahpros.com');
  });

  it('STOP reply confirms the unsubscribe', () => {
    expect(keywordReplyBody('stop', { advancedOptOut: false })).toContain('unsubscribed');
  });

  it('START reply confirms the re-subscribe', () => {
    expect(keywordReplyBody('start', { advancedOptOut: false })).toContain('re-subscribed');
  });

  it('returns empty string for every keyword when Advanced Opt-Out owns the reply', () => {
    for (const k of ['stop', 'start', 'help']) {
      expect(keywordReplyBody(k, { advancedOptOut: true })).toBe('');
    }
  });

  it('defaults advancedOptOut to false when options are omitted', () => {
    expect(keywordReplyBody('help')).toContain('(385) 336-0611');
  });

  it('returns empty string for an unknown keyword', () => {
    expect(keywordReplyBody(null, { advancedOptOut: false })).toBe('');
    expect(keywordReplyBody('nope', { advancedOptOut: false })).toBe('');
  });
});
