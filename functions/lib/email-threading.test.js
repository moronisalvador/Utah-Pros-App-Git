/**
 * ════════════════════════════════════════════════
 * FILE: email-threading.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Unit tests for the email threading helpers. Proves the reply address round-trips
 *   its conversation token, that a hostile/garbage "To" address yields no token, that
 *   the HTML sanitizer defuses the classic cross-site-scripting tricks, and that the
 *   thread headers come out angle-bracketed. Pure functions — no database, no network.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/lib/email-threading.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  buildReplyAddress,
  parseReplyToken,
  sanitizeInboundHtml,
  buildThreadHeaders,
  REPLY_DOMAIN,
} from './email-threading.js';

describe('buildReplyAddress / parseReplyToken round-trip', () => {
  it('builds a reply+<token>@domain subaddress', () => {
    expect(buildReplyAddress('abc123')).toBe(`reply+abc123@${REPLY_DOMAIN}`);
  });

  it('round-trips a realistic 64-hex token', () => {
    const token = 'a'.repeat(32) + 'b'.repeat(32);
    expect(parseReplyToken(buildReplyAddress(token))).toBe(token);
  });

  it('throws on an empty token (never build a tokenless reply address)', () => {
    expect(() => buildReplyAddress('')).toThrow();
    expect(() => buildReplyAddress(null)).toThrow();
  });

  it('parses a token from a "Display Name <addr>" form', () => {
    expect(parseReplyToken('Jane Doe <reply+tok9@utahpros.app>')).toBe('tok9');
  });

  it('is case-insensitive on the "reply" local part and the domain', () => {
    expect(parseReplyToken('Reply+TokenABC@UtahPros.App')).toBe('TokenABC');
  });

  it('returns null for non-reply / wrong-domain / malformed addresses', () => {
    expect(parseReplyToken('restoration@utahpros.app')).toBe(null);   // no +token
    expect(parseReplyToken('reply+tok@evil.com')).toBe(null);         // wrong domain
    expect(parseReplyToken('reply@utahpros.app')).toBe(null);         // no + segment
    expect(parseReplyToken('reply+@utahpros.app')).toBe(null);        // empty token
    expect(parseReplyToken('not an email')).toBe(null);
    expect(parseReplyToken('')).toBe(null);
    expect(parseReplyToken(null)).toBe(null);
  });
});

describe('sanitizeInboundHtml — XSS defusing', () => {
  it('removes <script> blocks entirely', () => {
    const out = sanitizeInboundHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('hi');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips inline event handlers (onerror/onclick/onload)', () => {
    const out = sanitizeInboundHtml('<img src="https://ok.com/a.png" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('drops javascript: and data: URLs but keeps https/mailto/tel links', () => {
    expect(sanitizeInboundHtml('<a href="javascript:alert(1)">x</a>').toLowerCase()).not.toContain('javascript:');
    expect(sanitizeInboundHtml('<a href="data:text/html,<script>">x</a>').toLowerCase()).not.toContain('data:');
    expect(sanitizeInboundHtml('<a href="https://ok.com">x</a>')).toContain('https://ok.com');
    expect(sanitizeInboundHtml('<a href="mailto:a@b.com">x</a>')).toContain('mailto:a@b.com');
    expect(sanitizeInboundHtml('<a href="tel:+15551234567">x</a>')).toContain('tel:+15551234567');
  });

  it('removes iframe/object/embed and svg/style blocks', () => {
    const dirty = '<iframe src="https://evil"></iframe><object></object><style>*{x}</style><svg onload="x"></svg>';
    const out = sanitizeInboundHtml(dirty).toLowerCase();
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('onload');
  });

  it('handles mixed-case tags and hidden schemes', () => {
    expect(sanitizeInboundHtml('<ScRiPt>alert(1)</ScRiPt>').toLowerCase()).not.toContain('script');
    // "java\tscript:" whitespace-obfuscation is collapsed and rejected.
    expect(sanitizeInboundHtml('<a href="java\tscript:alert(1)">x</a>').toLowerCase()).not.toContain('script:alert');
  });

  it('drops inline style attributes (can carry url(javascript:))', () => {
    const out = sanitizeInboundHtml('<div style="background:url(javascript:alert(1))">hi</div>');
    expect(out.toLowerCase()).not.toContain('style=');
    expect(out).toContain('hi');
  });

  it('returns empty string for junk input', () => {
    expect(sanitizeInboundHtml(null)).toBe('');
    expect(sanitizeInboundHtml(undefined)).toBe('');
    expect(sanitizeInboundHtml(123)).toBe('');
  });
});

describe('buildThreadHeaders', () => {
  it('returns an empty object when nothing is supplied', () => {
    expect(buildThreadHeaders()).toEqual({});
    expect(buildThreadHeaders({})).toEqual({});
  });

  it('angle-wraps a bare In-Reply-To and mirrors it into References', () => {
    expect(buildThreadHeaders({ inReplyTo: 'abc@mail.example' })).toEqual({
      'In-Reply-To': '<abc@mail.example>',
      'References': '<abc@mail.example>',
    });
  });

  it('preserves an already-bracketed id and a multi-id References chain', () => {
    const h = buildThreadHeaders({ inReplyTo: '<x@a>', references: '<r1@a> r2@b' });
    expect(h['In-Reply-To']).toBe('<x@a>');
    expect(h['References']).toBe('<r1@a> <r2@b>');
  });
});
