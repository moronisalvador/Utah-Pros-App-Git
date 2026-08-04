/**
 * ════════════════════════════════════════════════
 * FILE: apns.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Delivers an employee notification to the iPhones registered for the exact
 *   Apple environment being used. It refuses incomplete configuration, limits
 *   simultaneous Apple calls, claims each source-event/device delivery before
 *   contacting Apple, and removes only registrations proven stale.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./http.js, ../../src/lib/nativeNavigationTarget.js
 *   Data:      reads  → device_tokens
 *              writes → native_push_delivery_claims (claim/release);
 *                       appointment-reminder authority is rechecked by its
 *                       dedicated native claim RPC;
 *                       device_tokens (permanent-token cleanup only)
 *
 * NOTES / GOTCHAS:
 *   - APNS_ENV is mandatory and must be sandbox or production. There is no
 *     default because a wrong guess makes one environment delete another's token.
 *   - Each registration row may carry its own apns_topic (the installed app's
 *     bundle id, e.g. the side-by-side "UPR Dev" app). A row's topic wins;
 *     rows without one fall back to the env APNS_TOPIC, so APNS_TOPIC stays
 *     mandatory. One env-wide topic caused the 2026-07-30 fleet outage
 *     (DeviceTokenNotForTopic) once two bundle ids shared a deployment.
 *   - Results never include raw APNs tokens.
 *   - A stable source-event occurrence is claimed durably before provider use.
 *     The same identity is also sent as apns-collapse-id so Apple merges a
 *     repeated request rather than displaying a second copy.
 *   - Explicit 429/5xx refusal is safe to retry after releasing/reclaiming.
 *     Network/timeout ambiguity retains the claim and is never auto-replayed.
 * ════════════════════════════════════════════════
 */
import { fetchWithTimeout } from './http.js';
import { resolveNativePushRoute } from '../../src/lib/nativeNavigationTarget.js';
import {
  buildGenericNativeNotificationPresentation,
  buildNativeNotificationPresentation,
  resolveConfiguredNotificationPresentation,
} from './notificationPresentation.js';

const APNS_TIMEOUT_MS = 15_000;
const APNS_CONCURRENCY = 5;
const APNS_PROVIDER_ATTEMPTS = 2;
const APNS_MAX_PAYLOAD_BYTES = 4_096;
const APNS_ALERT_TITLE = 'Utah Pros notification';
const APNS_ALERT_BODY = 'Open Utah Pros for details.';
const APNS_DELIVERY_ENVIRONMENTS = Object.freeze(['sandbox', 'production']);
export const APNS_MAX_TOKENS_PER_EMPLOYEE = 5;
const jwtCache = new Map();

export function readApnsConfig(env = {}) {
  const missing = [];
  if (!env.APNS_P8_KEY) missing.push('APNS_P8_KEY');
  if (!env.APNS_KEY_ID) missing.push('APNS_KEY_ID');
  if (!env.APNS_TEAM_ID) missing.push('APNS_TEAM_ID');
  if (!env.APNS_TOPIC) missing.push('APNS_TOPIC');
  if (env.APNS_ENV !== 'sandbox' && env.APNS_ENV !== 'production') {
    missing.push('APNS_ENV');
  }
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    p8: env.APNS_P8_KEY,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    topic: env.APNS_TOPIC,
    environment: env.APNS_ENV,
  };
}

function b64url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlJson(value) {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function importP8Key(pem) {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function signApnsJwt(config, nowSeconds = Math.floor(Date.now() / 1000)) {
  const cacheKey = `${config.teamId}:${config.keyId}`;
  const cached = jwtCache.get(cacheKey);
  if (cached?.expiresAt > nowSeconds + 60) return cached.jwt;

  const key = await importP8Key(config.p8);
  const header = b64urlJson({ alg: 'ES256', kid: config.keyId });
  const claims = b64urlJson({ iss: config.teamId, iat: nowSeconds });
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  jwtCache.set(cacheKey, { jwt, expiresAt: nowSeconds + 50 * 60 });
  return jwt;
}

export async function stableApnsId(value) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

async function responseDetails(response) {
  try {
    const parsed = JSON.parse(await response.text());
    return {
      reason: typeof parsed?.reason === 'string'
        ? parsed.reason.slice(0, 120)
        : 'APNs rejected notification',
      timestamp: parsed?.timestamp,
    };
  } catch {
    return {
      reason: 'APNs rejected notification',
      timestamp: null,
    };
  }
}

function apnsInvalidatedAt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 1_000_000_000_000
    ? numeric * 1_000
    : numeric;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function safeNativeData(data, employeeId) {
  return {
    url: resolveNativePushRoute(data?.url),
    recipient: await stableApnsId(`native-recipient:${employeeId}`),
  };
}

async function releaseDeliveryClaim(db, deliveryKey) {
  try {
    return await db.rpc('release_native_push_delivery_claim', {
      p_delivery_key: deliveryKey,
    }) === true;
  } catch {
    // A failed release stays claimed. That safely prevents an uncertain retry
    // from producing a duplicate alert, at the cost of a missed retry.
    return false;
  }
}

async function claimDelivery(db, {
  deliveryKey,
  employeeId,
  deviceTokenId,
  deviceFingerprint,
  deviceToken,
  apnsEnvironment,
  guardedProducerClaim = null,
  appointmentReminderClaim = null,
}) {
  try {
    if (appointmentReminderClaim) {
      return await db.rpc('claim_appointment_reminder_native_delivery', {
        p_delivery_key: deliveryKey,
        p_notification_event_id:
          appointmentReminderClaim.notificationEventId,
        p_employee_id: employeeId,
        p_appointment_id: appointmentReminderClaim.appointmentId,
        p_device_token_id: deviceTokenId,
        p_device_fingerprint: deviceFingerprint,
        p_token: deviceToken,
        p_apns_environment: apnsEnvironment,
      }) === true;
    }
    if (guardedProducerClaim) {
      return await db.rpc('claim_guarded_native_push_delivery', {
        p_delivery_key: deliveryKey,
        p_notification_event_id:
          guardedProducerClaim.notificationEventId,
        p_employee_id: employeeId,
        p_type_key: guardedProducerClaim.typeKey,
        p_entity_type: guardedProducerClaim.entityType,
        p_entity_id: guardedProducerClaim.entityId,
        p_device_token_id: deviceTokenId,
        p_device_fingerprint: deviceFingerprint,
        p_token: deviceToken,
        p_apns_environment: apnsEnvironment,
      }) === true;
    }
    return await db.rpc('claim_native_push_delivery', {
      p_delivery_key: deliveryKey,
      p_employee_id: employeeId,
      p_device_token_id: deviceTokenId,
      p_device_fingerprint: deviceFingerprint,
    }) === true;
  } catch {
    return false;
  }
}

export async function sendNativePushToEmployee({
  db,
  env,
  employeeId,
  typeKey,
  notificationBody = {},
  eventKey,
  guardedProducerClaim = null,
  appointmentReminderClaim = null,
  fetchImpl = fetchWithTimeout,
  signJwtImpl = signApnsJwt,
}) {
  const config = readApnsConfig(env);
  if (!config.ok) {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_not_configured',
    };
  }
  if (!employeeId || !eventKey) {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'invalid_notification',
    };
  }

  let tokens = [];
  try {
    tokens = await db.select(
      'device_tokens',
      `employee_id=eq.${employeeId}`
        + `&platform=eq.ios`
        + `&apns_environment=eq.${config.environment}`
        + '&select=id,token,updated_at,apns_topic'
        + '&order=updated_at.desc'
        + `&limit=${APNS_MAX_TOKENS_PER_EMPLOYEE}`,
    );
  } catch {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'token_lookup_failed',
    };
  }
  if (!tokens?.length) {
    return { sent: 0, attempted: 0, pruned: 0, reason: 'no_tokens' };
  }

  let jwt;
  try {
    jwt = await signJwtImpl(config);
  } catch {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_signing_failed',
    };
  }

  const host = config.environment === 'production'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
  // Lock-screen content is privacy-sensitive. Rich copy is therefore opt-in:
  // only the exact server value "true" may include typed presentation details.
  const richPresentationEnabled = env.NATIVE_RICH_NOTIFICATION_PRESENTATION === 'true';
  const genericFallback = buildGenericNativeNotificationPresentation(
    typeKey,
    notificationBody,
  );
  const nativeFallback = richPresentationEnabled
    ? buildNativeNotificationPresentation(typeKey, notificationBody)
    : genericFallback;
  let presentation = richPresentationEnabled
    ? await resolveConfiguredNotificationPresentation({
      db,
      typeKey,
      surfaceKey: 'native_push',
      body: notificationBody,
      fallback: nativeFallback,
      renderFailureFallback: genericFallback,
    })
    : nativeFallback;
  const serializePayload = async (selectedPresentation) => JSON.stringify({
      aps: {
        alert: {
          title: selectedPresentation.title || APNS_ALERT_TITLE,
          body: selectedPresentation.body || APNS_ALERT_BODY,
        },
        sound: 'default',
      },
      data: await safeNativeData({ url: selectedPresentation.url }, employeeId),
  });
  let payload = await serializePayload(presentation);
  if (new TextEncoder().encode(payload).byteLength > APNS_MAX_PAYLOAD_BYTES) {
    presentation = genericFallback;
    payload = await serializePayload(presentation);
  }

  const results = await Promise.all(tokens.slice(0, APNS_CONCURRENCY).map(async (row) => {
    // Apple validates the topic against the app the token was minted for, so
    // a registration that recorded its own bundle id is addressed with it;
    // legacy rows (no recorded topic) keep the deployment-wide APNS_TOPIC.
    const rowTopic = typeof row.apns_topic === 'string' && row.apns_topic.trim()
      ? row.apns_topic.trim()
      : config.topic;
    // Token row ids are registration lifecycle details: logout/cap pruning can
    // delete them. Hash the token into a non-reversible stable fingerprint so a
    // delete + re-register cannot erase the 90-day source-event replay fence.
    const deviceFingerprint = await stableApnsId(
      `apns-token:${config.environment}:${row.token}`,
    );
    const apnsId = await stableApnsId(
      `${eventKey}:${employeeId}:${config.environment}:${deviceFingerprint}`,
    );
    let claimed = await claimDelivery(db, {
      deliveryKey: apnsId,
      employeeId,
      deviceTokenId: row.id,
      deviceFingerprint,
      deviceToken: row.token,
      apnsEnvironment: config.environment,
      guardedProducerClaim,
      appointmentReminderClaim,
    });
    if (!claimed) {
      return {
        id: row.id,
        ok: false,
        status: 0,
        reason: 'delivery_already_claimed',
      };
    }

    for (let providerAttempt = 1; providerAttempt <= APNS_PROVIDER_ATTEMPTS; providerAttempt++) {
      try {
        const response = await fetchImpl(
          `${host}/3/device/${row.token}`,
          {
            method: 'POST',
            headers: {
              authorization: `bearer ${jwt}`,
              'apns-topic': rowTopic,
              'apns-push-type': 'alert',
              'apns-priority': '10',
              'apns-expiration': '0',
              'apns-id': apnsId,
              'apns-collapse-id': apnsId,
            },
            body: payload,
          },
          APNS_TIMEOUT_MS,
        );
        if (response.ok) {
          return {
            id: row.id,
            ok: true,
            status: response.status,
            provider_attempts: providerAttempt,
          };
        }

        const { reason, timestamp } = await responseDetails(response);
        const permanent = response.status === 410
          || (response.status === 400 && reason === 'BadDeviceToken');
        let pruned = false;
        if (permanent) {
          const invalidatedAt = response.status === 410
            ? apnsInvalidatedAt(timestamp)
            : null;
          try {
            pruned = response.status !== 410 || invalidatedAt
              ? await db.rpc('prune_stale_native_device_token', {
                  p_device_token_id: row.id,
                  p_token: row.token,
                  p_apns_environment: config.environment,
                  p_observed_updated_at: row.updated_at,
                  p_invalidated_at: invalidatedAt,
                }) === true
              : false;
          } catch {
            pruned = false;
          }
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) {
          return {
            id: row.id,
            ok: false,
            status: response.status,
            reason,
            pruned,
            provider_attempts: providerAttempt,
          };
        }

        const released = await releaseDeliveryClaim(db, apnsId);
        if (!released) {
          return {
            id: row.id,
            ok: false,
            status: response.status,
            reason: 'claim_release_failed',
            ambiguous: true,
            provider_attempts: providerAttempt,
          };
        }
        if (providerAttempt === APNS_PROVIDER_ATTEMPTS) {
          return {
            id: row.id,
            ok: false,
            status: response.status,
            reason,
            retryable: true,
            provider_attempts: providerAttempt,
          };
        }

        claimed = await claimDelivery(db, {
          deliveryKey: apnsId,
          employeeId,
          deviceTokenId: row.id,
          deviceFingerprint,
          deviceToken: row.token,
          apnsEnvironment: config.environment,
          guardedProducerClaim,
          appointmentReminderClaim,
        });
        if (!claimed) {
          return {
            id: row.id,
            ok: false,
            status: response.status,
            reason: 'retry_claim_unavailable',
            provider_attempts: providerAttempt,
          };
        }
      } catch {
        // A timeout/network error is ambiguous: Apple may have accepted the
        // request. Retain the claim and never automatically double-send.
        return {
          id: row.id,
          ok: false,
          status: 0,
          reason: 'provider_unavailable',
          ambiguous: true,
          provider_attempts: providerAttempt,
        };
      }
    }

    return { id: row.id, ok: false, status: 0, reason: 'provider_unavailable' };
  }));

  return {
    sent: results.filter((result) => result.ok).length,
    attempted: results.length,
    pruned: results.filter((result) => result.pruned).length,
    retryable: results.some((result) => result.retryable),
    ambiguous: results.some((result) => result.ambiguous),
    results,
  };
}

/**
 * Deliver one trusted occurrence to both Apple environments. UPR's shared
 * production database feeds direct-development (sandbox) and TestFlight/App
 * Store (production) installs at the same time, so choosing only the Worker's
 * own APNS_ENV strands one cohort. Each environment still performs an exact
 * token query, uses its own provider host, and claims an environment-specific
 * delivery identity.
 */
export async function sendNativePushToEmployeeAcrossEnvironments({
  sendImpl = sendNativePushToEmployee,
  ...input
}) {
  const configured = readApnsConfig(input.env);
  if (!configured.ok) {
    return {
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_not_configured',
      environments: {},
    };
  }

  const attempts = await Promise.allSettled(
    APNS_DELIVERY_ENVIRONMENTS.map((environment) => sendImpl({
      ...input,
      env: {
        ...input.env,
        APNS_ENV: environment,
      },
    })),
  );
  const environments = Object.fromEntries(
    APNS_DELIVERY_ENVIRONMENTS.map((environment, index) => {
      const outcome = attempts[index];
      return [
        environment,
        outcome.status === 'fulfilled'
          ? outcome.value
          : {
            sent: 0,
            attempted: 0,
            pruned: 0,
            skipped: false,
            retryable: true,
            ambiguous: false,
            reason: 'native_push_failed',
          },
      ];
    }),
  );
  const summaries = Object.values(environments);

  return {
    sent: summaries.reduce((sum, result) => sum + (result?.sent || 0), 0),
    attempted: summaries.reduce((sum, result) => sum + (result?.attempted || 0), 0),
    pruned: summaries.reduce((sum, result) => sum + (result?.pruned || 0), 0),
    retryable: summaries.some((result) => result?.retryable),
    ambiguous: summaries.some((result) => result?.ambiguous),
    skipped: summaries.every((result) => result?.skipped === true),
    reason: summaries.every((result) => result?.reason === 'no_tokens')
      ? 'no_tokens'
      : undefined,
    environments,
  };
}
