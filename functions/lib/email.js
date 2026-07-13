/**
 * ════════════════════════════════════════════════
 * FILE: email.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the one place the whole app sends email from. Every worker that
 *   needs to email someone (signing links, signed-document confirmations, the
 *   scope/demo sheet, the billing security code, the water-loss report) calls
 *   the `sendEmail` function here instead of talking to an email company
 *   directly. Today it sends through Resend; if we ever switch email companies
 *   again, this is the only file that has to change.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch — runs in Cloudflare Workers / V8 isolates)
 *   Internal:  imported by functions/api/send-esign.js, resend-esign.js,
 *              submit-esign.js, send-demo-sheet.js, billing-2fa.js,
 *              generate-water-loss-report.js
 *   Data:      reads  → none
 *              writes → none (calls the Resend HTTP API)
 *
 * EXPORTS:
 *   sendEmail(env, { to, subject, html, text, replyTo, attachments, from, headers })
 *     → Promise<{ ok, status, id, error }>  (normalized; never throws on an
 *       HTTP-level failure — inspect `ok`)
 *
 * NOTES / GOTCHAS:
 *   - Requires the RESEND_API_KEY env var (Cloudflare Pages → Variables).
 *   - `from` MUST be on a domain verified in Resend (utahpros.app). It defaults
 *     to env.EMAIL_FROM, then to a hardcoded utahpros.app sender.
 *   - `replyTo` defaults to env.EMAIL_REPLY_TO, then to restoration@utahpros.app
 *     — the SAME domain as `from` on purpose (a From/Reply-To mismatch to a
 *     look-alike domain trips Gmail's spoof warning). Replies are forwarded to
 *     the real inbox via Cloudflare Email Routing.
 *   - Attachment `content` is a base64 STRING (same encoding SendGrid used), so
 *     callers that already base64-encode a PDF can pass it through unchanged.
 *   - Resend's success response is `{ id }`; failures come back as JSON with a
 *     `message`. We normalize both into `{ ok, status, id, error }`.
 *   - `headers` (e.g. List-Unsubscribe for bulk/marketing mail — CRM Phase 4c,
 *     functions/lib/automated-send.js) passes through to Resend's own
 *     `headers` object untouched; omit it for ordinary transactional sends.
 * ════════════════════════════════════════════════
 */

import { resolveCredential } from './credentials.js';
import { fetchWithTimeout } from './http.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const DEFAULT_FROM     = 'Utah Pros Restoration <restoration@utahpros.app>';
// Reply-To is kept on the SAME domain as From (utahpros.app) on purpose: a From/Reply-To
// domain mismatch — especially to a look-alike domain like utah-pros.com — trips Gmail's
// spoofing warning. Replies to restoration@utahpros.app are forwarded to the real inbox
// via Cloudflare Email Routing. Override with the EMAIL_REPLY_TO env var if needed.
const DEFAULT_REPLY_TO = 'restoration@utahpros.app';

// ─── SECTION: Helpers ──────────────
// Normalize a recipient into a Resend address string ("Name <email>" or "email").
function toAddress(r) {
  if (!r) return null;
  if (typeof r === 'string') return r;
  if (r.email) return r.name ? `${r.name} <${r.email}>` : r.email;
  return null;
}

// Accept string | {email,name} | array of either → array of Resend address strings.
function toAddressList(to) {
  const arr = Array.isArray(to) ? to : [to];
  return arr.map(toAddress).filter(Boolean);
}

// ─── SECTION: sendEmail ──────────────
/**
 * Send one email through Resend.
 *
 * @param {object} env  Cloudflare env (needs RESEND_API_KEY; optional EMAIL_FROM, EMAIL_REPLY_TO)
 * @param {object} opts
 * @param {string|object|Array} opts.to          recipient(s)
 * @param {string} opts.subject
 * @param {string} [opts.html]
 * @param {string} [opts.text]
 * @param {string} [opts.from]                    override sender (else env.EMAIL_FROM / default)
 * @param {string} [opts.replyTo]                 override reply-to (else env.EMAIL_REPLY_TO / default)
 * @param {Array}  [opts.attachments]             [{ filename, content (base64), contentType }]
 * @param {object} [opts.headers]                 extra headers (e.g. List-Unsubscribe) — bulk/marketing sends only
 * @returns {Promise<{ok:boolean,status:number,id:string|null,error:string|null}>}
 */
export async function sendEmail(env, { to, subject, html, text, from, replyTo, attachments, headers } = {}) {
  // DB-first (integration_credentials), env fallback — see functions/lib/credentials.js
  const { apiKey } = await resolveCredential(env, null, 'resend');
  if (!apiKey) {
    return { ok: false, status: 0, id: null, error: 'RESEND_API_KEY missing' };
  }

  const toList = toAddressList(to);
  if (!toList.length) {
    return { ok: false, status: 0, id: null, error: 'No recipient (to) provided' };
  }

  const payload = {
    from:    from    || env.EMAIL_FROM     || DEFAULT_FROM,
    to:      toList,
    subject: subject || '',
  };
  if (html) payload.html = html;
  if (text) payload.text = text;

  // Resend accepts a single string or an array for reply_to.
  payload.reply_to = replyTo || env.EMAIL_REPLY_TO || DEFAULT_REPLY_TO;

  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments.map(a => ({
      filename:     a.filename,
      content:      a.content,                        // base64 string
      content_type: a.contentType || a.content_type,  // optional; Resend infers if omitted
    }));
  }

  if (headers && Object.keys(headers).length) {
    payload.headers = headers;
  }

  let res;
  try {
    res = await fetchWithTimeout(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Network/transport failure before we got any HTTP status back
    return { ok: false, status: 0, id: null, error: e?.message || 'Network error contacting Resend' };
  }

  const bodyText = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch { /* non-JSON body */ }

  if (!res.ok) {
    const msg = parsed?.message || bodyText?.slice(0, 500) || `Resend ${res.status}`;
    return { ok: false, status: res.status, id: null, error: msg };
  }

  return { ok: true, status: res.status, id: parsed?.id || null, error: null };
}
