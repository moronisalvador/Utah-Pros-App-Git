import { describe, it, expect } from 'vitest';
import { shouldCreateContact } from './callrail.js';

describe('shouldCreateContact', () => {
  it('rejects a spam-flagged call regardless of duration', () => {
    expect(shouldCreateContact({ spam_flag: true, duration_sec: 120 })).toBe(false);
  });

  it('rejects a short call under 15 seconds', () => {
    expect(shouldCreateContact({ spam_flag: false, duration_sec: 14 })).toBe(false);
  });

  it('accepts a call at exactly 15 seconds', () => {
    expect(shouldCreateContact({ spam_flag: false, duration_sec: 15 })).toBe(true);
  });

  it('accepts a call well over 15 seconds', () => {
    expect(shouldCreateContact({ spam_flag: false, duration_sec: 180 })).toBe(true);
  });

  it('accepts a form lead with no duration (forms have no call duration)', () => {
    expect(shouldCreateContact({ spam_flag: false, duration_sec: null })).toBe(true);
  });

  it('rejects a spam-flagged form lead even with no duration', () => {
    expect(shouldCreateContact({ spam_flag: true, duration_sec: null })).toBe(false);
  });
});
