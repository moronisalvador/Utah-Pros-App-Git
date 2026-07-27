/**
 * ════════════════════════════════════════════════
 * FILE: pwaServiceWorker.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reconciles the push-only service worker whenever the authenticated feature
 *   flag changes. It never waits forever: registration, lookup, readiness,
 *   unregister, and Cache API cleanup all have deadlines.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  public/sw.js
 *   Data:      reads/writes → browser service-worker registrations, Cache API,
 *                             and an identity-free localStorage policy intent
 *
 * NOTES / GOTCHAS:
 *   - `/sw.js` has no fetch handler. Do not add application caching here.
 *   - Disabling intentionally unregisters every same-origin registration because
 *     the April-2026 incident involved an older caching worker at this origin.
 * ════════════════════════════════════════════════
 */
export const PUSH_SERVICE_WORKER_URL = '/sw.js';
export const PUSH_SERVICE_WORKER_SCOPE = '/';
export const SERVICE_WORKER_TIMEOUT_MS = 8_000;
export const PUSH_SERVICE_WORKER_POLICY_KEY = 'upr:push-sw-policy:v1';
const PUSH_SERVICE_WORKER_POLICY_SCHEMA = 1;

export function withDeadline(
  value,
  timeoutMs = SERVICE_WORKER_TIMEOUT_MS,
  label = 'operation',
  {
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    onLateSettlement,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(value);
  const operation = Promise.resolve(value);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const timer = setTimer(
      () => {
        if (settled) return;
        timedOut = true;
        reject(new Error(`${label} timed out`));
      },
      timeoutMs,
    );
    operation.then(
      (result) => {
        settled = true;
        clearTimer(timer);
        if (timedOut && onLateSettlement) {
          try {
            onLateSettlement(result, null);
          } catch {
            // A repair callback must not create an unhandled rejection.
          }
        }
        resolve(result);
      },
      (error) => {
        settled = true;
        clearTimer(timer);
        if (timedOut && onLateSettlement) {
          try {
            onLateSettlement(undefined, error);
          } catch {
            // A repair callback must not create an unhandled rejection.
          }
        }
        reject(error);
      },
    );
  });
}

function currentOrigin() {
  try {
    return globalThis.location?.origin || null;
  } catch {
    return null;
  }
}

/** True only for the reviewed same-origin push-only worker script. */
export function isPushServiceWorkerRegistration(registration, origin = currentOrigin()) {
  const worker = registration?.active || registration?.waiting || registration?.installing;
  if (!worker?.scriptURL || !origin) return false;
  try {
    const script = new URL(worker.scriptURL, origin);
    return script.origin === origin && script.pathname === PUSH_SERVICE_WORKER_URL;
  } catch {
    return false;
  }
}

function resolveServiceWorkerContainer(override) {
  if (override) return override;
  try {
    return globalThis.navigator?.serviceWorker || null;
  } catch {
    return null;
  }
}

export async function lookupPushServiceWorkerRegistration({
  serviceWorker,
  timeoutMs = SERVICE_WORKER_TIMEOUT_MS,
  origin = currentOrigin(),
} = {}) {
  const container = resolveServiceWorkerContainer(serviceWorker);
  if (!container?.getRegistration) {
    return { status: 'unsupported', registration: null };
  }
  try {
    const registration = await withDeadline(
      container.getRegistration(PUSH_SERVICE_WORKER_SCOPE),
      timeoutMs,
      'service worker lookup',
    );
    if (!registration) return { status: 'missing', registration: null };
    if (!isPushServiceWorkerRegistration(registration, origin)) {
      return { status: 'unexpected', registration };
    }
    return { status: 'found', registration };
  } catch (error) {
    return {
      status: 'unknown',
      registration: null,
      error,
      reason: /timed out/i.test(error?.message || '') ? 'timeout' : 'error',
    };
  }
}

export async function getPushServiceWorkerRegistration(options = {}) {
  const lookup = await lookupPushServiceWorkerRegistration(options);
  return lookup.status === 'found' ? lookup.registration : null;
}

function withMutationDeadline(
  value,
  timeoutMs,
  label,
  onLateMutation,
  didMutate = (result) => result !== false,
) {
  return withDeadline(value, timeoutMs, label, {
    onLateSettlement: (result, error) => {
      if (!error && didMutate(result)) onLateMutation?.();
    },
  });
}

async function clearCacheApi(cacheStorage, timeoutMs, onLateMutation) {
  if (!cacheStorage?.keys) return 0;
  const keys = await withDeadline(cacheStorage.keys(), timeoutMs, 'cache listing');
  await withDeadline(
    Promise.all(keys.map((key) => withMutationDeadline(
      cacheStorage.delete(key),
      timeoutMs,
      'cache entry cleanup',
      onLateMutation,
      (result) => result === true,
    ).catch(() => false))),
    timeoutMs,
    'cache cleanup',
  );
  return keys.length;
}

/**
 * Make browser registration state match the authenticated feature flag.
 * Returns a result object instead of throwing so app bootstrap stays recoverable.
 */
async function reconcilePushServiceWorkerNow(
  enabled,
  {
    serviceWorker,
    cacheStorage = globalThis.caches,
    timeoutMs = SERVICE_WORKER_TIMEOUT_MS,
    origin = currentOrigin(),
    clearCaches = !enabled,
    onLateMutation,
  } = {},
) {
  const container = resolveServiceWorkerContainer(serviceWorker);
  if (!container) return { ok: false, reason: 'unsupported', enabled: false };

  try {
    if (enabled) {
      const existing = await withDeadline(
        container.getRegistration?.(PUSH_SERVICE_WORKER_SCOPE),
        timeoutMs,
        'service worker lookup',
      );
      if (isPushServiceWorkerRegistration(existing, origin)) {
        return { ok: true, enabled: true, registration: existing, changed: false };
      }

      let removedLegacy = false;
      if (existing?.unregister) {
        removedLegacy = await withMutationDeadline(
          existing.unregister(),
          timeoutMs,
          'legacy service worker removal',
          onLateMutation,
          (result) => result === true,
        ).catch(() => false);
      }
      if (removedLegacy) {
        await clearCacheApi(cacheStorage, timeoutMs, onLateMutation);
      }

      const registration = await withMutationDeadline(
        container.register(PUSH_SERVICE_WORKER_URL, { scope: PUSH_SERVICE_WORKER_SCOPE }),
        timeoutMs,
        'service worker registration',
        onLateMutation,
      );
      if (!isPushServiceWorkerRegistration(registration, origin)) {
        return { ok: false, reason: 'unexpected_registration', enabled: false };
      }
      return {
        ok: true,
        enabled: true,
        registration,
        changed: true,
        removedLegacy,
        reloadRequired: removedLegacy,
      };
    }

    const registrations = container.getRegistrations
      ? await withDeadline(container.getRegistrations(), timeoutMs, 'service worker listing')
      : [];
    const removed = await withDeadline(
      Promise.all(
        (registrations || []).map((registration) =>
          withMutationDeadline(
            registration.unregister?.(),
            timeoutMs,
            'service worker removal',
            onLateMutation,
            (result) => result === true,
          ).catch(() => false)),
      ),
      timeoutMs,
      'service worker removal',
    );
    const removedCount = removed.filter(Boolean).length;
    const clearedCaches = clearCaches
      ? await clearCacheApi(cacheStorage, timeoutMs, onLateMutation)
      : 0;
    return {
      ok: true,
      enabled: false,
      changed: removedCount > 0 || clearedCaches > 0,
      removedCount,
      clearedCaches,
      reloadRequired: removedCount > 0,
    };
  } catch (error) {
    console.warn('[sw] reconciliation failed', error);
    return {
      ok: false,
      reason: /timed out/i.test(error?.message || '') ? 'timeout' : 'error',
      enabled: false,
    };
  }
}

function resolvePolicyStorage(override) {
  if (override !== undefined) return override;
  try {
    return globalThis.window?.localStorage || null;
  } catch {
    return null;
  }
}

function resolvePolicyEventTarget(override) {
  if (override !== undefined) return override;
  try {
    return globalThis.window?.addEventListener ? globalThis.window : null;
  } catch {
    return null;
  }
}

function makePolicyIntentToken() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a non-identifying per-intent random token.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parsePolicyIntent(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.schema !== PUSH_SERVICE_WORKER_POLICY_SCHEMA
      || !Number.isSafeInteger(parsed.version)
      || parsed.version < 1
      || typeof parsed.enabled !== 'boolean'
      || typeof parsed.token !== 'string'
      || parsed.token.length < 1
      || parsed.token.length > 128
    ) {
      return null;
    }
    return {
      schema: PUSH_SERVICE_WORKER_POLICY_SCHEMA,
      version: parsed.version,
      enabled: parsed.enabled,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

function isSamePolicyIntent(left, right) {
  return !!left
    && !!right
    && left.version === right.version
    && left.token === right.token
    && left.enabled === right.enabled;
}

/**
 * Build one tab/document policy coordinator.
 *
 * The persisted record contains only a boolean, a monotonic revision, and a
 * random per-intent tie-break token. It contains no user, employee, device, or
 * subscription identity. Storage events always trigger a fresh storage read;
 * out-of-order events therefore cannot roll a tab back from the final stored
 * value.
 */
export function createPushServiceWorkerPolicyCoordinator({
  storage: storageOverride,
  eventTarget: eventTargetOverride,
  defaultOptions = {},
  makeToken = makePolicyIntentToken,
} = {}) {
  const storage = resolvePolicyStorage(storageOverride);
  const eventTarget = resolvePolicyEventTarget(eventTargetOverride);
  let generation = 0;
  let queue = Promise.resolve();
  let latestDesiredState = false;
  let latestIntent = null;
  let latestOptions = { ...defaultOptions };
  let localVersion = 0;
  let listening = false;

  const readStoredIntent = () => {
    if (!storage?.getItem) return null;
    try {
      const intent = parsePolicyIntent(
        storage.getItem(PUSH_SERVICE_WORKER_POLICY_KEY),
      );
      if (intent) localVersion = Math.max(localVersion, intent.version);
      return intent;
    } catch {
      return null;
    }
  };

  const supersededResult = (candidate, intermediateResult = null) => ({
    ok: true,
    enabled: latestDesiredState,
    changed: false,
    reloadRequired: false,
    superseded: true,
    generation: candidate,
    intermediateChanged: intermediateResult?.changed === true,
  });

  let scheduleIntent;

  const repairAfterLateMutation = () => {
    const authoritativeIntent = readStoredIntent() || latestIntent;
    if (authoritativeIntent) {
      scheduleIntent(authoritativeIntent, latestOptions);
    }
  };

  const adoptStoredIntent = (intent) => {
    if (!intent || isSamePolicyIntent(intent, latestIntent)) return null;
    return scheduleIntent(intent, latestOptions);
  };

  const onStorage = (event) => {
    if (
      event?.key !== PUSH_SERVICE_WORKER_POLICY_KEY
      && event?.key !== null
    ) {
      return;
    }
    adoptStoredIntent(readStoredIntent());
  };

  const start = () => {
    if (
      listening
      || !eventTarget?.addEventListener
    ) {
      return stop;
    }
    eventTarget.addEventListener('storage', onStorage);
    listening = true;
    adoptStoredIntent(readStoredIntent());
    return stop;
  };

  const stop = () => {
    if (!listening) return;
    eventTarget?.removeEventListener?.('storage', onStorage);
    listening = false;
  };

  scheduleIntent = (intent, options = latestOptions) => {
    latestIntent = intent;
    latestDesiredState = intent.enabled;
    const taskOptions = { ...defaultOptions, ...options };
    latestOptions = taskOptions;
    localVersion = Math.max(localVersion, intent.version);
    const candidate = ++generation;

    const result = queue
      .catch(() => undefined)
      .then(async () => {
        if (candidate !== generation) {
          return supersededResult(candidate);
        }

        const before = readStoredIntent();
        if (before && !isSamePolicyIntent(before, intent)) {
          adoptStoredIntent(before);
          return supersededResult(candidate);
        }

        const reconciled = await reconcilePushServiceWorkerNow(
          intent.enabled,
          {
            ...taskOptions,
            onLateMutation: repairAfterLateMutation,
          },
        );
        const after = readStoredIntent();
        if (after && !isSamePolicyIntent(after, intent)) {
          adoptStoredIntent(after);
        }
        if (
          candidate !== generation
          || (after && !isSamePolicyIntent(after, intent))
        ) {
          return supersededResult(candidate, reconciled);
        }
        return { ...reconciled, generation: candidate, superseded: false };
      });

    queue = result.catch(() => undefined);
    return result;
  };

  const publishIntent = (enabled) => {
    const previous = readStoredIntent();
    const intent = {
      schema: PUSH_SERVICE_WORKER_POLICY_SCHEMA,
      version: Math.max(localVersion, previous?.version || 0) + 1,
      enabled: !!enabled,
      token: String(makeToken()).slice(0, 128),
    };
    localVersion = intent.version;

    if (storage?.setItem) {
      try {
        storage.setItem(
          PUSH_SERVICE_WORKER_POLICY_KEY,
          JSON.stringify(intent),
        );
        // A competing tab may have written after this tab. The actual final
        // storage value, not the local request, is authoritative.
        return readStoredIntent() || intent;
      } catch {
        // Storage-blocked browsers retain exact same-tab generation semantics.
      }
    }
    return intent;
  };

  const reconcile = (enabled, options = {}) => {
    start();
    latestOptions = { ...defaultOptions, ...options };
    return scheduleIntent(publishIntent(enabled), latestOptions);
  };

  const syncFromStorage = () => {
    start();
    return adoptStoredIntent(readStoredIntent());
  };

  const whenIdle = async () => {
    // A storage event or a stale operation may append another convergence task
    // while the current queue is settling.
    while (true) {
      const observed = queue;
      await observed.catch(() => undefined);
      if (observed === queue) return;
    }
  };

  return {
    reconcile,
    readStoredIntent,
    start,
    stop,
    syncFromStorage,
    whenIdle,
  };
}

const defaultPolicyCoordinator = createPushServiceWorkerPolicyCoordinator();

/**
 * Serialize policy changes and make the newest same-tab or stored cross-tab
 * intent authoritative.
 */
export function reconcilePushServiceWorker(enabled, options = {}) {
  return defaultPolicyCoordinator.reconcile(enabled, options);
}

/**
 * Return an active reviewed registration for a user-initiated Push subscribe.
 * `navigator.serviceWorker.ready` is still used for activation, but is bounded.
 */
export async function getReadyPushServiceWorkerRegistration({
  serviceWorker,
  cacheStorage = globalThis.caches,
  timeoutMs = SERVICE_WORKER_TIMEOUT_MS,
  origin = currentOrigin(),
} = {}) {
  const container = resolveServiceWorkerContainer(serviceWorker);
  if (!container) return null;
  const reconciled = await reconcilePushServiceWorker(true, {
    serviceWorker: container,
    cacheStorage,
    timeoutMs,
    origin,
  });
  if (!reconciled.ok || reconciled.superseded || !reconciled.enabled) return null;
  if (reconciled.registration?.active) return reconciled.registration;

  try {
    const ready = await withDeadline(
      container.ready,
      timeoutMs,
      'service worker activation',
    );
    return isPushServiceWorkerRegistration(ready, origin) ? ready : null;
  } catch {
    return null;
  }
}
