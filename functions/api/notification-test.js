/**
 * ════════════════════════════════════════════════
 * FILE: notification-test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the company owner verify one notification delivery channel at a time
 *   or deliver one safe synthetic example of a named catalog event to their
 *   own bell, PWA, or iPhone.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/notification-test
 *   Rendered by:  DevTools → Advanced → Notifications
 *
 * DEPENDS ON:
 *   Internal:  ../lib/auth.js, ../lib/supabase.js, ../lib/http.js,
 *              ../lib/webPush.js, ../lib/apns.js, ../lib/email.js,
 *              ../lib/notificationPresentation.js
 *   Data:      reads  → push_subscriptions, device_tokens, employees,
 *                       notification_types, notification_presentation_overrides
 *              writes → notification_delivery_diagnostic_claims, notifications;
 *                       expired push/device token cleanup
 *
 * NOTES / GOTCHAS:
 *   - The browser cannot choose a recipient, title, body, route, or provider.
 *     A caller may name only one of the 15 code-owned event keys.
 *   - SMS/MMS are intentionally absent. This diagnostic never enters a customer
 *     messaging or automated-send path.
 *   - request_id is client-created and stable across retries. APNs and Resend
 *     consume it as their idempotency identity. Typed tests derive a distinct
 *     UUID from request_id + channel + event key so a retry cannot cross-replay
 *     another event or the generic channel test.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { requireOwner } from '../lib/auth.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { loadVapidConfig, sendWebPush } from '../lib/webPush.js';
import { sendNativePushToEmployee, stableApnsId } from '../lib/apns.js';
import { sendEmail } from '../lib/email.js';
import {
  getNotificationPresentationCatalog,
  previewNotificationPresentation,
} from '../lib/notificationPresentation.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(['bell', 'web_push', 'native_push', 'email']);
const TYPED_CHANNELS = new Set(['bell', 'web_push', 'native_push']);
const PRESENTATION_SURFACE = Object.freeze({
  bell: 'bell',
  web_push: 'pwa_push',
  native_push: 'native_push',
});
const TEST_ROUTE = '/dev-tools?tab=advanced&sub=notifications';
const TEST_FROM = 'UPR - Notifications <restoration@utahpros.app>';
const PRESENTATION_CATALOG = getNotificationPresentationCatalog();
const PRESENTATION_EVENT_BY_KEY = new Map(
  PRESENTATION_CATALOG.map((event) => [event.type_key, event]),
);
const TEST_COPY = Object.freeze({
  bell: {
    title: 'UPR bell test',
    body: 'In-app bell notifications are working for your account.',
  },
  web_push: {
    title: 'UPR browser push test',
    body: 'Browser push notifications are working for your account.',
  },
  email: {
    title: 'UPR email notification test',
    body: 'Email notifications are working for your account.',
  },
});

function summary(channel, values = {}) {
  const sent = Number(values.sent || 0);
  const attempted = Number(values.attempted || 0);
  return {
    channel,
    ok: typeof values.ok === 'boolean' ? values.ok : sent > 0,
    sent,
    attempted,
    pruned: Number(values.pruned || 0),
    ...(values.reason ? { reason: values.reason } : {}),
  };
}

function validStoredResult(channel, result) {
  return (
    result
    && typeof result === 'object'
    && !Array.isArray(result)
    && result.channel === channel
    && typeof result.ok === 'boolean'
    && Number.isFinite(Number(result.sent))
    && Number.isFinite(Number(result.attempted))
    && Number.isFinite(Number(result.pruned))
  );
}

function configForSurface(surface, override) {
  if (override?.enabled === true) {
    return {
      title_template: override.title_template,
      body_template: override.body_template,
      route_id: override.route_id,
      contract_version: override.contract_version,
    };
  }
  return { ...surface.default_config };
}

async function loadTypedPresentation({ db, typeKey, channel }) {
  const event = PRESENTATION_EVENT_BY_KEY.get(typeKey);
  const surfaceKey = PRESENTATION_SURFACE[channel];
  const surface = event?.surfaces?.[surfaceKey];
  if (!surface) return { ok: false, reason: 'unsupported_type' };

  let typeRows;
  let overrideRows;
  try {
    [typeRows, overrideRows] = await Promise.all([
      db.select(
        'notification_types',
        `type_key=eq.${encodeURIComponent(typeKey)}`
          + '&select=type_key,label,enabled&limit=1',
      ),
      db.select(
        'notification_presentation_overrides',
        `type_key=eq.${encodeURIComponent(typeKey)}`
          + `&surface=eq.${surfaceKey}`
          + '&select=enabled,title_template,body_template,route_id,contract_version&limit=1',
      ),
    ]);
  } catch {
    return { ok: false, reason: 'catalog_lookup_failed' };
  }

  const type = typeRows?.[0];
  if (!type) {
    return { ok: false, reason: 'type_unavailable' };
  }

  const defaultConfig = configForSurface(surface, null);
  const requestedConfig = configForSurface(surface, overrideRows?.[0]);
  let preview = previewNotificationPresentation(typeKey, surfaceKey, requestedConfig);
  if (!preview.ok && overrideRows?.[0]?.enabled === true) {
    preview = previewNotificationPresentation(typeKey, surfaceKey, defaultConfig);
  }
  if (!preview.ok) {
    return { ok: false, reason: 'presentation_unavailable' };
  }

  return {
    ok: true,
    label: type.label || typeKey,
    presentation: {
      ...preview.presentation,
      url: TEST_ROUTE,
    },
  };
}

async function typedRequestId({ channel, typeKey, requestId }) {
  return stableApnsId(JSON.stringify([
    'owner-notification-type-test',
    channel,
    typeKey,
    requestId,
  ]));
}

async function testBell({
  db,
  employee,
  requestId,
  typeKey = null,
  presentation = null,
}) {
  const copy = presentation || TEST_COPY.bell;
  try {
    await db.rpc('create_notification', {
      p_type: typeKey || 'owner.notification_test',
      p_title: copy.title,
      p_body: copy.body,
      p_link: TEST_ROUTE,
      p_entity_type: null,
      p_entity_id: null,
      p_job_id: null,
      p_payload: {
        diagnostic_request_id: requestId,
        ...(typeKey ? { diagnostic_type_key: typeKey } : {}),
      },
      p_recipient_id: employee.id,
      p_type_key: typeKey,
    });
    return summary('bell', { sent: 1, attempted: 1 });
  } catch {
    return summary('bell', { attempted: 1, reason: 'bell_write_failed' });
  }
}

async function testWebPush({
  db,
  env,
  employee,
  sendWebPushImpl,
  loadVapidConfigImpl,
  fetchImpl,
  presentation = null,
  tag = null,
}) {
  let subscriptions;
  try {
    subscriptions = await db.select(
      'push_subscriptions',
      `employee_id=eq.${employee.id}&select=id,endpoint,p256dh,auth&limit=20`,
    );
  } catch {
    return summary('web_push', { reason: 'subscription_lookup_failed' });
  }
  if (!subscriptions?.length) {
    return summary('web_push', { reason: 'no_subscriptions' });
  }

  let vapid;
  try {
    vapid = await loadVapidConfigImpl(env, db);
  } catch {
    return summary('web_push', { reason: 'vapid_not_configured' });
  }
  if (!vapid?.ok) {
    return summary('web_push', { reason: 'vapid_not_configured' });
  }

  const copy = presentation || {
    ...TEST_COPY.web_push,
    url: TEST_ROUTE,
  };
  const payload = JSON.stringify({
    title: copy.title,
    body: copy.body,
    url: TEST_ROUTE,
    data: { url: TEST_ROUTE },
    ...(tag ? { tag } : {}),
  });
  let sent = 0;
  let attempted = 0;
  let pruned = 0;
  for (const subscription of subscriptions) {
    attempted += 1;
    try {
      const result = await sendWebPushImpl(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        env,
        { fetchImpl, vapid },
      );
      if (result?.ok) {
        sent += 1;
      } else if (result?.status === 404 || result?.status === 410) {
        try {
          await db.delete('push_subscriptions', `id=eq.${subscription.id}`);
          pruned += 1;
        } catch {
          // Cleanup is best-effort; delivery reporting remains accurate.
        }
      }
    } catch {
      // One broken browser subscription never blocks the remaining owner devices.
    }
  }
  return summary('web_push', {
    sent,
    attempted,
    pruned,
    reason: sent > 0 ? null : 'delivery_failed',
  });
}

async function testNativePush({
  db,
  env,
  employee,
  requestId,
  sendNativePushImpl,
  typeKey = null,
}) {
  let result;
  try {
    result = await sendNativePushImpl({
      db,
      env,
      employeeId: employee.id,
      typeKey: typeKey || 'owner.native_push_test',
      ...(typeKey ? { notificationBody: { payload: { diagnostic_type_key: typeKey } } } : {}),
      eventKey: typeKey
        ? `owner-native-type-test:${requestId}`
        : `owner-native-push-test:${requestId}`,
    });
  } catch {
    return summary('native_push', { reason: 'delivery_failed' });
  }
  return summary('native_push', {
    sent: result?.sent,
    attempted: result?.attempted,
    pruned: result?.pruned,
    reason: result?.sent > 0 ? null : result?.reason || 'delivery_failed',
  });
}

async function testEmail({ env, employee, requestId, sendEmailImpl }) {
  if (!employee.email) {
    return summary('email', { reason: 'no_email' });
  }
  let result;
  try {
    result = await sendEmailImpl(env, {
      to: employee.email,
      from: TEST_FROM,
      subject: TEST_COPY.email.title,
      text: TEST_COPY.email.body,
      html: `<p>${TEST_COPY.email.body}</p>`,
      idempotencyKey: `owner-notification-test/email/${requestId}`,
    });
  } catch {
    return summary('email', { attempted: 1, reason: 'delivery_failed' });
  }
  return summary('email', {
    sent: result?.ok ? 1 : 0,
    attempted: 1,
    reason: result?.ok ? null : 'delivery_failed',
  });
}

export async function runNotificationTest({
  db,
  env,
  employee,
  channel,
  requestId,
  typeKey = null,
  sendWebPushImpl = sendWebPush,
  loadVapidConfigImpl = loadVapidConfig,
  sendNativePushImpl = sendNativePushToEmployee,
  sendEmailImpl = sendEmail,
  fetchImpl = fetchWithTimeout,
}) {
  let effectiveRequestId = requestId;
  let typedPresentation = null;
  if (typeKey) {
    const loaded = await loadTypedPresentation({ db, typeKey, channel });
    if (!loaded.ok) {
      return {
        ...summary(channel, { reason: loaded.reason }),
        type_key: typeKey,
      };
    }
    typedPresentation = loaded;
    try {
      effectiveRequestId = await typedRequestId({ channel, typeKey, requestId });
    } catch {
      return {
        ...summary(channel, { reason: 'request_identity_failed' }),
        type_key: typeKey,
        label: loaded.label,
      };
    }
  }

  const typedMetadata = typeKey
    ? {
        type_key: typeKey,
        label: typedPresentation.label,
        title: typedPresentation.presentation.title,
      }
    : {};
  let claim;
  try {
    claim = await db.rpc('claim_notification_delivery_diagnostic', {
      p_employee_id: employee.id,
      p_channel: channel,
      p_request_id: effectiveRequestId,
    });
  } catch {
    return {
      ...summary(channel, { reason: 'claim_unavailable' }),
      ...typedMetadata,
    };
  }

  if (claim?.claimed !== true) {
    if (claim?.state === 'complete' && validStoredResult(channel, claim.result)) {
      return {
        ...claim.result,
        ...typedMetadata,
        replayed: true,
        settled: true,
      };
    }
    return {
      ...summary(channel, { reason: 'delivery_in_progress' }),
      ...typedMetadata,
      replayed: true,
      settled: false,
    };
  }

  let result;
  if (channel === 'bell') {
    result = await testBell({
      db,
      employee,
      requestId: effectiveRequestId,
      typeKey,
      presentation: typedPresentation?.presentation,
    });
  } else if (channel === 'web_push') {
    result = await testWebPush({
      db,
      env,
      employee,
      sendWebPushImpl,
      loadVapidConfigImpl,
      fetchImpl,
      presentation: typedPresentation?.presentation,
      tag: typeKey ? `upr-type-test:${typeKey}:${effectiveRequestId}` : null,
    });
  } else if (channel === 'native_push') {
    result = await testNativePush({
      db,
      env,
      employee,
      requestId: effectiveRequestId,
      sendNativePushImpl,
      typeKey,
    });
  } else {
    result = await testEmail({ env, employee, requestId, sendEmailImpl });
  }

  try {
    await db.rpc('complete_notification_delivery_diagnostic', {
      p_employee_id: employee.id,
      p_channel: channel,
      p_request_id: effectiveRequestId,
      p_result: result,
    });
  } catch {
    return {
      ...summary(channel, {
        attempted: result.attempted,
        reason: 'delivery_outcome_unconfirmed',
      }),
      ...typedMetadata,
      settled: false,
    };
  }

  return { ...result, ...typedMetadata, settled: true };
}

export async function handleNotificationTest({
  request,
  env,
  db,
  requireOwnerImpl = requireOwner,
  runTestImpl = runNotificationTest,
}) {
  const auth = await requireOwnerImpl(request, env, db);
  if (auth.error) {
    return { status: auth.status, data: { error: auth.error } };
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, data: { error: 'Invalid JSON body' } };
  }
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || Object.keys(payload).some((key) => !['channel', 'request_id', 'type_key'].includes(key))
    || !CHANNELS.has(payload.channel)
    || !UUID_RE.test(payload.request_id || '')
    || (
      payload.type_key !== undefined
      && (
        typeof payload.type_key !== 'string'
        || !TYPED_CHANNELS.has(payload.channel)
        || !PRESENTATION_EVENT_BY_KEY.has(payload.type_key)
      )
    )
  ) {
    return {
      status: 400,
      data: {
        error: 'Only a supported channel, UUID request_id, and optional catalog type_key are accepted',
      },
    };
  }

  try {
    const data = await runTestImpl({
      db,
      env,
      employee: auth.employee,
      channel: payload.channel,
      requestId: payload.request_id,
      ...(payload.type_key ? { typeKey: payload.type_key } : {}),
    });
    return { status: 200, data };
  } catch {
    return {
      status: 500,
      data: { error: 'Notification test failed' },
    };
  }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const { status, data } = await handleNotificationTest({ request, env, db });
  return jsonResponse(data, status, request, env);
}
