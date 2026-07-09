/**
 * ════════════════════════════════════════════════
 * FILE: automated-send.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the one door every automated message — a bulk email campaign
 *   today, a future automated text or triggered follow-up — has to walk
 *   through to reach a customer. It always checks first whether the person
 *   is allowed to be contacted (not unsubscribed, not suppressed, not marked
 *   Do Not Disturb) before anything actually gets sent, so that check can
 *   never accidentally be skipped by a caller.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/email.js (sendEmail), functions/lib/email-consent.js
 *              (emailAllows), functions/lib/sms-consent.js (consentAllows),
 *              functions/lib/twilio.js (sendMessage), functions/lib/phone.js
 *              (normalizePhone), functions/lib/supabase.js (service-role client),
 *              functions/lib/email-template.js (wrapEmailBody — the branded
 *              shell every send is wrapped in, kept in sync with the CRM
 *              Campaigns builder's live preview, src/lib/emailTemplate.js)
 *   Data:      reads  → contacts, message_templates, email_suppressions,
 *                       automation_settings (SMS kill-switch), crm_orgs,
 *                       conversation_participants, conversations
 *              writes → sms_consent_log (SMS send/skip audit rows);
 *                       conversations + conversation_participants + messages
 *                       (Phase D: a successful automated SMS is mirrored into the
 *                       contact's thread so staff see it — WORKER IS THE SOLE
 *                       WRITER of the sms_outbound row, omni §7.1); callers log
 *                       system_events/worker_runs
 *
 * EXPORTS:
 *   sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra)
 *     — the generic "send this contact a message" entry point. `channel` is
 *     'email' or 'sms' (both live). Looks up the contact, optionally renders a
 *     message_templates row by title, then calls sendGatedEmail / sendGatedSms.
 *     Pass extra.orgId to scope the SMS kill-switch to a specific org.
 *   sendGatedSms(env, { contact, body, orgId, now }) — the gated SMS send.
 *     Checks the automation_settings.sms_sending_enabled kill-switch (default
 *     OFF), then consentAllows() (TCPA), then quiet-hours (per-recipient tz)
 *     before ever reaching twilio; every outcome is audited to sms_consent_log.
 *     The only automated path to twilio. On a real send it also (best-effort)
 *     mirrors the text into the contact's conversation thread + tracks delivery
 *     via a Twilio statusCallback, and retries transient/429 send errors with
 *     backoff (permanent errors — invalid number, opt-out — fail fast). Return
 *     shape is FROZEN: { ok, skipped, reason?, sid?, error?, permanent? }.
 *   sendGatedEmail(env, { contact, subject, html, recipientId })
 *     — the actual gated send. Both sendAutomatedMessage('email', ...) and
 *     the bulk campaign worker (functions/api/send-email-campaign.js) call
 *     THIS, so the suppression/consent check can't be bypassed by either
 *     path — there is no second way to reach sendEmail() for a marketing
 *     message. `recipientId` (an email_campaign_recipients.id), when the
 *     caller has one, makes the unsubscribe link resolve back to the exact
 *     campaign send so email_unsubscribe() can mark that row suppressed too
 *     — omit it for a non-campaign automated send (Phase 4d), which falls
 *     back to a plain ?email= unsubscribe link.
 *   renderTemplate(body, variables) — {{token}} substitution, exported for
 *     the campaign builder UI to preview a template before sending.
 *
 * NOTES / GOTCHAS:
 *   - SMS branch (Phase F) mirrors the email branch structurally: it is gated
 *     by the automation_settings.sms_sending_enabled kill-switch (default OFF —
 *     so nothing texts until Phase 4b flips it ON post-carrier-approval) AND by
 *     consentAllows() (TCPA opt-in). Do not add an SMS send path anywhere that
 *     skips this file, and never pass skip_compliance to send-message.js from
 *     an automation. 4b's remaining scope is external registration + the flag
 *     flip + Marketing.jsx UI — not this send path.
 *   - message_templates has no `channel` column (it's the pre-existing SMS/
 *     RCS canned-message table used by Conversations.jsx/DevTools.jsx) — we
 *     do not write to it. `templateKey` matches on `title` (case-sensitive)
 *     as a best-effort reuse of its variable-substitution *pattern*; the
 *     email campaign builder mostly carries its own subject/body instead
 *     (see email_campaigns.body_html) rather than depending on this lookup.
 *   - Unsubscribe footer + List-Unsubscribe/List-Unsubscribe-Post headers are
 *     added here, not by callers — see EMAIL-DELIVERABILITY.md.
 *   - FROZEN CONTRACT (sms-experience-wave-ownership §3/§9.3): the
 *     sendAutomatedMessage / sendGatedSms signatures and the return
 *     { ok, skipped, reason } vocabulary must not change shape. The reason
 *     strings 'sms_disabled' and 'quiet_hours' are load-bearing (process-sequences
 *     + process-crm-automations HOLD-and-retry on them). Phase D only ADDS fields
 *     (sid/error/permanent) and never renames a reason — backward-compat tests in
 *     automated-send.test.js guard both non-owned callers.
 *   - Phase D (F-12): a SUCCESSFUL automated SMS is mirrored into the contact's
 *     conversation thread (find-or-create) with a Twilio statusCallback so it is
 *     visible + delivery-tracked. That write is BEST-EFFORT — it is wrapped and
 *     swallowed so a thread/DB hiccup can never turn a delivered text into a
 *     reported failure. Quiet-hours timezone is now per-recipient (area code →
 *     state → default); transient/429 sends retry with backoff, permanent ones
 *     (invalid number, opt-out) fail fast with { permanent: true }.
 * ════════════════════════════════════════════════
 */

import { sendEmail } from './email.js';
import { emailAllows } from './email-consent.js';
import { consentAllows } from './sms-consent.js';
import { sendMessage } from './twilio.js';
import { normalizePhone } from './phone.js';
import { supabase } from './supabase.js';
import { wrapEmailBody } from './email-template.js';
import { classifyTwilioError } from './twilio-errors.js';

// ─── SECTION: Helpers ──────────────
export function renderTemplate(body, variables = {}) {
  return String(body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = variables[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Case-insensitive on purpose — suppressions are stored/matched via
// lower(email) everywhere else (the unique index, preview_email_audience);
// `ilike` with no wildcard characters is PostgREST's case-insensitive
// exact-match operator, so a differently-cased repeat send still gets caught.
async function isEmailSuppressed(db, email) {
  if (!email) return false;
  const rows = await db.select(
    'email_suppressions',
    `email=ilike.${encodeURIComponent(email)}&limit=1`
  );
  return rows.length > 0;
}

function buildUnsubscribeUrl(env, email, recipientId) {
  const base = env.PAGES_URL || 'https://utahpros.app';
  const params = recipientId ? new URLSearchParams({ rid: recipientId }) : new URLSearchParams({ email });
  return `${base.replace(/\/$/, '')}/api/email-unsubscribe?${params.toString()}`;
}

// ─── SECTION: sendGatedEmail — the one path to sendEmail() for marketing mail ──
export async function sendGatedEmail(env, { contact, subject, html, recipientId } = {}) {
  const db = supabase(env);
  const email = contact?.email || null;
  const suppressed = await isEmailSuppressed(db, email);
  const allowed = emailAllows({ email, suppressed, dnd: !!contact?.dnd });

  if (!allowed) {
    return {
      ok: false,
      skipped: true,
      reason: !email ? 'no_email' : suppressed ? 'suppressed' : 'dnd',
    };
  }

  const unsubscribeUrl = buildUnsubscribeUrl(env, email, recipientId);
  // Same branded shell the CRM Campaigns builder's live preview renders
  // (src/lib/emailTemplate.js) — keep both in sync, see that file's NOTES.
  const wrappedHtml = wrapEmailBody({ bodyHtml: html, unsubscribeUrl });

  const result = await sendEmail(env, {
    to: { email, name: contact?.name },
    subject,
    html: wrappedHtml,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  return { ok: result.ok, skipped: false, error: result.error, resendId: result.id };
}

// ─── SECTION: sendGatedSms — the one path to twilio for automated SMS ─────────
// Structural twin of sendGatedEmail. Two gates, in order:
//   1. GLOBAL KILL-SWITCH — automation_settings.sms_sending_enabled, default
//      OFF (Phase F). While OFF nothing is texted, so 4d/8 can build SMS steps
//      that stay dark until Phase 4b flips it ON after A2P 10DLC carrier
//      approval. There is deliberately no way to reach twilio for an automated
//      text that skips this switch.
//   2. TCPA CONSENT — consentAllows() against the contact's phone/opt_in/dnd.
// Every outcome (sent, each skip reason, failure) is written to sms_consent_log
// so a blocked or disabled send is durably auditable, matching send-message.js.
async function resolveRealOrgId(db) {
  const rows = await db.select('crm_orgs', 'is_test=eq.false&select=id&order=created_at.asc&limit=1');
  return rows[0]?.id || null;
}

async function smsSendingEnabled(db, orgId) {
  if (!orgId) return false;
  const rows = await db.select('automation_settings', `org_id=eq.${orgId}&select=sms_sending_enabled&limit=1`);
  return rows[0]?.sms_sending_enabled === true;
}

async function logSmsConsent(db, contact, eventType, details) {
  // Best-effort audit — never let a logging failure change a send decision.
  try {
    await db.insert('sms_consent_log', {
      contact_id: contact?.id || null,
      phone: contact?.phone || null,
      event_type: eventType,
      source: 'automation',
      details,
    });
  } catch { /* swallow — the return value already carries the outcome */ }
}

// TCPA quiet-hours (Gate 3). Automated/marketing SMS may only be sent between
// 8am and 9pm in the RECIPIENT's local time. "Local" is best-effort: the
// contact's own timezone when known, else a configurable business-market default
// (Mountain — Utah Pros' service area). Refine to an area-code-derived zone
// before serving many timezones at scale. Uses tz-aware Intl so DST (MST vs MDT)
// is handled for free. Applies to SMS only — email (CAN-SPAM) has no time-of-day
// restriction — and a hit DEFERS the send (skipped + retried), never drops it.
export const QUIET_HOURS_START = 8;   // inclusive — first sendable hour is 08:00
export const QUIET_HOURS_END = 21;    // exclusive — last sendable hour is 20:xx (before 9pm)
export const DEFAULT_SMS_TIMEZONE = 'America/Denver';

// Hour-of-day (0–23) at `date` in `timeZone`; falls back to the UTC hour if the
// zone is unrecognized, so a bad config can never crash a send.
export function hourInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone })
      .formatToParts(date);
    const raw = parts.find((p) => p.type === 'hour')?.value;
    const n = raw != null ? parseInt(raw, 10) % 24 : NaN; // normalize a '24' midnight → 0
    return Number.isFinite(n) ? n : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

// True when `date` is inside the TCPA quiet window (before 8am or at/after 9pm)
// in `timeZone` — i.e. an automated SMS must NOT go out right now.
export function isWithinQuietHours(date, timeZone = DEFAULT_SMS_TIMEZONE) {
  const hour = hourInTimeZone(date, timeZone);
  return hour < QUIET_HOURS_START || hour >= QUIET_HOURS_END;
}

// ─── SECTION: Per-recipient timezone (TCPA quiet-hours) ───────────────────────
// TCPA quiet-hours are keyed to the CALLED PARTY's location, which regulators
// infer from the phone's area code — so the recipient's own number is the most
// defensible quiet-hours signal (and the one field an SMS recipient always has;
// there is no `contacts.timezone` column and Phase D ships zero schema). We map
// the number's NANP area code → US IANA zone, fall back to the billing state,
// then to the business-market default (Mountain — Utah Pros' service area). The
// map is best-effort for zone-straddling area codes; an unknown/ambiguous code
// resolves to the conservative business default rather than guessing.
const AREA_CODES_BY_ZONE = {
  'America/New_York': [ // Eastern
    '201','202','203','207','212','215','216','220','223','229','234','240','252','267','272','276','301','302','304','305','315','321','323','326','330','332','336','339','347','351','352','380','386','401','404','407','410','412','413','419','423','434','440','443','445','470','475','478','484','508','510','513','516','517','518','540','551','561','567','570','571','582','585','586','603','606','607','609','610','614','616','617','626','631','634','640','646','667','678','680','681','689','703','704','706','716','717','718','724','732','734','740','743','754','757','762','765','770','772','774','781','786','802','803','804','810','812','813','814','826','828','835','838','839','843','845','848','854','856','857','859','862','864','865','878','901','904','908','910','912','914','917','919','929','930','934','937','938','941','947','948','954','959','973','978','980','984','989','585','516',
  ],
  'America/Chicago': [ // Central
    '205','210','214','217','218','219','224','225','228','251','254','256','262','270','281','309','312','314','316','318','319','320','325','327','331','334','337','346','361','364','380','402','405','409','414','417','430','432','447','464','469','479','501','504','507','512','515','531','534','539','563','573','580','601','605','608','612','615','618','620','629','630','636','641','651','659','660','662','682','701','708','712','713','715','726','731','737','763','769','773','779','785','806','815','816','817','830','832','847','850','870','872','901','903','913','918','920','931','936','940','945','952','956','972','975','979','985',
  ],
  'America/Denver': [ // Mountain (incl. Utah)
    '303','307','308','385','406','435','505','575','719','720','801','915','970','983','986',
  ],
  'America/Phoenix': [ // Arizona (no DST)
    '480','520','602','623','928',
  ],
  'America/Los_Angeles': [ // Pacific
    '206','209','213','253','279','310','323','341','360','408','415','424','425','442','458','503','509','510','530','541','559','562','564','619','626','628','650','657','661','669','702','707','714','725','747','760','775','805','818','820','831','840','858','909','916','925','949','951','971',
  ],
  'America/Anchorage': ['907'], // Alaska
  'Pacific/Honolulu': ['808'],  // Hawaii
};

// Flattened area-code → zone lookup (built once at module load).
export const AREA_CODE_TZ = Object.entries(AREA_CODES_BY_ZONE).reduce((map, [zone, codes]) => {
  for (const code of codes) map[code] = zone;
  return map;
}, {});

// Two-letter US state/territory → IANA zone (secondary signal when the area code
// is unknown but a billing state is on file). Zone-straddling states take their
// majority zone; AZ is Phoenix (no DST).
export const US_STATE_TZ = {
  AL:'America/Chicago', AK:'America/Anchorage', AZ:'America/Phoenix', AR:'America/Chicago',
  CA:'America/Los_Angeles', CO:'America/Denver', CT:'America/New_York', DE:'America/New_York',
  DC:'America/New_York', FL:'America/New_York', GA:'America/New_York', HI:'Pacific/Honolulu',
  ID:'America/Denver', IL:'America/Chicago', IN:'America/New_York', IA:'America/Chicago',
  KS:'America/Chicago', KY:'America/New_York', LA:'America/Chicago', ME:'America/New_York',
  MD:'America/New_York', MA:'America/New_York', MI:'America/New_York', MN:'America/Chicago',
  MS:'America/Chicago', MO:'America/Chicago', MT:'America/Denver', NE:'America/Chicago',
  NV:'America/Los_Angeles', NH:'America/New_York', NJ:'America/New_York', NM:'America/Denver',
  NY:'America/New_York', NC:'America/New_York', ND:'America/Chicago', OH:'America/New_York',
  OK:'America/Chicago', OR:'America/Los_Angeles', PA:'America/New_York', RI:'America/New_York',
  SC:'America/New_York', SD:'America/Chicago', TN:'America/Chicago', TX:'America/Chicago',
  UT:'America/Denver', VT:'America/New_York', VA:'America/New_York', WA:'America/Los_Angeles',
  WV:'America/New_York', WI:'America/Chicago', WY:'America/Denver',
};

// Resolve the recipient's quiet-hours timezone. Priority: an explicit
// contact.timezone (future-proof — no such column today) → the phone's area code
// → the billing state → env override → business default. Never throws.
export function timezoneForContact(contact, env) {
  if (contact?.timezone) return contact.timezone;
  const digits = String(contact?.phone || '').replace(/\D/g, '');
  // NANP: an 11-digit number starts with country code '1'; the 3 digits after it
  // (or the leading 3 of a 10-digit number) are the area code.
  const areaCode = digits.length === 11 && digits[0] === '1'
    ? digits.slice(1, 4)
    : digits.length === 10 ? digits.slice(0, 3) : null;
  if (areaCode && AREA_CODE_TZ[areaCode]) return AREA_CODE_TZ[areaCode];
  const state = String(contact?.billing_state || '').trim().toUpperCase();
  if (state && US_STATE_TZ[state]) return US_STATE_TZ[state];
  return env?.SMS_QUIET_HOURS_TZ || DEFAULT_SMS_TIMEZONE;
}

// ─── SECTION: Send-error classification + backoff ─────────────────────────────
// twilio.js throws a plain Error whose message carries Twilio's text/code; it is
// frozen (F-core), so we classify from the message string. Rate-limit (429) and
// 5xx/network are TRANSIENT (retry with backoff); a recognized delivery code or
// an otherwise-unexplained failure is PERMANENT — so run-automations records a
// terminal event and stops infinite-retrying an invalid number (F-10 companion).
export function classifySendError(error) {
  const msg = String(error?.message || error || '');
  const codeMatch = msg.match(/\b(\d{5})\b/);
  const code = codeMatch ? parseInt(codeMatch[1], 10) : null;
  if (/\b(429|20429)\b|too many requests|rate ?limit/i.test(msg)) {
    return { transient: true, rateLimited: true, code: code || 429, contactFlag: null };
  }
  if (/\b5\d{2}\b|timeout|timed out|network|econnreset|econnrefused|fetch failed|socket/i.test(msg)) {
    return { transient: true, rateLimited: false, code, contactFlag: null };
  }
  // Not transient → permanent. Surface any contactFlag the frozen classifier knows.
  const cls = classifyTwilioError(code);
  return { transient: false, rateLimited: false, code, contactFlag: cls.contactFlag };
}

const MAX_SEND_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF_MS = 1000;
const TRANSIENT_BACKOFF_MS = 300;

// Send one SMS through twilio.js, retrying TRANSIENT failures (429 / 5xx /
// network) with linear backoff. A PERMANENT failure throws immediately with
// `.permanent = true` so the caller does not retry it. `sleep` is injectable for
// tests. Returns the twilio result object on success.
export async function sendSmsWithBackoff(env, { to, body, statusCallback, sleep, maxAttempts = MAX_SEND_ATTEMPTS } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sendMessage(env, { to, body, statusCallback });
    } catch (e) {
      lastError = e;
      const cls = classifySendError(e);
      if (!cls.transient) { e.permanent = true; throw e; }
      if (attempt === maxAttempts) { e.permanent = false; throw e; }
      const base = cls.rateLimited ? RATE_LIMIT_BACKOFF_MS : TRANSIENT_BACKOFF_MS;
      await wait(base * attempt);
    }
  }
  throw lastError;
}

// ─── SECTION: Thread visibility (F-12) ────────────────────────────────────────
// Where the Twilio status callback should report delivery for automated sends.
// Cron has no request host, so this relies on env.PAGES_URL (same fallback the
// unsubscribe-link builder uses). The callback lands on Phase A's /api/twilio-status,
// which fills status/error_code/num_segments/price by twilio_sid.
function buildStatusCallbackUrl(env) {
  const base = (env?.PAGES_URL || 'https://utahpros.app').replace(/\/$/, '');
  return `${base}/api/twilio-status`;
}

// Find the contact's active conversation, or create a direct one. Mirrors the
// inbound find-or-create in twilio-webhook.js so automated + inbound + staff
// sends all share the SAME per-contact thread.
async function findOrCreateAutomatedConversation(db, contact, phone) {
  const parts = await db.select(
    'conversation_participants',
    `contact_id=eq.${contact.id}&is_active=eq.true&select=conversation_id&limit=1`
  );
  if (parts.length > 0) {
    const [existing] = await db.select('conversations', `id=eq.${parts[0].conversation_id}`);
    if (existing) return existing;
  }
  const [conversation] = await db.insert('conversations', {
    type: 'direct',
    title: contact.name || phone || 'Contact',
    status: 'waiting_on_client', // we texted them; awaiting their reply
  });
  if (conversation) {
    await db.insert('conversation_participants', {
      conversation_id: conversation.id,
      contact_id: contact.id,
      phone,
      role: 'primary',
    });
  }
  return conversation || null;
}

// Mirror a just-sent automated SMS into its thread + record the row that the
// status callback will update. Best-effort: a thread-write failure must NEVER
// turn a delivered text into a reported failure (the send already happened), so
// everything here is wrapped and swallowed. Worker is the sole writer (omni §7.1).
async function recordAutomatedSms(db, { contact, phone, body, sid, status }) {
  try {
    const conversation = await findOrCreateAutomatedConversation(db, contact, phone);
    if (!conversation) return null;
    const [row] = await db.insert('messages', {
      conversation_id: conversation.id,
      type: 'sms_outbound',
      body,
      channel: 'sms',
      direction: 'outbound',
      status: sid ? (status || 'queued') : 'failed',
      twilio_sid: sid || null,
      sent_by: null, // automated — no staff sender
      // num_segments / price left NULL — Phase A fills them from the status callback.
    });
    const now = new Date().toISOString();
    await db.update('conversations', `id=eq.${conversation.id}`, {
      last_message_at: now,
      last_message_preview: String(body || '').substring(0, 100),
      updated_at: now,
    });
    return row || null;
  } catch {
    return null; // visibility is best-effort; the send is the source of truth
  }
}

export async function sendGatedSms(env, { contact, body, orgId, now } = {}) {
  const db = supabase(env);
  const phone = normalizePhone(contact?.phone);
  const org = orgId || await resolveRealOrgId(db);

  // Gate 1: global kill-switch (OFF by default).
  if (!(await smsSendingEnabled(db, org))) {
    await logSmsConsent(db, contact, 'send_blocked_disabled', 'Automated SMS skipped: sms_sending_enabled is OFF');
    return { ok: false, skipped: true, reason: 'sms_disabled' };
  }

  // Gate 2: TCPA consent.
  if (!consentAllows({ phone, opt_in_status: contact?.opt_in_status, dnd: contact?.dnd })) {
    const reason = !phone ? 'no_phone' : contact?.dnd ? 'dnd' : 'no_consent';
    const eventType = reason === 'dnd'
      ? 'send_blocked_dnd'
      : reason === 'no_consent' ? 'send_blocked_no_consent' : 'send_blocked_no_phone';
    await logSmsConsent(db, contact, eventType, `Automated SMS skipped: ${reason}`);
    return { ok: false, skipped: true, reason };
  }

  // Gate 3: TCPA quiet-hours (8am–9pm recipient-local). DEFERRED, not dropped —
  // callers that retry (process-sequences holds a 'quiet_hours' skip and resends)
  // deliver once the window opens, so a text due at 2am simply goes out at 8am.
  // "Recipient-local" is resolved per-contact from the phone's area code (F-12).
  const tz = timezoneForContact(contact, env);
  if (isWithinQuietHours(now ? new Date(now) : new Date(), tz)) {
    await logSmsConsent(db, contact, 'send_deferred_quiet_hours',
      `Automated SMS deferred: outside ${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00 ${tz}`);
    return { ok: false, skipped: true, reason: 'quiet_hours' };
  }

  // All gates passed → send (transient/429-aware, permanent = fail fast) with a
  // delivery status callback, then mirror the text into its thread (best-effort).
  const statusCallback = buildStatusCallbackUrl(env);
  try {
    const result = await sendSmsWithBackoff(env, { to: phone, body, statusCallback });
    await logSmsConsent(db, contact, 'automated_send', `Automated SMS sent (sid ${result.sid})`);
    await recordAutomatedSms(db, { contact, phone, body, sid: result.sid, status: result.status });
    return { ok: true, skipped: false, sid: result.sid };
  } catch (e) {
    await logSmsConsent(db, contact, 'send_failed', `Automated SMS failed: ${e.message}`);
    // `permanent` (additive to the frozen return) lets run-automations stop
    // retrying an invalid number instead of re-attempting it every cron tick.
    const permanent = e.permanent ?? !classifySendError(e).transient;
    return { ok: false, skipped: false, error: e.message, permanent };
  }
}

// ─── SECTION: sendAutomatedMessage — the generic single-send entry point ──────
export async function sendAutomatedMessage(channel, contactId, templateKey, variables = {}, env, extra = {}) {
  if (channel !== 'email' && channel !== 'sms') {
    throw new Error(`sendAutomatedMessage: unsupported channel "${channel}"`);
  }

  const db = supabase(env);
  // opt_in_status is needed by the sms branch; billing_state backs the
  // per-recipient quiet-hours timezone fallback; both harmless for email.
  const [contact] = await db.select('contacts', `id=eq.${contactId}&select=id,email,name,phone,dnd,opt_in_status,billing_state`);
  if (!contact) return { ok: false, skipped: true, reason: 'contact_not_found' };

  let body = extra.html || extra.body || '';
  if (templateKey) {
    const [tpl] = await db.select(
      'message_templates',
      `title=eq.${encodeURIComponent(templateKey)}&is_active=eq.true&limit=1`
    );
    if (tpl) body = tpl.body;
  }

  const rendered = renderTemplate(body, variables);

  if (channel === 'sms') {
    return sendGatedSms(env, { contact, body: rendered, orgId: extra.orgId, now: extra.now });
  }

  return sendGatedEmail(env, {
    contact,
    subject: extra.subject || '',
    html: rendered,
  });
}
