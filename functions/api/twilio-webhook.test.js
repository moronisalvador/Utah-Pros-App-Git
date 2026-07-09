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
import {
  detectKeyword,
  keywordReplyBody,
  notifyInboundMessage,
  phoneMatchVariants,
  buildPhoneOrFilter,
  isAmbiguousContentReply,
  normalizeKeyword,
  isDuplicateSidError,
} from './twilio-webhook.js';

const ENV = { SUPABASE_URL: 'https://db.test' };

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

  it('maps STOPALL and "STOP ALL" to stop (Phase A — Twilio opt-out keyword)', () => {
    for (const w of ['STOPALL', 'stopall', 'STOP ALL', ' Stop All ']) {
      expect(detectKeyword(w)).toBe('stop');
    }
  });

  it('tolerates trailing/embedded punctuation on a lone keyword (Phase A)', () => {
    expect(detectKeyword('STOP.')).toBe('stop');
    expect(detectKeyword('Stop!')).toBe('stop');
    expect(detectKeyword('stop?')).toBe('stop');
    expect(detectKeyword('s.t.o.p')).toBe('stop');   // filter-evasion still opts out
    expect(detectKeyword('help!')).toBe('help');
    expect(detectKeyword('YES!')).toBe('start');
  });

  it('does NOT let punctuation turn a real sentence into a keyword', () => {
    expect(detectKeyword('please stop.')).toBe(null);  // multi-word → not a lone keyword
    expect(detectKeyword('can you help?')).toBe(null);
  });
});

describe('normalizeKeyword (Phase A punctuation/whitespace collapse)', () => {
  it('lowercases, trims, and strips non-alphanumerics', () => {
    expect(normalizeKeyword(' STOP! ')).toBe('stop');
    expect(normalizeKeyword('STOP ALL')).toBe('stopall');
    expect(normalizeKeyword('')).toBe('');
    expect(normalizeKeyword(null)).toBe('');
  });
});

describe('isDuplicateSidError (F-9 dup-sid → 200 no-op, else 500 retry)', () => {
  it('recognizes a UNIQUE(twilio_sid) / 409 violation', () => {
    expect(isDuplicateSidError(new Error('Supabase INSERT messages: 409 conflict'))).toBe(true);
    expect(isDuplicateSidError(new Error('duplicate key value violates unique constraint "messages_twilio_sid_key"'))).toBe(true);
  });
  it('does NOT treat a generic/transient error as a duplicate', () => {
    expect(isDuplicateSidError(new Error('Supabase INSERT messages: 500 server error'))).toBe(false);
    expect(isDuplicateSidError(new Error('fetch failed'))).toBe(false);
    expect(isDuplicateSidError(null)).toBe(false);
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

describe('phoneMatchVariants / buildPhoneOrFilter (F-3 digits-OR STOP match)', () => {
  it('produces every common stored format for a US number', () => {
    const variants = phoneMatchVariants('+18019196858');
    // The two formats that actually exist live (E.164 + "(XXX) XXX-XXXX") plus common typed forms.
    expect(variants).toContain('+18019196858');   // E.164
    expect(variants).toContain('8019196858');      // bare 10-digit
    expect(variants).toContain('18019196858');     // bare 11-digit
    expect(variants).toContain('(801) 919-6858');  // (XXX) XXX-XXXX (live non-E.164 format)
    expect(variants).toContain('801-919-6858');    // XXX-XXX-XXXX
    expect(variants).toContain('801.919.6858');    // XXX.XXX.XXXX
  });

  it('normalizes a non-E.164 inbound to the same variant set', () => {
    // Twilio always sends E.164, but the helper must be format-agnostic.
    expect(phoneMatchVariants('(801) 919-6858')).toEqual(phoneMatchVariants('+18019196858'));
  });

  it('builds a PostgREST or=() filter with quoted, URL-encoded candidates', () => {
    const f = buildPhoneOrFilter('+18019196858');
    expect(f.startsWith('or=(')).toBe(true);
    expect(f.endsWith(')')).toBe(true);
    expect(f).toContain('phone.eq.');
    // The formatted number's parens + space must be percent-encoded inside a quoted value.
    expect(f).toContain('%22%28801%29%20919-6858%22');
    // The + in E.164 must be %2B, never a raw + (which would decode to a space).
    expect(f).not.toMatch(/phone\.eq\.\+/);
  });

  it('falls back to an exact match for an unparseable sender (shortcode / junk)', () => {
    expect(buildPhoneOrFilter('12345')).toBe('phone=eq.12345&limit=1');
  });
});

describe('isAmbiguousContentReply (F-7 — never swallow a real "yes"/"info")', () => {
  it('flags exact yes/info (case-insensitive, trimmed)', () => {
    for (const w of ['yes', 'YES', ' Yes ', 'info', 'INFO', ' Info ']) {
      expect(isAmbiguousContentReply(w)).toBe(true);
    }
  });

  it('does not flag unambiguous commands or normal text', () => {
    for (const w of ['stop', 'start', 'help', 'unsubscribe', 'yes please', 'more info', 'hello', '', null, undefined]) {
      expect(isAmbiguousContentReply(w)).toBe(false);
    }
  });
});

describe('notifyInboundMessage (message.inbound emit hook)', () => {
  const conversation = { id: 'conv-1', assigned_to: null };
  const contact = { id: 'c-1', name: 'Jane Doe' };

  it('emits message.inbound with the right type + payload', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); return { ok: true }; };
    await notifyInboundMessage({
      db: {}, env: ENV, conversation, contact, from: '+15551234567',
      text: 'Water is everywhere, please help!', dispatchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].typeKey).toBe('message.inbound');
    expect(calls[0].body.entity_type).toBe('conversation');
    expect(calls[0].body.entity_id).toBe('conv-1');
    expect(calls[0].body.title).toContain('Jane Doe');
    expect(calls[0].body.body).toContain('Water is everywhere');
  });

  it('targets the assigned rep when the conversation is assigned', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyInboundMessage({
      db: {}, env: ENV, conversation: { id: 'conv-2', assigned_to: 'emp-9' },
      contact, from: '+15551234567', text: 'hi', dispatchImpl,
    });
    expect(calls[0].body.recipient_ids).toEqual(['emp-9']);
  });

  it('leaves recipient_ids unset (office/admin fallback) when unassigned', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyInboundMessage({ db: {}, env: ENV, conversation, contact, from: '+1555', text: 'hi', dispatchImpl });
    expect(calls[0].body.recipient_ids).toBeUndefined();
  });

  it('falls back to the phone number when the contact has no name', async () => {
    const calls = [];
    const dispatchImpl = async (evt) => { calls.push(evt); };
    await notifyInboundMessage({ db: {}, env: ENV, conversation, contact: { id: 'c-2' }, from: '+15550000000', text: 'hi', dispatchImpl });
    expect(calls[0].body.title).toContain('+15550000000');
  });

  it('swallows a dispatcher error (never throws into the SMS path)', async () => {
    const dispatchImpl = async () => { throw new Error('notify down'); };
    await expect(
      notifyInboundMessage({ db: {}, env: ENV, conversation, contact, from: '+1555', text: 'hi', dispatchImpl }),
    ).resolves.toBeUndefined();
  });
});
