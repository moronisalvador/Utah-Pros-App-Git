import { describe, expect, it } from 'vitest';
import {
  buildPhoneOrFilter,
  detectKeyword,
  isAmbiguousContentReply,
  keywordReplyBody,
  phoneMatchVariants,
} from './messaging-inbound.js';

describe('provider-neutral inbound messaging primitives', () => {
  it('detects compliance keywords without matching sentences', () => {
    expect(detectKeyword(' STOP! ')).toBe('stop');
    expect(detectKeyword('START')).toBe('start');
    expect(detectKeyword('help')).toBe('help');
    expect(detectKeyword('stop by tomorrow')).toBeNull();
  });

  it('preserves ambiguous content replies', () => {
    expect(isAmbiguousContentReply('yes')).toBe(true);
    expect(isAmbiguousContentReply('info')).toBe(true);
    expect(isAmbiguousContentReply('start')).toBe(false);
  });

  it('matches common NANP storage formats', () => {
    expect(phoneMatchVariants('+18015551212')).toContain('(801) 555-1212');
    expect(buildPhoneOrFilter('+18015551212')).toContain('or=(');
  });

  it('keeps the established compliance reply copy', () => {
    expect(keywordReplyBody('help')).toContain('(385) 336-0611');
    expect(keywordReplyBody('stop', { advancedOptOut: true })).toBe('');
  });
});
