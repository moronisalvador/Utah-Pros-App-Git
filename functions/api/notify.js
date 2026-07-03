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
 *   Rendered by:  n/a (worker) — called by feedback-notify.js (in-process) and by
 *                 DB triggers (via integration_config notify_worker_url) using the
 *                 x-webhook-secret; Session B wires the remaining event origins.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-key client), ../lib/cors.js,
 *              ../lib/webPush.js (sendWebPush/loadVapidConfig), ../lib/email.js
 *   Data:      reads  → notification_types (catalog + enabled master switch),
 *                        employees (audience + email), appointment_crew (crew
 *                        audience), push_subscriptions (devices), integration_config
 *                        (webhook secret); get_effective_notification_prefs (RPC)
 *              writes → notifications (via create_notification, per recipient);
 *                        prunes dead push_subscriptions (404/410)
 *
 * NOTES / GOTCHAS:
 *   - A type ships enabled=false and is INERT: dispatchEvent returns {skipped} for
 *     a disabled type, so wiring an emit hook before the type is turned on is safe.
 *   - Auth accepts EITHER a matching x-webhook-secret (DB-trigger calls) OR a valid
 *     Bearer user token (worker-to-worker, e.g. feedback-notify) — same shape as
 *     send-push/feedback-notify.
 *   - Web Push 503-skips when VAPID is unset (the APNs precedent) and prunes 404/410
 *     subscriptions. Email skips + reports a NULL address. None of these throw.
 *   - Bell rows are per-recipient (recipient_id set) so each person's feed + read
 *     state is their own — unlike the legacy global feed.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { sendWebPush, loadVapidConfig } from '../lib/webPush.js';
import { sendEmail } from '../lib/email.js';

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
  'clock.abandoned':            ['admin'],
};

// ─── SECTION: Helpers ───

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

/**
 * Who should receive this event, as an array of employee ids.
 *  1. explicit body.recipient_ids always win (de-duped);
 *  2. appointment/employee-scoped types resolve from the payload / crew;
 *  3. otherwise a role-based default (minus body.exclude_employee_id).
 */
export async function resolveAudience(db, typeKey, body = {}) {
  if (Array.isArray(body.recipient_ids) && body.recipient_ids.length) {
    return uniq(body.recipient_ids);
  }

  if (typeKey === 'appointment.assigned' && body.employee_id) {
    return [body.employee_id];
  }
  if (typeKey === 'timesheet.change_reviewed' && body.employee_id) {
    return [body.employee_id];
  }
  if ((typeKey === 'appointment.updated' || typeKey === 'appointment.canceled') && body.appointment_id) {
    let crew = [];
    try {
      crew = await db.select('appointment_crew', `appointment_id=eq.${body.appointment_id}&select=employee_id`);
    } catch { crew = []; }
    return uniq((crew || []).map((c) => c.employee_id));
  }

  const roles = ROLE_AUDIENCE[typeKey] || ['admin'];
  let emps = [];
  try {
    emps = await db.select('employees', `role=in.(${roles.join(',')})&select=id,role`);
  } catch { emps = []; }
  let ids = (emps || []).map((e) => e.id);
  if (body.exclude_employee_id) ids = ids.filter((id) => id !== body.exclude_employee_id);
  return uniq(ids);
}

/**
 * Deliver one event to one recipient across the channels their EFFECTIVE prefs
 * leave on. Returns a per-recipient summary; never throws.
 */
export async function dispatchToRecipient({ db, env, recipientId, type, body, vapid, sendWebPushImpl, sendEmailImpl, fetchImpl }) {
  const result = { recipient_id: recipientId, bell: false, push: { sent: 0, attempted: 0, pruned: 0 }, email: 'off' };

  let prefs = [];
  try { prefs = await db.rpc('get_effective_notification_prefs', { p_employee_id: recipientId }); }
  catch { prefs = []; }
  const forType = (prefs || []).filter((p) => p.type_key === type.type_key);
  const on = (ch) => forType.some((p) => p.channel === ch && p.enabled);

  // Channel 1 — in-app bell (per-recipient row).
  if (on('bell')) {
    try {
      await db.rpc('create_notification', {
        p_type: type.type_key,
        p_title: body.title || type.label,
        p_body: body.body || null,
        p_link: body.link || null,
        p_entity_type: body.entity_type || null,
        p_entity_id: body.entity_id || null,
        p_job_id: body.job_id || null,
        p_payload: body.payload || {},
        p_recipient_id: recipientId,
        p_type_key: type.type_key,
      });
      result.bell = true;
    } catch { /* bell is best-effort — never fails the dispatch */ }
  }

  // Channel 2 — Web Push to each of the recipient's subscribed devices.
  if (on('push')) {
    let subs = [];
    try { subs = await db.select('push_subscriptions', `employee_id=eq.${recipientId}&select=id,endpoint,p256dh,auth`); }
    catch { subs = []; }
    const pushBody = JSON.stringify({
      title: body.title || type.label,
      body: body.body || '',
      url: body.link || '/',
      data: body.data || {},
    });
    const send = sendWebPushImpl || sendWebPush;
    for (const s of subs || []) {
      result.push.attempted++;
      try {
        const res = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, pushBody, env, { fetchImpl, vapid });
        if (res.skipped) { result.push.vapidMissing = true; continue; }
        if (res.ok) { result.push.sent++; continue; }
        if (res.status === 404 || res.status === 410) {
          try { await db.delete('push_subscriptions', `id=eq.${s.id}`); result.push.pruned++; } catch { /* prune best-effort */ }
        }
      } catch { /* one bad subscription never breaks the fan-out */ }
    }
  }

  // Channel 3 — transactional email (skips + reports a NULL address).
  if (on('email')) {
    let email = null;
    try {
      const rows = await db.select('employees', `id=eq.${recipientId}&select=email,full_name`);
      email = rows?.[0]?.email || null;
    } catch { email = null; }
    if (!email) {
      result.email = 'skipped_null';
    } else {
      try {
        const mailer = sendEmailImpl || sendEmail;
        const r = await mailer(env, {
          to: email,
          from: NOTIFY_FROM,
          subject: body.title || type.label,
          text: body.body || body.title || type.label,
          html: body.html,
        });
        result.email = r?.ok ? 'sent' : 'failed';
      } catch { result.email = 'failed'; }
    }
  }

  return result;
}

/**
 * The reusable dispatch core (no HTTP auth) — resolves the catalog type, the
 * audience, then fans out per recipient. Imported in-process by feedback-notify
 * and wrapped with auth by handleNotify. Returns a summary; never throws for a
 * disabled type (returns { skipped }).
 */
export async function dispatchEvent({ db, env, typeKey, body = {}, fetchImpl, sendWebPushImpl, sendEmailImpl }) {
  if (!typeKey) return { skipped: true, reason: 'no_type_key', recipients: 0, results: [] };

  let type = null;
  try {
    const rows = await db.select('notification_types', `type_key=eq.${typeKey}&select=*`);
    type = rows?.[0] || null;
  } catch { type = null; }
  if (!type) return { skipped: true, reason: 'unknown_type', type_key: typeKey, recipients: 0, results: [] };
  if (!type.enabled) return { skipped: true, reason: 'type_disabled', type_key: typeKey, recipients: 0, results: [] };

  const recipientIds = await resolveAudience(db, typeKey, body);

  // Resolve VAPID once for the whole fan-out (env → Supabase fallback).
  let vapid;
  try { vapid = await loadVapidConfig(env, db); } catch { vapid = undefined; }

  const results = [];
  for (const rid of recipientIds) {
    results.push(await dispatchToRecipient({ db, env, recipientId: rid, type, body, vapid, sendWebPushImpl, sendEmailImpl, fetchImpl }));
  }

  return { type_key: typeKey, recipients: recipientIds.length, results };
}

// ─── SECTION: Auth (x-webhook-secret for triggers, OR a Bearer user token) ───

async function authorize(request, env, db, fetchImpl) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret) {
    let expected = null;
    try {
      const rows = await db.select('integration_config', 'key=eq.notify_webhook_secret&select=value');
      expected = rows?.[0]?.value || null;
    } catch { expected = null; }
    if (expected && secret === expected) return { ok: true, via: 'webhook' };
    return { ok: false, status: 401, error: 'Invalid webhook secret' };
  }

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: 'Missing Authorization header' };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await (fetchImpl || fetch)(`${url}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { ok: false, status: 401, error: 'Invalid or expired token' };
  return { ok: true, via: 'bearer', authHeader };
}

// ─── SECTION: HTTP handler (injectable deps for tests) ───

export async function handleNotify({ request, env, db, fetchImpl = fetch, sendWebPushImpl, sendEmailImpl }) {
  const auth = await authorize(request, env, db, fetchImpl);
  if (!auth.ok) return { status: auth.status, data: { error: auth.error } };

  let body;
  try { body = await request.json(); }
  catch { return { status: 400, data: { error: 'Invalid JSON body' } }; }

  const typeKey = body?.type_key;
  if (!typeKey) return { status: 400, data: { error: 'type_key is required' } };

  const summary = await dispatchEvent({ db, env, typeKey, body, fetchImpl, sendWebPushImpl, sendEmailImpl });
  return { status: 200, data: summary };
}

// ─── SECTION: Pages Function entry points ───

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { status, data } = await handleNotify({ request, env, db: supabase(env), fetchImpl: fetch });
  return jsonResponse(data, status, request, env);
}
