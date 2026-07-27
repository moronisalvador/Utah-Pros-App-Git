/**
 * ════════════════════════════════════════════════
 * FILE: short-link.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the signing-link shortener. The two claims that matter: the short code
 *   always turns back into exactly the original code (a customer must never reach
 *   the wrong document, or a dead link), and the old long links keep working,
 *   because ones already sent to customers stay valid for thirty days.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./short-link.js
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds, no network.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  encodeUuidToCode, decodeCodeToUuid, resolveSignToken, buildSigningUrl, isUuid,
} from './short-link.js';

const REAL = '5f82ce54-4420-4b6d-a7dc-525b744f6982'; // the one from the live text

describe('short-link codec', () => {
  it('round-trips the token exactly', () => {
    const code = encodeUuidToCode(REAL);
    expect(decodeCodeToUuid(code)).toBe(REAL);
  });

  it('produces a shorter, dash-free code', () => {
    const code = encodeUuidToCode(REAL);
    expect(code.length).toBeLessThanOrEqual(22);
    expect(code).toMatch(/^[0-9A-Za-z]+$/);
    expect(code).not.toContain('-');
  });

  // Round-tripping a handful of shapes is the claim that a customer never lands
  // on the wrong document. Includes the edge cases that break naive base-N code.
  it.each([
    ['all zeroes',      '00000000-0000-0000-0000-000000000000'],
    ['all ones',        'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['leading zeros',   '00000001-0000-0000-0000-000000000001'],
    ['trailing zeros',  'ffffffff-0000-0000-0000-000000000000'],
    ['mixed',           '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'],
  ])('round-trips %s', (_label, uuid) => {
    expect(decodeCodeToUuid(encodeUuidToCode(uuid))).toBe(uuid);
  });

  it('preserves full entropy — every distinct token gets a distinct code', () => {
    const a = encodeUuidToCode('5f82ce54-4420-4b6d-a7dc-525b744f6982');
    const b = encodeUuidToCode('5f82ce54-4420-4b6d-a7dc-525b744f6983'); // 1 bit apart
    expect(a).not.toBe(b);
  });

  it('uppercases and lowercases are different codes (base62 is case-sensitive)', () => {
    const code = encodeUuidToCode(REAL);
    const flipped = code === code.toLowerCase() ? code.toUpperCase() : code.toLowerCase();
    expect(decodeCodeToUuid(flipped)).not.toBe(REAL);
  });
});

describe('short-link — accepting both URL forms', () => {
  it('resolves an old long link unchanged', () => {
    expect(resolveSignToken(REAL)).toBe(REAL);
    expect(resolveSignToken(REAL.toUpperCase())).toBe(REAL);
  });

  it('resolves a new short code', () => {
    expect(resolveSignToken(encodeUuidToCode(REAL))).toBe(REAL);
  });

  it.each([
    ['empty',            ''],
    ['null',             null],
    ['a slash',          'ab/cd'],
    ['punctuation',      'not-a-code!'],
    ['too long',         'a'.repeat(23)],
    ['overflows 128 bits', 'zzzzzzzzzzzzzzzzzzzzzz'],
  ])('refuses %s rather than inventing a token', (_label, input) => {
    expect(resolveSignToken(input)).toBeNull();
  });

  it('knows a UUID when it sees one', () => {
    expect(isUuid(REAL)).toBe(true);
    expect(isUuid(encodeUuidToCode(REAL))).toBe(false);
  });
});

describe('buildSigningUrl', () => {
  it('emits the short form', () => {
    const url = buildSigningUrl('https://utahpros.app', REAL);
    expect(url).toBe(`https://utahpros.app/s/${encodeUuidToCode(REAL)}`);
    expect(url.length).toBeLessThan(`https://utahpros.app/sign/${REAL}`.length);
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildSigningUrl('https://utahpros.app/', REAL))
      .toBe(`https://utahpros.app/s/${encodeUuidToCode(REAL)}`);
  });

  // Never emit a broken link just because the shortener met something unexpected.
  it('falls back to the long form for a non-UUID token', () => {
    expect(buildSigningUrl('https://utahpros.app', 'legacy-token'))
      .toBe('https://utahpros.app/sign/legacy-token');
  });
});
