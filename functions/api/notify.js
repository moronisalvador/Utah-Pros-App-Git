/**
 * ════════════════════════════════════════════════
 * FILE: notify.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place a "something happened" event turns into the right alerts for
 *   the right people. Give it an event (a type key like "feedback.submitted" plus
 *   a little payload) and it: figures out WHO should hear about it, checks each
 *   person's own on/off preferences, and then, per person, drops a notice in
 *   their in-app bell, buzzes their phone/desktop with a Web Push, and/or emails
 *   them — only on the channels they've left switched on. It never lets a delivery
 *   hiccup (a dead phone, a missing email, an unconfigured push key) break the
 *   caller: it reports what it skipped and still returns success.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/notify  (Cloudflare Pages Function)
 *   Rendered by:  n/a (worker) — DB triggers call the HTTP route with the exact
 *                 x-webhook-secret; trusted workers import dispatchEvent in-process.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-key client), ../lib/cors.js,
 *              ../lib/auth.js (active internal admin for the legacy Bearer path),
 *              ../lib/webPush.js (sendWebPush/loadVapidConfig), ../lib/apns.js,
 *              ../lib/email.js
 *   Data:      reads  → notification_types (catalog + enabled master switch),
 *                        employees (audience + email), appointment_crew (crew
 *                        audience), push_subscriptions + device_tokens (devices),
 *                        integration_config (webhook secret);
 *                        get_effective_notification_prefs +
 *                        get_conversation_notification_recipients (RPCs)
 *              writes → notifications (via create_notification, per recipient);
 *                        prunes dead push subscriptions/registrations
 *
 * NOTES / GOTCHAS:
 *   - A type ships enabled=false and is INERT: dispatchEvent returns {skipped} for
 *     a disabled type, so wiring an emit hook before the type is turned on is safe.
 *   - HTTP auth accepts EITHER the matching x-webhook-secret (DB-trigger calls)
 *     OR an active internal admin. A supplied secret is checked first and never
 *     falls through to Bearer when wrong. The Bearer path accepts only the
 *     allowlisted, server-derived object events below; secret and in-process
 *     callers retain their deployed payloads.
 *   - Web Push 503-skips when VAPID is unset (the APNs precedent) and prunes 404/410
 *     subscriptions. Email skips + reports a NULL address. None of these throw.
 *   - Bell rows are per-recipient (recipient_id set) so each person's feed + read
 *     state is their own — unlike the legacy global feed.
 *   - Bare trigger payloads (appointment.* / estimate.accepted pass only an id)
 *     are enriched here into a clean title/body/deep-link before fan-out so the
 *     bell/push/email read nicely — see enrichAppointmentBody/enrichEstimateBody.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { sendWebPush, loadVapidConfig } from '../lib/webPush.js';
import {
  sendNativePushToEmployeeAcrossEnvironments,
  stableApnsId,
} from '../lib/apns.js';
import { sendEmail } from '../lib/email.js';
import { fetchWithTimeout } from '../lib/http.js';
import {
  resolveConfiguredNotificationPresentation,
} from '../lib/notificationPresentation.js';

// The internal notifications sender identity (distinct from the customer-facing
// "Utah Pros Restoration" default in email.js).
export const NOTIFY_FROM = 'UPR - Notifications <restoration@utahpros.app>';

// Fallback role audience per type when a call gives no explicit recipients and the
// event is not appointment/employee-scoped. Session B may pass recipient_ids to
// override any of this.
const ROLE_AUDIENCE = {
  'message.inbound':             ['admin', 'office'],
  'estimate.accepted':          ['admin'],
  'payment.received':           ['admin'],
  'lead.new':                   ['admin'],
  'esign.signed':               ['admin'],
  'feedback.submitted':         ['admin'],
  'timesheet.change_requested': ['admin'],
  // clock.abandoned is NOT here — it resolves to admins PLUS the affected tech
  // (see resolveAudience), so the tech gets their own "forgot to clock out" nudge.
};

const NOTIFY_BROWSER_ROLES = ['admin'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPOINTMENT_AUDIENCE_TYPES = new Set([
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
]);
export const GUARDED_PRODUCER_TYPES = new Set([
  ...APPOINTMENT_AUDIENCE_TYPES,
  'timesheet.change_requested',
  'timesheet.change_reviewed',
]);

function inboundConversationId(body = {}) {
  const candidate = body.data?.conversation_id
    || body.conversation_id
    || (body.entity_type === 'conversation' ? body.entity_id : null);
  return typeof candidate === 'string' && UUID_RE.test(candidate)
    ? candidate
    : null;
}

// There is no checked-in browser caller for POST /api/notify. Keep the legacy
// Bearer capability deliberately narrow: only events whose recipient and
// message can be derived from an existing database object. All other event
// origins use the exact server secret or call dispatchEvent in-process.
const HUMAN_HTTP_EVENT_FIELDS = {
  'estimate.accepted': new Set(['type_key', 'estimate_id']),
};

// ─── SECTION: Helpers ───

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

async function filterActiveInternalEmployeeIds(db, employeeIds) {
  const wanted = new Set(uniq(employeeIds));
  if (!wanted.size) return [];

  let employees = [];
  try {
    employees = await db.select(
      'employees',
      'is_active=eq.true&select=id,is_external',
    );
  } catch {
    return [];
  }

  return uniq((employees || [])
    .filter((employee) => wanted.has(employee.id) && employee.is_external !== true)
    .map((employee) => employee.id));
}

async function resolveAppointmentAudience(db, typeKey, body) {
  if (!body.appointment_id) return [];
  let crew = [];
  try {
    crew = await db.select(
      'appointment_crew',
      `appointment_id=eq.${body.appointment_id}&select=employee_id`,
    );
  } catch {
    return [];
  }
  let crewIds = uniq((crew || []).map((row) => row.employee_id));
  if (typeKey === 'appointment.assigned') {
    if (!body.employee_id) return [];
    crewIds = crewIds.filter((id) => id === body.employee_id);
  }
  return filterActiveInternalEmployeeIds(db, crewIds);
}

async function resolveInboundMessageAudience(db, body) {
  const conversationId = inboundConversationId(body);
  if (!conversationId) return [];

  // The database owns this predicate because it is also the conversation and
  // message read boundary. Missing/invalid ids and lookup failures fail closed:
  // stale assigned_to or caller-provided recipients are never notification
  // authority for customer message content.
  let recipients = [];
  try {
    recipients = await db.rpc('get_conversation_notification_recipients', {
      p_conversation_id: conversationId,
    });
  } catch {
    return [];
  }

  return filterActiveInternalEmployeeIds(
    db,
    (recipients || []).map((recipient) => recipient?.employee_id),
  );
}

/**
 * Who should receive this event, as an array of employee ids.
 *  1. appointment types always resolve from current assignment/crew state;
 *  2. inbound customer messages always resolve from current conversation access;
 *  3. other explicit body.recipient_ids win after active/internal validation;
 *  4. otherwise a role-based default (minus body.exclude_employee_id).
 */
export async function resolveAudience(db, typeKey, body = {}) {
  if (APPOINTMENT_AUDIENCE_TYPES.has(typeKey)) {
    return resolveAppointmentAudience(db, typeKey, body);
  }

  if (typeKey === 'message.inbound') {
    return resolveInboundMessageAudience(db, body);
  }

  if (Array.isArray(body.recipient_ids) && body.recipient_ids.length) {
    return filterActiveInternalEmployeeIds(db, body.recipient_ids);
  }

  if (typeKey === 'timesheet.change_reviewed' && body.employee_id) {
    return filterActiveInternalEmployeeIds(db, [body.employee_id]);
  }
  if (typeKey === 'clock.abandoned') {
    // Admins (to follow up) PLUS the tech who left the clock running, so they get
    // their own nudge to clock out. The scan carries the tech id in
    // body.payload.employee_id; field_tech role defaults (push/email) are seeded.
    let admins = [];
    try { admins = await db.select('employees', 'role=in.(admin)&is_active=eq.true&select=id,is_external'); }
    catch { admins = []; }
    const tech = body.payload?.employee_id || body.employee_id || null;
    return filterActiveInternalEmployeeIds(
      db,
      [...(admins || []).filter((e) => e.is_external !== true).map((e) => e.id), tech],
    );
  }
  const roles = ROLE_AUDIENCE[typeKey] || ['admin'];
  let emps = [];
  try {
    emps = await db.select(
      'employees',
      `role=in.(${roles.join(',')})&is_active=eq.true&select=id,role,is_external`,
    );
  } catch { emps = []; }
  let ids = (emps || []).filter((e) => e.is_external !== true).map((e) => e.id);
  if (body.exclude_employee_id) ids = ids.filter((id) => id !== body.exclude_employee_id);
  return filterActiveInternalEmployeeIds(db, ids);
}

/**
 * Deliver one event to one recipient across the channels their EFFECTIVE prefs
 * leave on. Returns a per-recipient summary; never throws.
 */
export function nativeNotificationEventKey(type, body, recipientId) {
  const occurrenceId = body?.notification_event_id;
  if (
    !['string', 'number'].includes(typeof occurrenceId)
    || String(occurrenceId).trim() === ''
  ) {
    return null;
  }
  return JSON.stringify([
    type?.type_key || '',
    recipientId || '',
    String(occurrenceId).trim(),
  ]);
}

export function guardedProducerEntity(typeKey, body = {}) {
  if (typeKey === 'appointment.assigned') {
    return UUID_RE.test(body.appointment_crew_id || '')
      ? { entityType: 'appointment_crew', entityId: body.appointment_crew_id }
      : null;
  }
  if (
    typeKey === 'appointment.updated'
    || typeKey === 'appointment.canceled'
  ) {
    return UUID_RE.test(body.appointment_id || '')
      ? { entityType: 'appointment', entityId: body.appointment_id }
      : null;
  }
  if (
    typeKey === 'timesheet.change_requested'
    || typeKey === 'timesheet.change_reviewed'
  ) {
    return body.entity_type === 'time_entry_change_request'
      && UUID_RE.test(body.entity_id || '')
      ? {
        entityType: 'time_entry_change_request',
        entityId: body.entity_id,
      }
      : null;
  }
  return null;
}

async function hydrateGuardedProducerBody(db, typeKey, body) {
  if (typeKey !== 'appointment.assigned') return body;
  if (!UUID_RE.test(body.appointment_crew_id || '')) return null;
  try {
    const rows = await db.select(
      'appointment_crew',
      `id=eq.${body.appointment_crew_id}`
        + '&select=id,appointment_id,employee_id&limit=1',
    );
    const assignment = rows?.[0];
    if (!assignment?.appointment_id || !assignment?.employee_id) return null;
    return {
      ...body,
      appointment_id: assignment.appointment_id,
      employee_id: assignment.employee_id,
    };
  } catch {
    return null;
  }
}

async function validateGuardedProducerDelivery(
  db,
  { notificationEventId, recipientId = null, typeKey, entity },
) {
  if (!GUARDED_PRODUCER_TYPES.has(typeKey)) return true;
  if (!entity) return false;
  try {
    return await db.rpc('validate_notification_producer_delivery', {
      p_notification_event_id: notificationEventId,
      p_type_key: typeKey,
      p_entity_type: entity.entityType,
      p_entity_id: entity.entityId,
      p_employee_id: recipientId,
    }) === true;
  } catch {
    return false;
  }
}

async function claimNotificationDelivery(
  db,
  { notificationEventId, recipientId, typeKey, channel, target, entity },
) {
  if (!GUARDED_PRODUCER_TYPES.has(typeKey)) return { claimed: true };

  try {
    const targetFingerprint = await stableApnsId(
      JSON.stringify([channel, String(target || '')]),
    );
    const deliveryKey = await stableApnsId(JSON.stringify([
      notificationEventId,
      recipientId,
      typeKey,
      channel,
      targetFingerprint,
    ]));
    const claimed = await db.rpc('claim_notification_delivery', {
      p_delivery_key: deliveryKey,
      p_notification_event_id: notificationEventId,
      p_employee_id: recipientId,
      p_type_key: typeKey,
      p_channel: channel,
      p_target_fingerprint: targetFingerprint,
      p_entity_type: entity.entityType,
      p_entity_id: entity.entityId,
    }) === true;
    return { claimed, deliveryKey };
  } catch {
    return { claimed: false };
  }
}

async function releaseNotificationDeliveryClaim(db, deliveryKey) {
  if (!deliveryKey) return false;
  try {
    return await db.rpc('release_notification_delivery_claim', {
      p_delivery_key: deliveryKey,
    }) === true;
  } catch {
    // An uncertain release remains claimed. This favors no duplicate delivery
    // over an automatic replay when the database outcome is ambiguous.
    return false;
  }
}

export async function dispatchToRecipient({
  db,
  env,
  recipientId,
  type,
  body,
  vapid,
  bellPresentation,
  pwaPresentation,
  sendWebPushImpl,
  sendNativePushImpl,
  sendEmailImpl,
  fetchImpl,
  nativeRetryOnly = false,
}) {
  const result = { recipient_id: recipientId, bell: false, push: { sent: 0, attempted: 0, pruned: 0 }, email: 'off' };
  const guardedEntity = guardedProducerEntity(type.type_key, body);
  if (!await validateGuardedProducerDelivery(db, {
    notificationEventId: body.notification_event_id,
    recipientId,
    typeKey: type.type_key,
    entity: guardedEntity,
  })) {
    return {
      ...result,
      skipped: true,
      reason: 'invalid_notification_occurrence',
    };
  }

  let prefs = [];
  try { prefs = await db.rpc('get_effective_notification_prefs', { p_employee_id: recipientId }); }
  catch { prefs = []; }
  const forType = (prefs || []).filter((p) => p.type_key === type.type_key);
  const on = (ch) => forType.some((p) => p.channel === ch && p.enabled);

  // Channel 1 — in-app bell (per-recipient row).
  if (on('bell') && !nativeRetryOnly) {
    const claim = await claimNotificationDelivery(db, {
      notificationEventId: body.notification_event_id,
      recipientId,
      typeKey: type.type_key,
      channel: 'bell',
      target: recipientId,
      entity: guardedEntity,
    });
    if (claim.claimed) {
      try {
        await db.rpc('create_notification', {
          p_type: type.type_key,
          p_title: bellPresentation.title,
          p_body: bellPresentation.body || null,
          p_link: bellPresentation.url || null,
          p_entity_type: body.entity_type || null,
          p_entity_id: body.entity_id || null,
          p_job_id: body.job_id || null,
          p_payload: body.payload || {},
          p_recipient_id: recipientId,
          p_type_key: type.type_key,
        });
        result.bell = true;
      } catch {
        // The database outcome is ambiguous, so keep the claim and do not
        // automatically replay a potentially-created bell row.
      }
    }
  }

  // Channel 2 — Web Push to each of the recipient's subscribed devices.
  if (on('push')) {
    const nativeSender = sendNativePushImpl
      || sendNativePushToEmployeeAcrossEnvironments;
    const eventKey = nativeNotificationEventKey(type, body, recipientId);
    if (!eventKey) {
      result.push.native = {
        sent: 0,
        attempted: 0,
        pruned: 0,
        skipped: true,
        reason: 'missing_notification_event_id',
      };
    } else {
      try {
        const nativeInput = {
          db,
          env,
          employeeId: recipientId,
          typeKey: type.type_key,
          notificationBody: body,
          eventKey,
        };
        // The real APNs sender owns its bounded fetchWithTimeout default.
        // An explicitly injected sender receives the selected bounded/fake
        // transport so tests and alternate implementations retain the boundary.
        if (sendNativePushImpl && fetchImpl) nativeInput.fetchImpl = fetchImpl;
        const native = await nativeSender(nativeInput);
        result.push.native = native;
        result.push.sent += native?.sent || 0;
        result.push.attempted += native?.attempted || 0;
        result.push.pruned += native?.pruned || 0;
      } catch {
        result.push.native = {
          sent: 0,
          attempted: 0,
          pruned: 0,
          skipped: true,
          reason: 'native_push_failed',
        };
      }
    }

    if (!nativeRetryOnly) {
      let subs = [];
      try { subs = await db.select('push_subscriptions', `employee_id=eq.${recipientId}&select=id,endpoint,p256dh,auth`); }
      catch { subs = []; }
      const pushBody = JSON.stringify({
        title: pwaPresentation.title,
        body: pwaPresentation.body,
        url: pwaPresentation.url,
        // The typed presentation resolver is the only authority for tap
        // navigation. Never forward producer metadata: older producers carry a
        // data.url that can conflict with an admin-selected route.
        data: { url: pwaPresentation.url },
      });
      const send = sendWebPushImpl || sendWebPush;
      for (const s of subs || []) {
        const claim = await claimNotificationDelivery(db, {
          notificationEventId: body.notification_event_id,
          recipientId,
          typeKey: type.type_key,
          channel: 'pwa_push',
          target: s.endpoint,
          entity: guardedEntity,
        });
        if (!claim.claimed) continue;

        result.push.attempted++;
        try {
          const res = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, pushBody, env, { fetchImpl, vapid });
          if (res.skipped) {
            result.push.vapidMissing = true;
            await releaseNotificationDeliveryClaim(db, claim.deliveryKey);
            continue;
          }
          if (res.ok) { result.push.sent++; continue; }
          if (res.status === 404 || res.status === 410) {
            try { await db.delete('push_subscriptions', `id=eq.${s.id}`); result.push.pruned++; } catch { /* prune best-effort */ }
            continue;
          }
          await releaseNotificationDeliveryClaim(db, claim.deliveryKey);
        } catch { /* one bad subscription never breaks the fan-out */ }
      }
    }
  }

  // Channel 3 — transactional email (skips + reports a NULL address).
  if (on('email') && !nativeRetryOnly) {
    let email = null;
    try {
      const rows = await db.select('employees', `id=eq.${recipientId}&select=email,full_name`);
      email = rows?.[0]?.email || null;
    } catch { email = null; }
    if (!email) {
      result.email = 'skipped_null';
    } else {
      const claim = await claimNotificationDelivery(db, {
        notificationEventId: body.notification_event_id,
        recipientId,
        typeKey: type.type_key,
        channel: 'email',
        target: email.trim().toLowerCase(),
        entity: guardedEntity,
      });
      if (claim.claimed) {
        try {
          const mailer = sendEmailImpl || sendEmail;
          const r = await mailer(env, {
            to: email,
            from: NOTIFY_FROM,
            subject: body.title || type.label,
            text: body.body || body.title || type.label,
            html: body.html,
            idempotencyKey: claim.deliveryKey,
          });
          result.email = r?.ok ? 'sent' : 'failed';
          if (!r?.ok) {
            await releaseNotificationDeliveryClaim(db, claim.deliveryKey);
          }
        } catch {
          // Keep the claim when provider acceptance is ambiguous.
          result.email = 'failed';
        }
      } else {
        result.email = 'duplicate';
      }
    }
  }

  return result;
}

// ─── SECTION: Body enrichment (nice titles/bodies for bare trigger payloads) ───

/**
 * Keep the bell in the office inbox while sending a tapped push directly into
 * the field PWA's matching thread. Both inboxes already accept `?c=<id>`.
 */
export function enrichInboundMessageBody(body = {}) {
  const conversationId = body.data?.conversation_id ||
    (body.entity_type === 'conversation' ? body.entity_id : null);
  const suffix = conversationId ? `?c=${encodeURIComponent(conversationId)}` : '';
  const currentLink = body.link || '';
  const bellLink = !currentLink || currentLink === '/conversations'
    ? `/conversations${suffix}`
    : currentLink;

  return {
    ...body,
    presentation_context: {
      ...(body.presentation_context || {}),
      sender_name: body.presentation_context?.sender_name || (
        String(body.title || '').startsWith('New text from ')
          ? String(body.title).slice('New text from '.length)
          : ''
      ),
      message_preview: body.presentation_context?.message_preview || body.body || '',
    },
    link: bellLink,
    data: {
      ...(body.data || {}),
      url: `/tech/conversations${suffix}`,
    },
  };
}

/**
 * Format a Denver wall-clock appointment for a notification line.
 * `appointments.date` is a DATE and `time_start`/`time_end` are TIME WITHOUT
 * TIME ZONE — i.e. already local wall-clock — so there is NO timezone
 * conversion, only formatting. The date is anchored at UTC noon so the Intl
 * calendar date matches the stored day regardless of the runtime's zone (no
 * off-by-one). Returns e.g. "Fri, Jul 4 · 9:00 AM – 11:00 AM".
 */
export function formatApptWhen(dateStr, startStr, endStr) {
  let datePart = '';
  if (dateStr) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      datePart = new Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
      }).format(d);
    }
  }
  const t = (s) => {
    if (!s) return '';
    const [hh, mm] = String(s).split(':');
    let h = parseInt(hh, 10);
    if (Number.isNaN(h)) return '';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h %= 12; if (h === 0) h = 12;
    return `${h}:${mm ?? '00'} ${ampm}`;
  };
  const start = t(startStr);
  const end = t(endStr);
  const timePart = start && end ? `${start} – ${end}` : start;
  return [datePart, timePart].filter(Boolean).join(' · ');
}

const APPT_VERB = {
  'appointment.assigned': 'New appointment',
  'appointment.updated': 'Appointment updated',
  'appointment.canceled': 'Appointment canceled',
};

function formatPresentationMoney(value) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Turn a bare `{ appointment_id }` trigger payload into a clean title + body +
 * deep link (the DB triggers pass only ids). Best-effort: on any lookup failure
 * — or when the caller already supplied a title — the original body is returned
 * unchanged, so the catalog label still shows and this never throws.
 */
export async function enrichAppointmentBody(db, typeKey, body = {}) {
  if (!body.appointment_id) return body;
  let appt = null;
  try {
    const rows = await db.select(
      'appointments',
      `id=eq.${body.appointment_id}`
        + '&select=title,date,time_start,time_end,'
        + 'jobs(job_number,insured_name,estimated_value,approved_value,invoiced_value,collected_value)',
    );
    appt = rows?.[0] || null;
  } catch { appt = null; }
  if (!appt) return body;
  const job = appt.jobs || null;
  const what = (appt.title && String(appt.title).trim()) || '';
  const verb = APPT_VERB[typeKey] || 'Appointment';
  const when = formatApptWhen(appt.date, appt.time_start, appt.time_end);
  const customerName = (job?.insured_name && String(job.insured_name).trim()) || '';
  const jobNumber = (job?.job_number && String(job.job_number).trim()) || '';
  return {
    ...body,
    title: body.title || (what ? `${verb} · ${what}` : verb),
    body: body.body || when || '',
    // Store the OFFICE path. A notification has no idea who will open it or on
    // what, so the reader's shell decides (src/lib/techShellRoutes.js): field techs
    // are routed to /tech/appointment/:id, the office keeps this one. Storing the
    // field path here — which this did while /tech/appointment/:id was the only
    // appointment screen in the app — put desktop dispatchers in the phone UI.
    link: body.link || `/schedule/appointment/${body.appointment_id}`,
    // PUSH-01. The shell-decides rule above only reaches the IN-APP bell, which
    // calls linkForCurrentShell. Web Push never touches that code: the service
    // worker validates the raw URL against its own allowlist (public/sw-target.js),
    // which carries /tech/appointment/:id and no /schedule/appointment entry — so
    // an office link normalized to the '/tech' fallback and every tapped
    // appointment push landed on the field dashboard with no appointment, for
    // dispatchers as well as techs. dispatchToRecipient prefers data.url, so the
    // installed app gets an allowlisted field path while `link` above keeps the
    // bell correct. Same split message.inbound already ships (enrichInboundMessageBody).
    data: {
      ...(body.data || {}),
      url: body.data?.url || `/tech/appointment/${body.appointment_id}`,
    },
    presentation_context: {
      ...(body.presentation_context || {}),
      appointment_title: what,
      appointment_when: when,
      customer_name: customerName,
      job_number: jobNumber,
      job_estimated_amount: formatPresentationMoney(job?.estimated_value),
      job_approved_amount: formatPresentationMoney(job?.approved_value),
      job_invoiced_amount: formatPresentationMoney(job?.invoiced_value),
      job_collected_amount: formatPresentationMoney(job?.collected_value),
    },
    entity_type: body.entity_type || 'appointment',
    entity_id: body.entity_id || body.appointment_id,
  };
}

/**
 * Turn a bare `{ estimate_id }` trigger payload into a clean title + body +
 * deep link. Best-effort — returns the body unchanged on any lookup miss or
 * when a title is already set; never throws. Reads estimates + contacts.
 */
export async function enrichEstimateBody(db, body = {}) {
  if (!body.estimate_id) return body;
  if (
    body.presentation_context?.estimate_number
    && body.presentation_context?.amount
    && body.presentation_context?.customer_name
  ) return body;
  let est = null;
  try {
    const rows = await db.select('estimates', `id=eq.${body.estimate_id}&select=estimate_number,amount,approved_amount,contact_id,job_id`);
    est = rows?.[0] || null;
  } catch { est = null; }
  if (!est) return body;
  let client = '';
  if (est.contact_id) {
    try {
      const c = await db.select('contacts', `id=eq.${est.contact_id}&select=name`);
      client = (c?.[0]?.name && String(c[0].name).trim()) || '';
    } catch { client = ''; }
  }
  const amt = Number(est.approved_amount ?? est.amount);
  const money = Number.isFinite(amt) && amt > 0
    ? `$${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
  const num = est.estimate_number ? String(est.estimate_number).trim() : '';
  return {
    ...body,
    title: body.title || (num ? `Estimate ${num} accepted` : 'Estimate accepted'),
    body: body.body || [money, client].filter(Boolean).join(' · '),
    link: body.link || `/estimates/${body.estimate_id}`,
    entity_type: body.entity_type || 'estimate',
    entity_id: body.entity_id || body.estimate_id,
    job_id: body.job_id ?? est.job_id ?? null,
    payload: {
      ...(body.payload || {}),
      amount: Number.isFinite(amt) ? amt : null,
    },
    presentation_context: {
      ...(body.presentation_context || {}),
      estimate_number: num,
      amount: money,
      customer_name: client,
    },
  };
}

export async function enrichDatabasePresentationContext(db, typeKey, body) {
  if (
    typeKey !== 'timesheet.change_requested'
    && typeKey !== 'clock.abandoned'
  ) return body;
  const presentationContext = { ...(body.presentation_context || {}) };
  delete presentationContext.employee_name;
  const safeBody = {
    ...body,
    presentation_context: presentationContext,
  };
  let employeeId = null;
  try {
    if (typeKey === 'timesheet.change_requested' && body.entity_id) {
      const requests = await db.select(
        'time_entry_change_requests',
        `id=eq.${encodeURIComponent(body.entity_id)}&select=requested_by&limit=1`,
      );
      employeeId = requests?.[0]?.requested_by || null;
    } else if (typeKey === 'clock.abandoned') {
      employeeId = body.payload?.employee_id || null;
    }
    if (!employeeId) return safeBody;
    const employees = await db.select(
      'employees',
      `id=eq.${encodeURIComponent(employeeId)}`
        + '&select=full_name,is_active,is_external&limit=1',
    );
    const employee = employees?.[0];
    if (
      !employee?.full_name
      || employee.is_active !== true
      || employee.is_external !== false
    ) return safeBody;
    return {
      ...safeBody,
      presentation_context: {
        ...presentationContext,
        employee_name: employee.full_name,
      },
    };
  } catch {
    return safeBody;
  }
}

/**
 * The reusable dispatch core (no HTTP auth) — resolves the catalog type, the
 * audience, then fans out per recipient. Imported in-process by feedback-notify
 * and wrapped with auth by handleNotify. Returns a summary; never throws for a
 * disabled type (returns { skipped }).
 */
export async function dispatchEvent({
  db,
  env,
  typeKey,
  body = {},
  fetchImpl = fetchWithTimeout,
  sendWebPushImpl,
  sendNativePushImpl,
  sendEmailImpl,
  nativeRetryOnly = false,
}) {
  if (!typeKey) return { skipped: true, reason: 'no_type_key', recipients: 0, results: [] };

  let type = null;
  try {
    const rows = await db.select('notification_types', `type_key=eq.${typeKey}&select=*`);
    type = rows?.[0] || null;
  } catch { type = null; }
  if (!type) return { skipped: true, reason: 'unknown_type', type_key: typeKey, recipients: 0, results: [] };
  if (!type.enabled) return { skipped: true, reason: 'type_disabled', type_key: typeKey, recipients: 0, results: [] };
  if (
    GUARDED_PRODUCER_TYPES.has(typeKey)
    && (
      typeof body.notification_event_id !== 'string'
      || !UUID_RE.test(body.notification_event_id)
    )
  ) {
    return {
      skipped: true,
      reason: 'missing_notification_event_id',
      type_key: typeKey,
      recipients: 0,
      results: [],
    };
  }
  body = await hydrateGuardedProducerBody(db, typeKey, body);
  if (!body) {
    return {
      skipped: true,
      reason: 'invalid_notification_occurrence',
      type_key: typeKey,
      recipients: 0,
      results: [],
    };
  }
  const guardedEntity = guardedProducerEntity(typeKey, body);
  if (
    GUARDED_PRODUCER_TYPES.has(typeKey)
    && !await validateGuardedProducerDelivery(db, {
      notificationEventId: body.notification_event_id,
      typeKey,
      entity: guardedEntity,
    })
  ) {
    return {
      skipped: true,
      reason: 'invalid_notification_occurrence',
      type_key: typeKey,
      recipients: 0,
      results: [],
    };
  }

  // Enrich bare trigger payloads with a human-readable title/body/link so the
  // bell, push, and email all read cleanly (not just the catalog label).
  if (typeKey === 'message.inbound') {
    body = enrichInboundMessageBody(body);
  } else if (typeKey.startsWith('appointment.')) {
    body = await enrichAppointmentBody(db, typeKey, body);
  } else if (typeKey === 'estimate.accepted') {
    body = await enrichEstimateBody(db, body);
  }
  body = await enrichDatabasePresentationContext(db, typeKey, body);

  const recipientIds = await resolveAudience(db, typeKey, body);

  // Resolve VAPID once for the whole fan-out (env → Supabase fallback).
  let vapid;
  try { vapid = await loadVapidConfig(env, db); } catch { vapid = undefined; }

  // Presentation depends only on the type + enriched body, never the recipient —
  // resolve each surface once per event, not twice per recipient.
  const bellPresentation = await resolveConfiguredNotificationPresentation({
    db,
    typeKey: type.type_key,
    surfaceKey: 'bell',
    body,
    fallback: {
      title: body.title || type.label,
      body: body.body || '',
      url: body.link || '/',
    },
  });
  const pwaPresentation = await resolveConfiguredNotificationPresentation({
    db,
    typeKey: type.type_key,
    surfaceKey: 'pwa_push',
    body,
    fallback: {
      title: body.title || type.label,
      body: body.body || '',
      url: body.data?.url || body.link || '/',
    },
  });

  const results = [];
  for (const rid of recipientIds) {
    results.push(await dispatchToRecipient({
      db,
      env,
      recipientId: rid,
      type,
      body,
      vapid,
      bellPresentation,
      pwaPresentation,
      sendWebPushImpl,
      sendNativePushImpl,
      sendEmailImpl,
      fetchImpl,
      nativeRetryOnly,
    }));
  }

  return { type_key: typeKey, recipients: recipientIds.length, results };
}

// ─── SECTION: HTTP identity + object contract ───

export async function authorizeNotifyRequest(
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
) {
  const secret = request.headers.get('x-webhook-secret');
  if (request.headers.has('x-webhook-secret')) {
    let expected = null;
    try {
      const rows = await db.select('integration_config', 'key=eq.notify_webhook_secret&select=value');
      expected = rows?.[0]?.value || null;
    } catch { expected = null; }
    if (expected && secret === expected) return { ok: true, via: 'webhook' };
    return { ok: false, status: 401, error: 'Invalid webhook secret' };
  }

  const auth = await requireRole(
    request,
    env,
    db,
    NOTIFY_BROWSER_ROLES,
    fetchImpl,
  );
  if (auth.error) {
    return {
      ok: false,
      status: auth.status,
      error: auth.status === 403 ? 'Forbidden' : auth.error,
    };
  }
  if (auth.employee.is_external !== false) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true, via: 'bearer', user: auth.user, employee: auth.employee };
}

function scopeFailure(error, status) {
  return { ok: false, error, status };
}

async function readScopedRow(db, table, query) {
  try {
    const rows = await db.select(table, query);
    return { ok: true, row: rows?.[0] || null };
  } catch {
    return scopeFailure('Notification object lookup failed', 500);
  }
}

/**
 * Converts a human HTTP request into the minimum dispatcher payload after the
 * referenced object is proven. Client-supplied recipients, message copy, HTML,
 * links, entities, jobs, payload and push data are all rejected.
 */
export async function scopeBearerNotification(db, typeKey, body) {
  const allowedFields = HUMAN_HTTP_EVENT_FIELDS[typeKey];
  if (!allowedFields) {
    return scopeFailure('Unsupported type_key for Bearer dispatch', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return scopeFailure('Invalid notification scope', 400);
  }
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return scopeFailure('Unsupported fields for Bearer dispatch', 400);
  }

  if (!UUID_RE.test(body.estimate_id || '')) {
    return scopeFailure('Invalid notification scope', 400);
  }
  const scoped = await readScopedRow(
    db,
    'estimates',
    `id=eq.${body.estimate_id}&select=id,status&limit=1`,
  );
  if (!scoped.ok) return scoped;
  if (!scoped.row || scoped.row.status !== 'approved') {
    return scopeFailure('Notification object not found', 404);
  }
  return { ok: true, body: { estimate_id: body.estimate_id } };
}

// ─── SECTION: HTTP handler (injectable deps for tests) ───

export async function handleNotify({
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
  sendWebPushImpl,
  sendEmailImpl,
  dispatchImpl = dispatchEvent,
}) {
  const auth = await authorizeNotifyRequest(request, env, db, fetchImpl);
  if (!auth.ok) return { status: auth.status, data: { error: auth.error } };

  let body;
  try { body = await request.json(); }
  catch { return { status: 400, data: { error: 'Invalid JSON body' } }; }

  const typeKey = body?.type_key;
  if (!typeKey) return { status: 400, data: { error: 'type_key is required' } };

  let dispatchBody = body;
  if (auth.via === 'bearer') {
    const scoped = await scopeBearerNotification(db, typeKey, body);
    if (!scoped.ok) return { status: scoped.status, data: { error: scoped.error } };
    dispatchBody = scoped.body;
  }

  const summary = await dispatchImpl({
    db,
    env,
    typeKey,
    body: dispatchBody,
    fetchImpl,
    sendWebPushImpl,
    sendEmailImpl,
  });
  return { status: 200, data: summary };
}

// ─── SECTION: Pages Function entry points ───

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { status, data } = await handleNotify({
    request,
    env,
    db: supabase(env, fetchWithTimeout),
    fetchImpl: fetchWithTimeout,
  });
  return jsonResponse(data, status, request, env);
}
