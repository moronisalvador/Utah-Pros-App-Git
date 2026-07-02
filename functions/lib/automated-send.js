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
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
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
 *                       automation_settings (SMS kill-switch), crm_orgs
 *              writes → sms_consent_log (SMS send/skip audit rows); callers log
 *                       system_events/worker_runs
 *
 * EXPORTS:
 *   sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra)
 *     — the generic "send this contact a message" entry point. `channel` is
 *     'email' or 'sms' (both live). Looks up the contact, optionally renders a
 *     message_templates row by title, then calls sendGatedEmail / sendGatedSms.
 *     Pass extra.orgId to scope the SMS kill-switch to a specific org.
 *   sendGatedSms(env, { contact, body, orgId }) — the gated SMS send. Checks
 *     the automation_settings.sms_sending_enabled kill-switch (default OFF) and
 *     then consentAllows() before ever reaching twilio; every outcome is
 *     audited to sms_consent_log. The only automated path to twilio.
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
 * ════════════════════════════════════════════════
 */

import { sendEmail } from './email.js';
import { emailAllows } from './email-consent.js';
import { consentAllows } from './sms-consent.js';
import { sendMessage } from './twilio.js';
import { normalizePhone } from './phone.js';
import { supabase } from './supabase.js';
import { wrapEmailBody } from './email-template.js';

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

export async function sendGatedSms(env, { contact, body, orgId } = {}) {
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

  try {
    const result = await sendMessage(env, { to: phone, body });
    await logSmsConsent(db, contact, 'automated_send', `Automated SMS sent (sid ${result.sid})`);
    return { ok: true, skipped: false, sid: result.sid };
  } catch (e) {
    await logSmsConsent(db, contact, 'send_failed', `Automated SMS failed: ${e.message}`);
    return { ok: false, skipped: false, error: e.message };
  }
}

// ─── SECTION: sendAutomatedMessage — the generic single-send entry point ──────
export async function sendAutomatedMessage(channel, contactId, templateKey, variables = {}, env, extra = {}) {
  if (channel !== 'email' && channel !== 'sms') {
    throw new Error(`sendAutomatedMessage: unsupported channel "${channel}"`);
  }

  const db = supabase(env);
  // opt_in_status is needed by the sms branch; harmless for email.
  const [contact] = await db.select('contacts', `id=eq.${contactId}&select=id,email,name,phone,dnd,opt_in_status`);
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
    return sendGatedSms(env, { contact, body: rendered, orgId: extra.orgId });
  }

  return sendGatedEmail(env, {
    contact,
    subject: extra.subject || '',
    html: rendered,
  });
}
