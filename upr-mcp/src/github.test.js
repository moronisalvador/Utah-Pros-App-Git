// Unit tests for the pure helpers in github.js.
// Written test-first (per the UPR build loop) for the two bits most likely to
// break silently: the UTF-8-safe base64 encoding used when committing a file
// (the REST "push"), and the owner/repo reference parser.

import { describe, it, expect } from 'vitest';
import { ghEncodeContent, parseRepoRef } from './github.js';

describe('ghEncodeContent (UTF-8 → base64 for the Contents API)', () => {
  it('encodes plain ASCII', () => {
    expect(ghEncodeContent('hello')).toBe('aGVsbG8=');
  });

  it('round-trips multi-byte UTF-8 (accents + emoji) without corruption', () => {
    const input = 'café — build ✅ €';
    const encoded = ghEncodeContent(input);
    // GitHub decodes with standard base64; a naive btoa() would mangle these bytes.
    expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe(input);
  });

  it('encodes an empty string to an empty string', () => {
    expect(ghEncodeContent('')).toBe('');
  });
});

describe('parseRepoRef (owner/repo validation)', () => {
  it('accepts a well-formed owner/repo', () => {
    expect(parseRepoRef('moronisalvador/Utah-Pros-App-Git')).toBe('moronisalvador/Utah-Pros-App-Git');
  });

  it('trims surrounding whitespace', () => {
    expect(parseRepoRef('  owner/repo  ')).toBe('owner/repo');
  });

  it('rejects a three-segment path', () => {
    expect(parseRepoRef('owner/repo/extra')).toBeNull();
  });

  it('rejects a bare owner with no repo', () => {
    expect(parseRepoRef('owner')).toBeNull();
  });

  it('rejects empty / nullish input', () => {
    expect(parseRepoRef('')).toBeNull();
    expect(parseRepoRef(undefined)).toBeNull();
    expect(parseRepoRef(null)).toBeNull();
  });
});
