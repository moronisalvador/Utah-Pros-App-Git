/**
 * ════════════════════════════════════════════════
 * FILE: techShellRoutes.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a notification opened from inside the field app stays in the field
 *   app, and that nothing drags an office user out of the office app. The awkward
 *   case this exists for: an admin working out of the field PWA. Role-based routing
 *   cannot help them — they are not a field tech — so the bell has to look at where
 *   they are standing instead.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/techShellRoutes.js
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { officeToTechPath, isTechPath, linkForCurrentShell } from './techShellRoutes.js';

describe('officeToTechPath', () => {
  it('maps the office detail screens that have field equivalents', () => {
    expect(officeToTechPath('/conversations')).toBe('/tech/conversations');
    expect(officeToTechPath('/schedule')).toBe('/tech/schedule');
    expect(officeToTechPath('/jobs/abc-123')).toBe('/tech/jobs/abc-123');
    expect(officeToTechPath('/claims/xyz-789')).toBe('/tech/claims/xyz-789');
  });

  it('leaves index routes alone — being bounced off a list you opened is its own bug', () => {
    expect(officeToTechPath('/jobs')).toBeNull();
    expect(officeToTechPath('/claims')).toBeNull();
  });

  it('returns null for office pages with no field version', () => {
    expect(officeToTechPath('/devtools')).toBeNull();
    expect(officeToTechPath('/settings/roles')).toBeNull();
    expect(officeToTechPath('/melds')).toBeNull();
  });

  it('never double-maps a path that is already a field path', () => {
    expect(officeToTechPath('/tech/conversations')).toBeNull();
    expect(officeToTechPath('/tech')).toBeNull();
  });

  it('does not confuse a lookalike prefix for the field shell', () => {
    expect(isTechPath('/technicians')).toBe(false);
    expect(isTechPath('/tech')).toBe(true);
    expect(isTechPath('/tech/jobs/1')).toBe(true);
  });
});

describe('linkForCurrentShell', () => {
  it('rewrites an office link when the user is inside the field shell', () => {
    expect(linkForCurrentShell('/conversations', '/tech')).toBe('/tech/conversations');
  });

  it('preserves ?c= so the inbox opens the right thread', () => {
    expect(linkForCurrentShell('/conversations?c=conv-1', '/tech'))
      .toBe('/tech/conversations?c=conv-1');
  });

  it('preserves a hash too', () => {
    expect(linkForCurrentShell('/jobs/j1#files', '/tech/dash')).toBe('/tech/jobs/j1#files');
  });

  it('leaves the link untouched for someone in the office shell', () => {
    // An office user on a desktop must keep the office page.
    expect(linkForCurrentShell('/conversations?c=conv-1', '/dashboard'))
      .toBe('/conversations?c=conv-1');
    expect(linkForCurrentShell('/jobs/j1', '/jobs')).toBe('/jobs/j1');
  });

  it('leaves a link with no field equivalent alone even inside the field shell', () => {
    expect(linkForCurrentShell('/devtools', '/tech')).toBe('/devtools');
  });

  it('handles a missing link without throwing', () => {
    expect(linkForCurrentShell('', '/tech')).toBe('');
    expect(linkForCurrentShell(null, '/tech')).toBe(null);
  });
});
