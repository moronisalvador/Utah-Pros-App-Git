// POST /api/send-demo-sheet  body: { subject, message }
// Sends the rendered demo-sheet HTML email via SendGrid.
// Mirrors send-esign.js / resend-esign.js exactly: the canonical SendGrid
// payload shape (subject inside personalizations, text+html parts, reply_to)
// AND the canonical response shape — always returns 200 with `{ ok }` so the
// frontend can read body details cleanly. Some upstream layers strip the
// body on 5xx responses, so we surface success/failure as a body field
// instead of an HTTP status code.

import { handleOptions, jsonResponse } from '../lib/cors.js';

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
    if (!env.SENDGRID_API_KEY) {
      return jsonResponse({
        ok: false,
        error: 'SENDGRID_API_KEY missing in Cloudflare Pages env vars',
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

    const emailRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: toList.map(email => ({ email })),
          subject,
        }],
        from:     { email: fromEmail, name: 'Utah Pros Restoration' },
        reply_to: { email: fromEmail, name: 'Utah Pros Restoration' },
        content: [
          { type: 'text/plain', value: htmlToText(message) },
          { type: 'text/html',  value: message },
        ],
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text().catch(() => '');
      console.error('send-demo-sheet SendGrid error:', emailRes.status, errBody.slice(0, 500));
      return jsonResponse({
        ok: false,
        error: `SendGrid ${emailRes.status}`,
        sendgrid_status: emailRes.status,
        sendgrid_error: errBody.slice(0, 500),
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
