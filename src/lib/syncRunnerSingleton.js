/**
 * ════════════════════════════════════════════════
 * FILE: syncRunnerSingleton.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps exactly one offline sender alive in a browser tab. Logout or an
 *   account change invalidates the old sender synchronously, before any slower
 *   push or browser cleanup begins.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  syncRunner
 *   Data:      none directly
 *
 * NOTES / GOTCHAS:
 *   - Incomplete auth never returns the previous account's runner.
 *   - A suspended runner is disposed permanently; stale component references
 *     cannot restart or drain it.
 * ════════════════════════════════════════════════
 */

import { createSyncRunner } from './syncRunner';

let currentRunner = null;
let currentDb = null;
let currentEmployeeId = null;
let currentOwner = null;
let currentEpoch = null;

/**
 * Stop and forget the current runner immediately. Safe to call repeatedly.
 * This function intentionally performs no await.
 */
export function suspendSyncRunner() {
  const runner = currentRunner;
  const previousOwner = currentOwner;
  currentRunner = null;
  currentDb = null;
  currentEmployeeId = null;
  currentOwner = null;
  currentEpoch = null;
  if (runner) {
    try {
      runner.stop();
    } catch {
      // References were already invalidated above; cleanup remains fail closed.
    }
  }
  return {
    suspended: true,
    hadRunner: !!runner,
    previousOwner,
  };
}

/**
 * Ensure an owner-bound runner exists for the verified auth context.
 */
export function initSyncRunner({
  db,
  employee,
  owner,
  ownerLease,
  isOwnerCurrent,
}) {
  if (
    !db
    || !employee?.id
    || !owner
    || ownerLease?.owner !== owner
    || !ownerLease?.epoch
    || typeof isOwnerCurrent !== 'function'
  ) {
    suspendSyncRunner();
    return null;
  }

  if (
    currentRunner
    && currentDb === db
    && currentEmployeeId === employee.id
    && currentOwner === owner
    && currentEpoch === ownerLease.epoch
    && currentRunner.isActive()
  ) {
    return currentRunner;
  }

  suspendSyncRunner();
  const runner = createSyncRunner({
    db,
    employee,
    owner,
    ownerLease,
    isOwnerCurrent,
  });
  currentRunner = runner;
  currentDb = db;
  currentEmployeeId = employee.id;
  currentOwner = owner;
  currentEpoch = ownerLease.epoch;
  if (!runner.start()) {
    suspendSyncRunner();
    return null;
  }
  return runner;
}

/**
 * Read the active runner. Supplying owner prevents a stale caller from
 * retrieving a runner that belongs to a later account.
 */
export function getSyncRunner(owner = null) {
  if (!currentRunner?.isActive?.()) return null;
  if (owner && owner !== currentOwner) return null;
  return currentRunner;
}

export function getSyncRunnerOwner() {
  return getSyncRunner() ? currentOwner : null;
}
