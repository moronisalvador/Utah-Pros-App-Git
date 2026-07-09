/**
 * ════════════════════════════════════════════════
 * FILE: twilio-status.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Twilio calls this endpoint every time a text we sent changes state
 *   (queued → sent → delivered, or failed / undelivered). It records the real
 *   delivery state on our copy of the message so the inbox shows the truth, and
 *   captures how many segments Twilio billed and the price. Phase A hardened it:
 *     1. It now VERIFIES the call really came from Twilio (signed request) using
 *        the current auth token from the Connections page (not just the old env
 *        var), so rotating the token can't silently break or spoof status.
 *     2. It only stores statuses our database allows and it never moves a
 *        message backwards — a late "sent" can't overwrite a "delivered".
 *     3. When Twilio reports a definitive failure (recipient opted out, or the
 *        number is unreachable) it stops future texts to that contact and logs
 *        why, so we never keep texting a number that told us to stop.
 *     4. Every call writes a worker_runs row, and a real database error returns
 *        500 so Twilio retries instead of us silently losing the update.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: POST /api/twilio-status  (Twilio StatusCallback URL — public,
 *             authenticated by the X-Twilio-Signature HMAC, not a session)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-role REST client),
 *              ../lib/twilio.js (validateTwilioSignature),
 *              ../lib/credentials.js (resolveCredential — DB-first auth token),
 *              ../lib/twilio-errors.js (classifyTwilioError — suppression map),
 *              ../lib/cors.js
 *   Data:      reads  → messages (current status, by twilio_sid),
 *                       conversation_participants, contacts, integration_credentials
 *              writes → messages (status/error/num_segments/price/read_at/clicked_at),
 *                       contacts (dnd/opt-out on a suppressing error), sms_consent_log,
 *                       worker_runs (one row per call)
 *
 * NOTES / GOTCHAS:
 *   - The messages.status CHECK only allows queued|sent|delivered|read|failed|
 *     undelivered|received. Twilio also sends sending/accepted/delivering — those
 *     are dropped (WRITABLE_STATUSES), but their metering (segments/price) is
 *     still captured. Metering is order-agnostic, so it is captured on ANY
 *     callback even when the status write is skipped by the monotonic guard.
 *   - Out-of-order guard is a strict rank increase (STATUS_RANK). Equal rank
 *     (a duplicate callback) is a no-op → 200, not an error.
 *   - Error-code → suppression lives HERE, not in twilio-webhook.js, because a
 *     delivery ErrorCode (21610 opt-out, 30006 unreachable, 30007 carrier,
 *     30034 A2P) only arrives on this StatusCallback for an OUTBOUND message —
 *     never on the inbound webhook. (Reconciles the dispatch's cross-reference
 *     with Twilio's actual data flow; twilio-errors.js is the shared map.)
 *   - Suppression uses existing contacts columns only (no schema change — F owns
 *     schema): opt-out (21610) → opt_in_status=false + dnd; unreachable (30006) →
 *     dnd + a distinct opt_out_reason. Both are logged to sms_consent_log.
 *   - Not-found-by-sid returns 500 (the send→callback race: the message row may
 *     not have committed yet) so Twilio retries; a genuinely foreign SID simply
 *     ages out of Twilio's retry schedule.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { validateTwilioSignature } from '../lib/twilio.js';
import { resolveCredential } from '../lib/credentials.js';
import { classifyTwilioError } from '../lib/twilio-errors.js';
import { handleOptions } from '../lib/cors.js';

const WORKER_NAME = 'twilio-status';

// ─── SECTION: Pure decision logic (unit-tested) ──────────────

// Statuses the messages.status CHECK accepts. Twilio's transitional states
// (sending/accepted/delivering/receiving) are intentionally excluded — writing
// one would violate the CHECK and 400 the whole update.
export const WRITABLE_STATUSES = new Set([
  'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'received',
]);

// Monotonic progression rank. A status write only applies when it moves strictly
// forward, so a late/duplicate callback can never regress a message. Terminal
// negative (failed/undelivered) sits below delivered/read on purpose: a stray
// late failure must NOT un-deliver a confirmed delivery, but it still records
// over any in-flight state (queued/sent).
const STATUS_RANK = {
  queued: 1, accepted: 1, received: 1,
  sending: 2,
  sent: 3,
  delivering: 4,
  undelivered: 5, failed: 5,
  delivered: 6,
  read: 7,
};

// True when `incoming` may be written over `current`: it must be a DB-writable
// status AND rank strictly higher than the current status (forward-only).
export function shouldApplyStatus(current, incoming) {
  if (!incoming || !WRITABLE_STATUSES.has(incoming)) return false;
  const rankIn = STATUS_RANK[incoming] ?? 0;
  const rankCur = current ? (STATUS_RANK[current] ?? 0) : 0;
  return rankIn > rankCur;
}

// Twilio NumSegments → integer, or null when absent/blank/non-numeric.
export function parseSegments(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// Twilio Price (a negative decimal string like "-0.00750") → number, or null.
export function parsePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

// Build the exact patch to PATCH onto the message row. Status/error/read_at are
// gated by the monotonic guard (never regress); metering is captured regardless
// (a later callback often carries the final segments/price).
export function buildStatusUpdate({ current, messageStatus, errorCode, errorMessage, numSegments, price, buttonText, nowIso }) {
  const update = {};
  const applyStatus = shouldApplyStatus(current?.status, messageStatus);

  if (applyStatus) {
    update.status = messageStatus;
    if (messageStatus === 'read') update.read_at = nowIso;
    // Error info belongs to the transition we are recording — attaching it to a
    // message we are NOT transitioning (a stray late failure over a delivered
    // row) would be misleading, so it is gated behind applyStatus too.
    if (errorCode) update.error_code = String(errorCode);
    if (errorMessage) update.error_message = errorMessage;
  }

  // RCS suggested-action tap — independent of the linear status progression.
  if (buttonText) update.clicked_at = nowIso;

  const seg = parseSegments(numSegments);
  if (seg != null) update.num_segments = seg;
  const pr = parsePrice(price);
  if (pr != null) update.price = pr;

  return update;
}

// ─── SECTION: Suppression side-effect (delivery ErrorCode → contact flags) ────
// On an APPLIED failure whose code says "stop texting this number", flip the
// recipient contact(s) using existing columns only, and log the reason.
export async function applyErrorSuppression(db, { message, errorCode }) {
  const cls = classifyTwilioError(errorCode);
  if (!cls.suppress || !message?.conversation_id) return;

  // Resolve the recipient contact(s) via the conversation's active participants.
  const participants = await db.select(
    'conversation_participants',
    `conversation_id=eq.${message.conversation_id}&is_active=eq.true&select=contact_id`
  );
  const ids = [...new Set(participants.map((p) => p.contact_id).filter(Boolean))];
  if (ids.length === 0) return;

  const contacts = await db.select('contacts', `id=in.(${ids.join(',')})&select=id,phone,dnd,opt_in_status`);
  if (contacts.length === 0) return;

  const isOptOut = cls.contactFlag === 'opt_out';

  // Idempotency: only touch contacts NOT already in the target suppressed state,
  // so a Twilio retry (this fires on the callback, not the status transition)
  // re-runs without duplicate consent-log rows or redundant writes.
  const needing = contacts.filter((c) =>
    isOptOut ? !(c.dnd === true && c.opt_in_status === false) : c.dnd !== true
  );
  if (needing.length === 0) return;
  const needIds = needing.map((c) => c.id);

  const nowIso = new Date().toISOString();
  const reason = isOptOut ? `sms_opt_out_${errorCode}` : `invalid_number_${errorCode}`;

  // opt_out (21610) is a real consent withdrawal → clear opt-in as well.
  // invalid_number (30006) is a bad/unreachable number → suppress via dnd only,
  // leaving opt_in_status untouched (they never opted out).
  const patch = isOptOut
    ? { opt_in_status: false, opt_out_at: nowIso, opt_out_reason: reason, dnd: true, dnd_at: nowIso, updated_at: nowIso }
    : { dnd: true, dnd_at: nowIso, opt_out_reason: reason, updated_at: nowIso };

  await db.update('contacts', `id=in.(${needIds.join(',')})`, patch);

  await db.insert('sms_consent_log', needing.map((c) => ({
    contact_id: c.id,
    phone: c.phone || null,
    event_type: isOptOut ? 'stop_delivery_error' : 'invalid_number',
    source: 'twilio_status',
    details: `Twilio error ${errorCode} (${cls.label}) on message ${message.id}. Suppressed further sends.`,
  })));
}

// ─── SECTION: worker_runs ──────────────
async function recordRun(db, { status, processed, errorMessage, startedAt }) {
  try {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME,
      status,
      records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch { /* worker_runs is telemetry — never let it break the response path */ }
}

// ─── SECTION: HTTP handler ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  // ── 1. Verify the request is really from Twilio (DB-first auth token — F-13) ──
  // Resolve the token from the Connections page first, env fallback, so rotating
  // it does not silently break (or open) status validation.
  let authToken = null;
  try {
    ({ authToken } = await resolveCredential(env, db, 'twilio'));
  } catch { authToken = env.TWILIO_AUTH_TOKEN || null; }

  if (!authToken) {
    console.warn('twilio-status: no Twilio auth token configured — rejecting (fail closed)');
    await recordRun(db, { status: 'error', processed: 0, errorMessage: 'no auth token', startedAt });
    return new Response('Twilio auth token not configured', { status: 500 });
  }
  const isValid = await validateTwilioSignature(request, authToken, request.url);
  if (!isValid) {
    await recordRun(db, { status: 'error', processed: 0, errorMessage: 'invalid signature', startedAt });
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const formData = await request.formData();
    const messageSid = formData.get('MessageSid');
    const messageStatus = formData.get('MessageStatus');
    const errorCode = formData.get('ErrorCode');
    const errorMessage = formData.get('ErrorMessage');
    const numSegments = formData.get('NumSegments');
    const price = formData.get('Price');
    const buttonText = formData.get('ButtonText');

    if (!messageSid || !messageStatus) {
      await recordRun(db, { status: 'completed', processed: 0, startedAt });
      return new Response('OK', { status: 200 }); // nothing actionable — do not retry
    }

    // ── 2. Load the current row (needed for the monotonic guard) ──
    const [message] = await db.select(
      'messages',
      `twilio_sid=eq.${encodeURIComponent(messageSid)}&select=id,status,conversation_id&limit=1`
    );

    if (!message) {
      // Almost always the send→callback race (row not committed yet). Return 500
      // so Twilio retries; a truly-foreign SID simply ages out of its schedule.
      await recordRun(db, { status: 'error', processed: 0, errorMessage: `no message for sid ${messageSid}`, startedAt });
      return new Response('Message not found — retry', { status: 500 });
    }

    // ── 3. Build the guarded patch (status forward-only, metering always) ──
    const update = buildStatusUpdate({
      current: message, messageStatus, errorCode, errorMessage,
      numSegments, price, buttonText, nowIso: new Date().toISOString(),
    });

    if (Object.keys(update).length > 0) {
      await db.update('messages', `id=eq.${message.id}`, update);
    }

    // ── 4. Suppression: a definitive delivery failure that says "stop" ──
    // Gated on the CALLBACK (failed/undelivered + a suppressing code), NOT on
    // whether the status write advanced — otherwise a transient error on the
    // status update would 500, and the retry (status now already terminal, guard
    // skips it) would permanently miss the suppression. applyErrorSuppression is
    // idempotent (skips contacts already in the target state), so a retry re-runs
    // safely without duplicate consent-log rows.
    if ((messageStatus === 'failed' || messageStatus === 'undelivered') && errorCode) {
      await applyErrorSuppression(db, { message, errorCode });
    }

    await recordRun(db, { status: 'completed', processed: Object.keys(update).length > 0 ? 1 : 0, startedAt });
    return new Response('OK', { status: 200 });

  } catch (err) {
    // Transient DB error — return 500 so Twilio retries and we don't lose state.
    console.error('twilio-status error:', err);
    await recordRun(db, { status: 'error', processed: 0, errorMessage: err.message, startedAt });
    return new Response('Server error — retry', { status: 500 });
  }
}
