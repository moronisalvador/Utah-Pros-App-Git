/**
 * ════════════════════════════════════════════════
 * FILE: messageUtils.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the pure Messages helpers: the SMS segment counter picks GSM-7 vs UCS-2
 *   and counts parts the way a carrier does, links are pulled out safely (never as a
 *   dangerous javascript: link), the attachment column parses in every shape it can
 *   arrive in, and per-conversation drafts save and clear.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file) — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Internal:  ./messageUtils
 * ════════════════════════════════════════════════
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeSmsSegments, linkifyTokens, parseMediaUrls, isLikelyImageUrl,
  isRetryableMediaReference,
  getDraft, setDraft, clearDraft,
} from './messageUtils';

describe('computeSmsSegments', () => {
  it('empty string → zero segments', () => {
    const r = computeSmsSegments('');
    expect(r).toMatchObject({ chars: 0, segments: 0 });
  });

  it('plain ASCII under 160 is one GSM-7 segment', () => {
    const r = computeSmsSegments('Hello there, your tech is on the way.');
    expect(r.encoding).toBe('GSM-7');
    expect(r.segments).toBe(1);
  });

  it('exactly 160 GSM chars stays one segment; 161 tips to two', () => {
    expect(computeSmsSegments('a'.repeat(160)).segments).toBe(1);
    expect(computeSmsSegments('a'.repeat(161)).segments).toBe(2);
  });

  it('GSM extension chars cost two units', () => {
    // 80 '[' chars = 160 units = 1 segment; 81 = 162 units = 2 segments.
    expect(computeSmsSegments('['.repeat(80)).segments).toBe(1);
    expect(computeSmsSegments('['.repeat(81)).segments).toBe(2);
  });

  it('an emoji forces UCS-2 with a 70-char single-segment cap', () => {
    const r = computeSmsSegments('hi 🎉');
    expect(r.encoding).toBe('UCS-2');
    expect(r.segments).toBe(1);
    expect(computeSmsSegments('😀'.repeat(71)).segments).toBe(2);
  });
});

describe('linkifyTokens', () => {
  it('splits a URL out of surrounding text and https-forces it', () => {
    const t = linkifyTokens('see http://a.com/x now');
    const link = t.find(x => x.type === 'link');
    expect(link.href).toBe('https://a.com/x');
  });

  it('prefixes bare www. links', () => {
    const link = linkifyTokens('go www.utahpros.app').find(x => x.type === 'link');
    expect(link.href).toBe('https://www.utahpros.app');
  });

  it('turns an email into a mailto link', () => {
    const link = linkifyTokens('mail me a@b.com ok').find(x => x.type === 'link');
    expect(link.href).toBe('mailto:a@b.com');
  });

  it('never produces a javascript: scheme from hostile text', () => {
    const t = linkifyTokens('javascript:alert(1) and data:text/html,x');
    expect(t.every(x => x.type === 'text' || /^(https:|mailto:)/.test(x.href))).toBe(true);
  });

  it('plain text with no links returns a single text token', () => {
    expect(linkifyTokens('just words')).toEqual([{ type: 'text', value: 'just words' }]);
  });
});

describe('parseMediaUrls', () => {
  it('handles a JSON-stringified array (how the worker stores it)', () => {
    expect(parseMediaUrls('["https://x/a.jpg","https://x/b.jpg"]')).toHaveLength(2);
  });
  it('handles an already-parsed array', () => {
    expect(parseMediaUrls(['https://x/a.jpg'])).toEqual(['https://x/a.jpg']);
  });
  it('handles a single bare URL string', () => {
    expect(parseMediaUrls('https://x/a.jpg')).toEqual(['https://x/a.jpg']);
  });
  it('null / empty → empty array, never throws on bad JSON', () => {
    expect(parseMediaUrls(null)).toEqual([]);
    expect(parseMediaUrls('')).toEqual([]);
    expect(parseMediaUrls('[not json')).toEqual([]);
  });
});

describe('retryable message media', () => {
  it('allows canonical private outbound references and narrow legacy URLs only', () => {
    expect(isRetryableMediaReference(
      'upr-storage://message-attachments/outbound/conversation/photo.jpg',
    )).toBe(true);
    expect(isRetryableMediaReference(
      'https://db.test/storage/v1/object/public/job-files/conversations/conversation/photo.jpg',
    )).toBe(true);
    expect(isRetryableMediaReference('https://files.test/photo.jpg')).toBe(false);
    expect(isRetryableMediaReference(
      'upr-storage://message-attachments/callrail/provider/photo.jpg',
    )).toBe(false);
    expect(isRetryableMediaReference(
      'upr-storage://message-attachments/outbound/../provider/photo.jpg',
    )).toBe(false);
    expect(isRetryableMediaReference('javascript:alert(1)')).toBe(false);
  });
});

describe('isLikelyImageUrl', () => {
  it('true for image extensions and extension-less Twilio media URLs', () => {
    expect(isLikelyImageUrl('https://x/a.JPG')).toBe(true);
    expect(isLikelyImageUrl('https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME')).toBe(true);
  });
  it('false for a plain document link', () => {
    expect(isLikelyImageUrl('https://x/report.pdf')).toBe(false);
  });
});

describe('draft persistence', () => {
  // Provide an in-memory localStorage (vitest runs this suite in node, no DOM).
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  });
  it('round-trips a draft and clears it', () => {
    setDraft('conv-1', 'half a message');
    expect(getDraft('conv-1')).toBe('half a message');
    clearDraft('conv-1');
    expect(getDraft('conv-1')).toBe('');
  });
  it('setting an empty/whitespace draft removes it', () => {
    setDraft('conv-2', 'x');
    setDraft('conv-2', '   ');
    expect(getDraft('conv-2')).toBe('');
  });
});
