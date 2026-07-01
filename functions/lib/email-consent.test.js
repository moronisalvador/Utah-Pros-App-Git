import { describe, it, expect } from 'vitest';
import { emailAllows } from './email-consent.js';

describe('emailAllows', () => {
  it('refuses to send when the address is suppressed (unsubscribed/bounced/complained)', () => {
    expect(emailAllows({ email: 'a@example.com', suppressed: true, dnd: false })).toBe(false);
  });

  it('refuses to send when the contact has Do Not Disturb set', () => {
    expect(emailAllows({ email: 'a@example.com', suppressed: false, dnd: true })).toBe(false);
  });

  it('refuses to send when there is no email address on file', () => {
    expect(emailAllows({ email: null, suppressed: false, dnd: false })).toBe(false);
    expect(emailAllows({ email: '', suppressed: false, dnd: false })).toBe(false);
  });

  it('refuses to send when the row itself is missing', () => {
    expect(emailAllows(null)).toBe(false);
    expect(emailAllows(undefined)).toBe(false);
  });

  it('allows the send when the address has a valid email and is neither suppressed nor DND', () => {
    expect(emailAllows({ email: 'a@example.com', suppressed: false, dnd: false })).toBe(true);
  });
});
