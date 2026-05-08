// POST /api/send-demo-sheet  body: { subject, message }
// Sends the rendered demo-sheet HTML email via SendGrid.
// Mirrors the payload shape of send-esign.js / resend-esign.js exactly so it
// goes through the same proven path.

import { handleOptions, jsonResponse } from '../lib/cors.js';

// Strip HTML tags + collapse whitespace so we always have a plain-text part.
// SendGrid prefers (and some downstreams require) text/plain alongside text/html.
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

  if (!env.SENDGRID_API_KEY) {
    return jsonResponse({ error: 'SENDGRID_API_KEY missing in Cloudflare Pages env vars' }, 500, request, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }

  const { subject, message } = body || {};
  if (!subject || !message) {
    return jsonResponse({ error: 'subject and message required' }, 400, request, env);
  }

  const fromEmail = env.DEMO_SHEET_FROM_EMAIL || 'restoration@utah-pros.com';
  const toList = (env.DEMO_SHEET_TO_EMAILS || 'moroni.s@utah-pros.com,restoration@utah-pros.com')
    .split(',').map(s => s.trim()).filter(Boolean);

  try {
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
      const errBody = await emailRes.text();
      console.error('send-demo-sheet SendGrid error:', emailRes.status, errBody.slice(0, 500));
      return jsonResponse(
        { error: `SendGrid ${emailRes.status}`, detail: errBody.slice(0, 500) },
        502, request, env,
      );
    }

    return jsonResponse({ ok: true }, 200, request, env);
  } catch (err) {
    console.error('send-demo-sheet error:', err);
    return jsonResponse({ error: err.message || 'Network error' }, 500, request, env);
  }
}
