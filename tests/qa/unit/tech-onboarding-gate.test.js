/**
 * ════════════════════════════════════════════════
 * FILE: tech-onboarding-gate.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the first-run tour's show-once bookkeeping: the local note is
 *   account-scoped (a different employee on the same phone never inherits
 *   "already seen"), completion survives an offline acknowledgement, and a
 *   server failure can never mark the tour as seen by accident.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/techOnboarding.js
 *   Data:      none (fake storage + fake db client)
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TECH_ONBOARDING_SEEN_KEY,
  TECH_ONBOARDING_SURFACE,
  TECH_ONBOARDING_VERSION,
  ackTechOnboardingSeen,
  fetchTechOnboardingVersionSeen,
  mirrorShowsSeen,
  readTechOnboardingMirror,
  resyncTechOnboardingAck,
  writeTechOnboardingMirror,
} from '../../../src/lib/techOnboarding.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const EMP = 'employee-a';
const OTHER = 'employee-b';

describe('local mirror', () => {
  it('roundtrips a valid record', () => {
    const storage = fakeStorage();
    expect(writeTechOnboardingMirror(
      { employeeId: EMP, version: 1, synced: true },
      storage,
    )).toBe(true);
    expect(readTechOnboardingMirror(storage)).toEqual({
      employeeId: EMP,
      version: 1,
      synced: true,
    });
  });

  it('treats garbage and invalid shapes as missing', () => {
    const storage = fakeStorage();
    expect(readTechOnboardingMirror(storage)).toBeNull();
    storage.setItem(TECH_ONBOARDING_SEEN_KEY, 'not-json');
    expect(readTechOnboardingMirror(storage)).toBeNull();
    storage.setItem(
      TECH_ONBOARDING_SEEN_KEY,
      JSON.stringify({ employeeId: '', version: 1, synced: true }),
    );
    expect(readTechOnboardingMirror(storage)).toBeNull();
    storage.setItem(
      TECH_ONBOARDING_SEEN_KEY,
      JSON.stringify({ employeeId: EMP, version: 1.5, synced: true }),
    );
    expect(readTechOnboardingMirror(storage)).toBeNull();
  });

  it('never lets another account inherit "seen" on a shared phone', () => {
    const storage = fakeStorage();
    writeTechOnboardingMirror(
      { employeeId: EMP, version: TECH_ONBOARDING_VERSION, synced: true },
      storage,
    );
    expect(mirrorShowsSeen(EMP, storage)).toBe(true);
    expect(mirrorShowsSeen(OTHER, storage)).toBe(false);
  });

  it('an older seen version does not satisfy the current tour', () => {
    const storage = fakeStorage();
    writeTechOnboardingMirror(
      { employeeId: EMP, version: TECH_ONBOARDING_VERSION - 1, synced: true },
      storage,
    );
    expect(mirrorShowsSeen(EMP, storage)).toBe(false);
  });
});

describe('server truth', () => {
  it('returns the integer the RPC reports and sanitizes junk to 0', async () => {
    const db = { rpc: vi.fn().mockResolvedValue(3) };
    await expect(fetchTechOnboardingVersionSeen(db)).resolves.toBe(3);
    expect(db.rpc).toHaveBeenCalledWith('get_my_onboarding_version_seen', {
      p_surface: TECH_ONBOARDING_SURFACE,
    });
    const junk = { rpc: vi.fn().mockResolvedValue('nope') };
    await expect(fetchTechOnboardingVersionSeen(junk)).resolves.toBe(0);
  });

  it('propagates a failure so the caller fails closed', async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(fetchTechOnboardingVersionSeen(db)).rejects.toThrow('offline');
  });
});

describe('acknowledgement', () => {
  it('writes the mirror BEFORE the server call and syncs on success', async () => {
    const storage = fakeStorage();
    let mirrorAtRpcTime = null;
    const db = {
      rpc: vi.fn().mockImplementation(async () => {
        mirrorAtRpcTime = readTechOnboardingMirror(storage);
        return TECH_ONBOARDING_VERSION;
      }),
    };
    const res = await ackTechOnboardingSeen(db, EMP, { storage });
    expect(mirrorAtRpcTime).toEqual({
      employeeId: EMP,
      version: TECH_ONBOARDING_VERSION,
      synced: false,
    });
    expect(res).toEqual({ ok: true, synced: true });
    expect(readTechOnboardingMirror(storage).synced).toBe(true);
  });

  it('an offline acknowledgement still completes locally, unsynced', async () => {
    const storage = fakeStorage();
    const db = { rpc: vi.fn().mockRejectedValue(new Error('offline')) };
    const res = await ackTechOnboardingSeen(db, EMP, { storage });
    expect(res).toEqual({ ok: true, synced: false });
    expect(mirrorShowsSeen(EMP, storage)).toBe(true);
    expect(readTechOnboardingMirror(storage).synced).toBe(false);
  });
});

describe('offline-ack reconciliation', () => {
  it('no-ops when the mirror is synced, missing, or another employee’s', async () => {
    const db = { rpc: vi.fn() };
    const empty = fakeStorage();
    await expect(resyncTechOnboardingAck(db, EMP, { storage: empty }))
      .resolves.toEqual({ ok: true, retried: false });

    const synced = fakeStorage();
    writeTechOnboardingMirror(
      { employeeId: EMP, version: 1, synced: true },
      synced,
    );
    await expect(resyncTechOnboardingAck(db, EMP, { storage: synced }))
      .resolves.toEqual({ ok: true, retried: false });

    const foreign = fakeStorage();
    writeTechOnboardingMirror(
      { employeeId: OTHER, version: 1, synced: false },
      foreign,
    );
    await expect(resyncTechOnboardingAck(db, EMP, { storage: foreign }))
      .resolves.toEqual({ ok: true, retried: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('retries an unsynced completion and flips the mirror on success', async () => {
    const storage = fakeStorage();
    writeTechOnboardingMirror(
      { employeeId: EMP, version: 1, synced: false },
      storage,
    );
    const db = { rpc: vi.fn().mockResolvedValue(1) };
    const res = await resyncTechOnboardingAck(db, EMP, { storage });
    expect(db.rpc).toHaveBeenCalledWith('ack_my_onboarding_seen', {
      p_surface: TECH_ONBOARDING_SURFACE,
      p_version: 1,
    });
    expect(res).toEqual({ ok: true, retried: true });
    expect(readTechOnboardingMirror(storage).synced).toBe(true);
  });

  it('keeps the mirror unsynced when the retry fails again', async () => {
    const storage = fakeStorage();
    writeTechOnboardingMirror(
      { employeeId: EMP, version: 1, synced: false },
      storage,
    );
    const db = { rpc: vi.fn().mockRejectedValue(new Error('still offline')) };
    const res = await resyncTechOnboardingAck(db, EMP, { storage });
    expect(res).toEqual({ ok: false, retried: true });
    expect(readTechOnboardingMirror(storage).synced).toBe(false);
  });
});
