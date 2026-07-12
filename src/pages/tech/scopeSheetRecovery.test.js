/**
 * ════════════════════════════════════════════════
 * FILE: scopeSheetRecovery.test.js  (scope sheet cold-relaunch recovery)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the rules that decide whether the scope sheet should reopen the
 *   tech's in-progress draft after the phone killed the app and reloaded it
 *   from scratch (which loses the ?id in the address bar). We want their work
 *   to come back automatically when they were mid-edit, but NOT to hijack a
 *   deliberate "start a new sheet" or drag in a different job's draft.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./TechDemoSheet.jsx (pickResumeDraftId)
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { pickResumeDraftId } from './scopeSheetRecovery.js';

const NOW = 1_700_000_000_000;
const TTL = 24 * 60 * 60 * 1000;
const noAppt = { jobId: '', jobNumber: '' };

describe('pickResumeDraftId — cold-relaunch draft recovery', () => {
  it('returns null when there is no active pointer', () => {
    expect(pickResumeDraftId(null, true, noAppt, NOW, TTL)).toBe(null);
  });

  it('returns null for a never-saved (pending, id-less) pointer', () => {
    // The pending-mirror path handles this case; recovery needs a saved row id.
    expect(pickResumeDraftId({ id: null, ts: NOW }, true, noAppt, NOW, TTL)).toBe(null);
  });

  it('returns null when the draft has no unsynced mirror (already saved)', () => {
    expect(pickResumeDraftId({ id: 'd1', ts: NOW }, false, noAppt, NOW, TTL)).toBe(null);
  });

  it('resumes the last active draft on a plain tool entry', () => {
    expect(pickResumeDraftId({ id: 'd1', ts: NOW }, true, noAppt, NOW, TTL)).toBe('d1');
  });

  it('does not resume a stale draft older than the TTL', () => {
    const old = NOW - TTL - 1;
    expect(pickResumeDraftId({ id: 'd1', ts: old }, true, noAppt, NOW, TTL)).toBe(null);
  });

  it('resumes when opened from the SAME appointment (job id match)', () => {
    const active = { id: 'd1', ts: NOW, jobId: 'job-9', jobNumber: 'UPR-9' };
    expect(pickResumeDraftId(active, true, { jobId: 'job-9', jobNumber: '' }, NOW, TTL)).toBe('d1');
  });

  it('resumes when opened from the same appointment (job number match, no job id)', () => {
    const active = { id: 'd1', ts: NOW, jobId: null, jobNumber: 'UPR-9' };
    expect(pickResumeDraftId(active, true, { jobId: '', jobNumber: 'UPR-9' }, NOW, TTL)).toBe('d1');
  });

  it('does NOT resume a different appointment\'s draft', () => {
    const active = { id: 'd1', ts: NOW, jobId: 'job-9', jobNumber: 'UPR-9' };
    expect(pickResumeDraftId(active, true, { jobId: 'job-2', jobNumber: 'UPR-2' }, NOW, TTL)).toBe(null);
  });
});
