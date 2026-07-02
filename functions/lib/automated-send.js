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
 *              (emailAllows), functions/lib/supabase.js (service-role client),
 *              functions/lib/email-template.js (wrapEmailBody — the branded
 *              shell every send is wrapped in, kept in sync with the CRM
 *              Campaigns builder's live preview, src/lib/emailTemplate.js)
 *   Data:      reads  → contacts, message_templates, email_suppressions
 *              writes → none directly (callers log system_events/worker_runs)
 *
 * EXPORTS:
 *   sendAutomatedMessage(channel, contactId, templateKey, variables, env, extra)
 *     — the generic "send this contact a message" entry point. `channel` is
 *     'email' (live) or 'sms' (Phase 4b TODO, throws for now). Looks up the
 *     contact, optionally renders a message_templates row by title, then
 *     calls sendGatedEmail — see below.
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
 *   - SMS branch is a documented TODO for Phase 4b: it should mirror the
 *     email branch exactly — look up sms_consent_log-backed consentAllows(),
 *     then call the existing functions/lib/twilio.js sender — and gate it
 *     the same structurally-unbypassable way. Do not add an SMS send path
 *     anywhere that skips this file.
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

// ─── SECTION: sendAutomatedMessage — the generic single-send entry point ──────
export async function sendAutomatedMessage(channel, contactId, templateKey, variables = {}, env, extra = {}) {
  if (channel === 'sms') {
    // Phase 4b TODO — mirror the email branch: consentAllows() against
    // sms_consent_log, then functions/lib/twilio.js. Do not bypass this file.
    throw new Error('sendAutomatedMessage: sms channel not implemented yet (Phase 4b)');
  }
  if (channel !== 'email') {
    throw new Error(`sendAutomatedMessage: unsupported channel "${channel}"`);
  }

  const db = supabase(env);
  // phone included for Phase 4d parity with the campaign send path
  // (functions/api/send-email-campaign.js) — this function doesn't auto-merge
  // contact fields into `variables` itself, so this alone is prep, not full
  // wiring; a caller still has to pass phone through `extra`/`variables`.
  const [contact] = await db.select('contacts', `id=eq.${contactId}&select=id,email,name,phone,dnd`);
  if (!contact) return { ok: false, skipped: true, reason: 'contact_not_found' };

  let body = extra.html || extra.body || '';
  if (templateKey) {
    const [tpl] = await db.select(
      'message_templates',
      `title=eq.${encodeURIComponent(templateKey)}&is_active=eq.true&limit=1`
    );
    if (tpl) body = tpl.body;
  }

  return sendGatedEmail(env, {
    contact,
    subject: extra.subject || '',
    html: renderTemplate(body, variables),
  });
}
