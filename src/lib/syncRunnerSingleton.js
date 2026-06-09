// Lazy singleton for the sync runner. One instance per page load, regardless of how many
// components use `useOfflineQueue`. The first call to `initSyncRunner` wires it up; subsequent
// calls are no-ops unless the `db` or `employee.id` changes (e.g. after login/logout).

import { createSyncRunner } from './syncRunner';

let _runner = null;
let _authKey = null; // tracks which (db, employee.id) pair the current runner was built for

/**
 * Ensure a runner exists for the given auth context. Safe to call on every render.
 * @param {{db:object, employee:object}} deps
 * @returns {object|null} the active runner, or null if deps are incomplete
 */
export function initSyncRunner({ db, employee }) {
  if (!db || !employee?.id) return _runner;

  const key = `${employee.id}:${db.apiKey || 'anon'}`;
  if (_runner && _authKey === key) return _runner;

  // Auth changed (login/logout/refresh). Tear down old runner before creating a new one.
  if (_runner) {
    try { _runner.stop(); } catch { /* ignore */ }
  }
  _runner = createSyncRunner({ db, employee });
  _authKey = key;
  _runner.start();
  return _runner;
}

/** Read the current runner without initializing. Returns null before `initSyncRunner`. */
export function getSyncRunner() {
  return _runner;
}
