/**
 * ════════════════════════════════════════════════
 * FILE: syncRunnerSingleton.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves logout and account replacement synchronously invalidate the old
 *   offline sender, including stale component references.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  syncRunnerSingleton
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  const runners = [];
  const createSyncRunner = vi.fn(({ owner }) => {
    let active = false;
    const runner = {
      owner,
      start: vi.fn(() => {
        active = true;
        return true;
      }),
      stop: vi.fn(() => {
        active = false;
        return true;
      }),
      isActive: vi.fn(() => active),
      drainOnce: vi.fn(),
      on: vi.fn(),
    };
    runners.push(runner);
    return runner;
  });
  return { createSyncRunner, runners };
});

vi.mock('./syncRunner.js', () => ({
  createSyncRunner: fakes.createSyncRunner,
}));

import {
  getSyncRunner,
  getSyncRunnerOwner,
  initSyncRunner,
  suspendSyncRunner,
} from './syncRunnerSingleton.js';

const OWNER_A = 'v1.aaaaaaaaaaaa';
const OWNER_B = 'v1.bbbbbbbbbbbb';
const CURRENT = () => true;

function deps(owner, employeeId = 'employee-a', db = {}) {
  return {
    db,
    employee: { id: employeeId },
    owner,
    ownerLease: { owner, epoch: `e1.${employeeId}` },
    isOwnerCurrent: CURRENT,
  };
}

describe('sync runner singleton lifecycle', () => {
  beforeEach(() => {
    suspendSyncRunner();
    fakes.createSyncRunner.mockClear();
    fakes.runners.length = 0;
  });

  it('reuses only the exact active db/employee/owner runner', () => {
    const db = {};
    const first = initSyncRunner(deps(OWNER_A, 'employee-a', db));
    const second = initSyncRunner(deps(OWNER_A, 'employee-a', db));

    expect(second).toBe(first);
    expect(fakes.createSyncRunner).toHaveBeenCalledTimes(1);
    expect(getSyncRunner(OWNER_A)).toBe(first);
    expect(getSyncRunner(OWNER_B)).toBe(null);
  });

  it('replaces a same-owner runner when the login epoch changes', () => {
    const db = {};
    const firstDeps = deps(OWNER_A, 'employee-a', db);
    const first = initSyncRunner(firstDeps);
    const second = initSyncRunner({
      ...firstDeps,
      ownerLease: {
        owner: OWNER_A,
        epoch: 'e1.employee-a-new',
      },
    });

    expect(second).not.toBe(first);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(fakes.createSyncRunner).toHaveBeenCalledTimes(2);
  });

  it('incomplete auth stops and forgets the prior runner instead of returning it', () => {
    const first = initSyncRunner(deps(OWNER_A));
    expect(initSyncRunner({
      db: null,
      employee: null,
      owner: null,
      ownerLease: null,
      isOwnerCurrent: CURRENT,
    })).toBe(null);

    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.isActive()).toBe(false);
    expect(getSyncRunner()).toBe(null);
    expect(getSyncRunnerOwner()).toBe(null);
  });

  it('suspends A before constructing B and makes an old A reference inert', () => {
    const dbA = {};
    const dbB = {};
    const first = initSyncRunner(deps(OWNER_A, 'employee-a', dbA));
    const second = initSyncRunner(deps(OWNER_B, 'employee-b', dbB));

    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.isActive()).toBe(false);
    expect(second).not.toBe(first);
    expect(getSyncRunnerOwner()).toBe(OWNER_B);
  });

  it('exposes synchronous suspension metadata for Auth cleanup ordering', () => {
    const first = initSyncRunner(deps(OWNER_A));
    const result = suspendSyncRunner();

    expect(first.stop).toHaveBeenCalledOnce();
    expect(result).toEqual({
      suspended: true,
      hadRunner: true,
      previousOwner: OWNER_A,
    });
    expect(getSyncRunner()).toBe(null);
  });
});
