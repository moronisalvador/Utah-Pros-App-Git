/**
 * ════════════════════════════════════════════════
 * FILE: conversation-email.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends ONE email reply inside a conversation — safely. Before it ever contacts
 *   the email company it checks our suppression list: if the recipient's address
 *   hard-bounced, filed a spam complaint, or is globally blocked, the reply is NOT
 *   sent. A plain marketing "unsubscribe," though, does NOT block a one-to-one
 *   reply the customer is effectively expecting (that's transactional, not
 *   marketing). It also stamps the reply so it threads: the reply-to address carries
 *   the conversation's secret token so the customer's response comes back to the
 *   right thread, and the In-Reply-To/References headers group it under the message
 *   it answers.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch via the helpers below)
 *   Internal:  functions/lib/email.js (sendEmail), functions/lib/email-threading.js
 *              (buildReplyAddress, buildThreadHeaders), functions/lib/supabase.js
 *              (the service-role worker client). Imported by
 *              functions/api/send-message.js (Phase O, the email branch).
 *   Data:      reads  → email_suppressions (the reason-aware gate)
 *              writes → none (the caller writes the messages row from the transport
 *                       actually dispatched — invariant §7.1/§7.2 of the manifest)
 *
 * EXPORTS:
 *   sendConversationEmail(env, { conversation, participant, subject, body, inReplyToMessageId })
 *     → { ok, skipped, reason, resendId }
 *   isTransactionalReplyBlocked(suppressionRow) → boolean   (pure; exported for tests)
 *
 * NOTES / GOTCHAS:
 *   - REASON-AWARE gate: blocks reason ∈ {hard_bounce, complaint, global} (and the
 *     legacy equivalents bounced/complained/manual); ALLOWS an address suppressed
 *     ONLY as 'unsubscribed'. The rule is simply: blocked ⇔ a row exists whose reason
 *     is anything other than 'unsubscribed'.
 *   - FAILS CLOSED: a missing/invalid recipient, or a suppression lookup that errors,
 *     returns { skipped:true } and sends nothing — deliverability is protected over
 *     convenience.
 *   - The reply token sets the THREAD only (invariant §7.6) — never the recipient or
 *     the channel. The recipient is always participant.email.
 * ════════════════════════════════════════════════
 */

import { sendEmail } from './email.js';
import { buildReplyAddress, buildThreadHeaders } from './email-threading.js';
import { supabase } from './supabase.js';

// Minimal RFC-ish email shape check (defense against obviously-bad recipients).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pure predicate: is a 1:1 transactional reply blocked for this suppression row?
 * No row → not blocked. A row suppressed only as 'unsubscribed' → not blocked (a
 * marketing opt-out does not bar a transactional reply). Any other reason → blocked.
 * @param {{reason?: string}|null|undefined} row
 * @returns {boolean}
 */
export function isTransactionalReplyBlocked(row) {
  if (!row) return false;
  return row.reason !== 'unsubscribed';
}

/**
 * Look up the suppression row for an address (case-insensitive, exact). Returns the
 * row or null. Throws on a transport error so the caller can fail closed.
 */
async function findSuppression(db, email) {
  const enc = encodeURIComponent(email);
  // ilike (no wildcards) is case-insensitive; a stray SQL-LIKE wildcard in the address
  // could over-match, so we re-verify an exact lowercase match in JS.
  const rows = await db.select('email_suppressions', `email=ilike.${enc}&select=email,reason&limit=5`);
  const target = email.toLowerCase();
  return (rows || []).find((r) => String(r.email || '').toLowerCase() === target) || null;
}

/**
 * Send one channel-locked, transactional email reply in a conversation.
 * @param {object} env  Cloudflare env (RESEND_API_KEY + the worker Supabase client vars)
 * @param {object} opts
 * @param {object} opts.conversation        the conversations row (needs email_reply_token)
 * @param {object} opts.participant         the recipient participant (needs .email)
 * @param {string} [opts.subject]
 * @param {string} opts.body                reply text
 * @param {string} [opts.inReplyToMessageId] RFC Message-ID of the email being replied to
 * @returns {Promise<{ok:boolean, skipped:boolean, reason:string|null, resendId:string|null}>}
 */
export async function sendConversationEmail(env, { conversation, participant, subject, body, inReplyToMessageId } = {}) {
  const recipient = String(participant?.email || '').trim();

  // 1. No/invalid destination → refuse (never guess an address; §7.3 no cross-channel retarget).
  if (!recipient || !EMAIL_RE.test(recipient)) {
    return { ok: false, skipped: true, reason: 'no_recipient_email', resendId: null };
  }

  // 2. Reason-aware suppression gate — BEFORE any Resend call. Fail closed on error.
  let suppression;
  try {
    const db = supabase(env);
    suppression = await findSuppression(db, recipient);
  } catch {
    return { ok: false, skipped: true, reason: 'suppression_check_error', resendId: null };
  }
  if (isTransactionalReplyBlocked(suppression)) {
    return { ok: false, skipped: true, reason: `suppressed:${suppression.reason}`, resendId: null };
  }

  // 3. Thread + route: reply-to carries the conversation token so replies come back
  //    to the right thread; In-Reply-To/References group it under the answered message.
  const headers = buildThreadHeaders({ inReplyTo: inReplyToMessageId, references: inReplyToMessageId });
  const replyTo = conversation?.email_reply_token ? buildReplyAddress(conversation.email_reply_token) : undefined;
  const finalSubject = subject || (conversation?.title ? `Re: ${conversation.title}` : 'Re: your message');

  // 4. Send.
  const res = await sendEmail(env, {
    to: recipient,
    subject: finalSubject,
    text: body || '',
    replyTo,
    headers,
  });

  return {
    ok: !!res.ok,
    skipped: false,
    reason: res.ok ? null : (res.error || 'send_failed'),
    resendId: res.id || null,
  };
}
