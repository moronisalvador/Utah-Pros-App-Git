/**
 * ════════════════════════════════════════════════
 * FILE: techOnboarding.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether the signed-in technician should see the first-run welcome
 *   tour, and records that they finished it. The database is the source of
 *   truth (so the tour shows once per PERSON, not once per phone), and a small
 *   local note mirrors that answer so the decision is instant on later
 *   launches, even offline.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (callers pass the authenticated db client)
 *   Data:      reads  → employee_onboarding_state via
 *                       get_my_onboarding_version_seen
 *              writes → employee_onboarding_state via ack_my_onboarding_seen
 *
 * NOTES / GOTCHAS:
 *   - Fail closed: if the server can't answer (offline, or the migration has
 *     not been applied yet), the tour does NOT show. Deploying this code
 *     before the migration applies is therefore safe — the tour stays dark
 *     until the owner-authorized apply window.
 *   - The local mirror is keyed to the employee id, so a different account on
 *     the same phone never inherits "already seen".
 *   - A completion recorded while offline keeps `synced: false`; the shell
 *     entry check quietly retries the server acknowledgement on a later
 *     launch so a re-install / new device still honours it.
 *   - Bump TECH_ONBOARDING_VERSION to re-show a future redesigned tour to
 *     everyone exactly once.
 * ════════════════════════════════════════════════
 */

export const TECH_ONBOARDING_VERSION = 1;
export const TECH_ONBOARDING_SURFACE = 'tech';
export const TECH_ONBOARDING_SEEN_KEY = 'upr:tech-onboarding-seen:v1';

function onboardingStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Read the local mirror. Returns { employeeId, version, synced } or null when
 * absent/invalid — an invalid record is treated exactly like a missing one
 * (the server is asked again; it can only ever re-show, never hide, a tour
 * the server says was seen).
 */
export function readTechOnboardingMirror(storage = onboardingStorage()) {
  let raw;
  try {
    raw = storage?.getItem(TECH_ONBOARDING_SEEN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (
      typeof record?.employeeId !== 'string'
      || !record.employeeId.trim()
      || !Number.isInteger(record.version)
      || record.version < 0
      || typeof record.synced !== 'boolean'
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function writeTechOnboardingMirror(
  { employeeId, version, synced },
  storage = onboardingStorage(),
) {
  if (
    !storage
    || typeof employeeId !== 'string'
    || !employeeId.trim()
    || !Number.isInteger(version)
    || version < 0
  ) {
    return false;
  }
  const value = JSON.stringify({
    employeeId,
    version,
    synced: synced === true,
  });
  try {
    storage.setItem(TECH_ONBOARDING_SEEN_KEY, value);
    return storage.getItem(TECH_ONBOARDING_SEEN_KEY) === value;
  } catch {
    return false;
  }
}

/**
 * Instant local answer for THIS employee: true means the mirror proves the
 * current tour version was already seen. False means "unknown" — ask the
 * server before showing anything.
 */
export function mirrorShowsSeen(
  employeeId,
  storage = onboardingStorage(),
) {
  const mirror = readTechOnboardingMirror(storage);
  return (
    !!mirror
    && mirror.employeeId === employeeId
    && mirror.version >= TECH_ONBOARDING_VERSION
  );
}

/** Server truth. Throws when the RPC is unreachable (caller fails closed). */
export async function fetchTechOnboardingVersionSeen(db) {
  const seen = await db.rpc('get_my_onboarding_version_seen', {
    p_surface: TECH_ONBOARDING_SURFACE,
  });
  return Number.isInteger(seen) && seen >= 0 ? seen : 0;
}

/**
 * Record completion. The local mirror is written FIRST so the tour never
 * re-shows on this device even if the network drops mid-acknowledgement;
 * the server write then flips `synced` when it lands.
 */
export async function ackTechOnboardingSeen(
  db,
  employeeId,
  { storage = onboardingStorage() } = {},
) {
  writeTechOnboardingMirror(
    { employeeId, version: TECH_ONBOARDING_VERSION, synced: false },
    storage,
  );
  try {
    await db.rpc('ack_my_onboarding_seen', {
      p_surface: TECH_ONBOARDING_SURFACE,
      p_version: TECH_ONBOARDING_VERSION,
    });
    writeTechOnboardingMirror(
      { employeeId, version: TECH_ONBOARDING_VERSION, synced: true },
      storage,
    );
    return { ok: true, synced: true };
  } catch {
    // Locally complete; a later shell entry retries the server write.
    return { ok: true, synced: false };
  }
}

/**
 * Quiet reconciliation for a completion recorded offline: if the mirror for
 * THIS employee says seen-but-unsynced, retry the server acknowledgement.
 * No-op in every other case.
 */
export async function resyncTechOnboardingAck(
  db,
  employeeId,
  { storage = onboardingStorage() } = {},
) {
  const mirror = readTechOnboardingMirror(storage);
  if (
    !mirror
    || mirror.employeeId !== employeeId
    || mirror.synced
  ) {
    return { ok: true, retried: false };
  }
  try {
    await db.rpc('ack_my_onboarding_seen', {
      p_surface: TECH_ONBOARDING_SURFACE,
      p_version: mirror.version,
    });
    writeTechOnboardingMirror(
      { employeeId, version: mirror.version, synced: true },
      storage,
    );
    return { ok: true, retried: true };
  } catch {
    return { ok: false, retried: true };
  }
}
