/**
 * ════════════════════════════════════════════════
 * FILE: hubStageState.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the stage's read-only-vs-interactive decision (crew membership), the
 *   arriving/working/wrapped shape from the viewer's clock (including cancelled →
 *   wrapped), and when the "clocked into another job" banner shows. Also asserts
 *   the docked bar's safe-area bottom formula is present in the stylesheet. Pure
 *   unit test.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isOnCrew, stageBucket, shouldShowElsewhere } from './hubStageState.js';

const crew = [{ employee_id: 'e1', role: 'lead' }, { employee_id: 'e2', role: 'crew' }];

describe('isOnCrew — non-crew read-only gate', () => {
  it('true for a crew member', () => expect(isOnCrew(crew, 'e2')).toBe(true));
  it('false for a non-crew viewer', () => expect(isOnCrew(crew, 'e9')).toBe(false));
  it('false for empty/missing crew', () => {
    expect(isOnCrew([], 'e1')).toBe(false);
    expect(isOnCrew(null, 'e1')).toBe(false);
  });
});

describe('stageBucket', () => {
  it('arriving for scheduled / omw', () => {
    expect(stageBucket('scheduled', false)).toBe('arriving');
    expect(stageBucket('omw', false)).toBe('arriving');
  });
  it('working for on_site / paused', () => {
    expect(stageBucket('on_site', false)).toBe('working');
    expect(stageBucket('paused', false)).toBe('working');
  });
  it('wrapped for completed', () => expect(stageBucket('completed', false)).toBe('wrapped'));
  it('cancelled visit is always wrapped, even mid-clock', () => {
    expect(stageBucket('on_site', true)).toBe('wrapped');
    expect(stageBucket('scheduled', true)).toBe('wrapped');
  });
});

describe('shouldShowElsewhere — clocked-into-another-job banner', () => {
  it('shows when an open entry is on a different appointment', () => {
    expect(shouldShowElsewhere({ appointment_id: 'other' }, 'this')).toBe(true);
  });
  it('hidden when there is no open entry', () => {
    expect(shouldShowElsewhere(null, 'this')).toBe(false);
  });
  it('hidden when the open entry IS the viewed visit', () => {
    expect(shouldShowElsewhere({ appointment_id: 'this' }, 'this')).toBe(false);
  });
});

describe('Z3 dock — safe-area bottom formula present in index.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../../../../index.css', import.meta.url)), 'utf8');
  it('docks above the tech nav honoring the safe-area inset', () => {
    expect(css).toContain('bottom: calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom)))');
  });
});
