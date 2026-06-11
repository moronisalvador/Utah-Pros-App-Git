// POST /api/send-demo-sheet  body: { subject, message }
// Sends the rendered demo-sheet HTML email via Resend (lib/email.js).
// Mirrors send-esign.js / resend-esign.js: the canonical response shape —
// always returns 200 with `{ ok }` so the frontend can read body details
// cleanly. Some upstream layers strip the body on 5xx responses, so we
// surface success/failure as a body field instead of an HTTP status code.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { sendEmail, namedAddress } from '../lib/email.js';

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Top-level guard: anything that throws ends up as JSON 200 with ok:false
  try {
    if (!env.RESEND_API_KEY) {
      return jsonResponse({
        ok: false,
        error: 'RESEND_API_KEY missing in Cloudflare Pages env vars',
      }, 200, request, env);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 200, request, env);
    }

    const { subject, message } = body || {};
    if (!subject || !message) {
      return jsonResponse({ ok: false, error: 'subject and message required' }, 200, request, env);
    }

    const fromEmail = env.DEMO_SHEET_FROM_EMAIL || 'restoration@utah-pros.com';
    const toList = (env.DEMO_SHEET_TO_EMAILS || 'moroni.s@utah-pros.com,restoration@utah-pros.com')
      .split(',').map(s => s.trim()).filter(Boolean);

    const email = await sendEmail(env, {
      to:      toList,
      from:    namedAddress('Utah Pros Restoration', fromEmail),
      replyTo: fromEmail,
      subject,
      text:    htmlToText(message),
      html:    message,
    });

    if (!email.ok) {
      console.error('send-demo-sheet Resend error:', email.status, email.error);
      // Match send-esign.js: 200 with explicit email_error fields so the
      // frontend can always parse the body and surface the real reason.
      return jsonResponse({
        ok: false,
        error: `Resend ${email.status}`,
        email_status: email.status,
        email_error_detail: email.error,
      }, 200, request, env);
    }

    return jsonResponse({ ok: true }, 200, request, env);
  } catch (err) {
    console.error('send-demo-sheet unhandled error:', err);
    return jsonResponse({
      ok: false,
      error: 'Worker exception',
      detail: err?.message || String(err),
    }, 200, request, env);
  }
}
