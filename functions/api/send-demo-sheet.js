// POST /api/send-demo-sheet  body: { subject, message }
// Sends the rendered demo-sheet HTML email via Resend (through the shared
// functions/lib/email.js helper).
// Canonical response shape — always returns 200 with `{ ok }` so the
// frontend can read body details cleanly. Some upstream layers strip the
// body on 5xx responses, so we surface success/failure as a body field
// instead of an HTTP status code.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireUser } from '../lib/auth.js';
import { sendEmail } from '../lib/email.js';

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
    const auth = await requireUser(request, env);
    if (auth.error) return jsonResponse({ ok: false, error: auth.error }, auth.status, request, env);

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

    // DEMO_SHEET_FROM_EMAIL (bare address) overrides the default sender if set.
    const fromEmail = env.DEMO_SHEET_FROM_EMAIL
      ? `Utah Pros Restoration <${env.DEMO_SHEET_FROM_EMAIL}>`
      : undefined; // undefined → helper uses EMAIL_FROM / default
    const toList = (env.DEMO_SHEET_TO_EMAILS || 'moroni.s@utah-pros.com,restoration@utah-pros.com')
      .split(',').map(s => s.trim()).filter(Boolean);

    const emailRes = await sendEmail(env, {
      to:      toList,
      from:    fromEmail,
      subject,
      text:    htmlToText(message),
      html:    message,
    });

    if (!emailRes.ok) {
      console.error('send-demo-sheet Resend error:', emailRes.status, String(emailRes.error).slice(0, 500));
      // Match send-esign.js: 200 with explicit email_error fields so the
      // frontend can always parse the body and surface the real reason.
      return jsonResponse({
        ok: false,
        error: `Email send failed (${emailRes.status})`,
        email_status: emailRes.status,
        email_error_detail: String(emailRes.error).slice(0, 500),
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
