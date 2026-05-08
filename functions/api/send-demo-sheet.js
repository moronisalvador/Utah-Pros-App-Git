// POST /api/send-demo-sheet  body: { subject, message }
// Sends the rendered demo-sheet HTML email via SendGrid.
// FROM_EMAIL / TO_EMAILS optionally overridable via Cloudflare env.

import { handleOptions, jsonResponse } from '../lib/cors.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const sgKey = env.SENDGRID_API_KEY;
  if (!sgKey) {
    return jsonResponse({ error: 'SENDGRID_API_KEY not configured' }, 500, request, env);
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
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sgKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: toList.map(email => ({ email })) }],
        from: { email: fromEmail, name: 'Utah Pros Restoration' },
        subject,
        content: [{ type: 'text/html', value: message }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.log('send-demo-sheet sendgrid non-2xx', res.status, errText.slice(0, 300));
      return jsonResponse(
        { error: `SendGrid ${res.status}`, detail: errText.slice(0, 300) },
        502, request, env,
      );
    }

    return jsonResponse({ ok: true }, 200, request, env);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Network error' }, 500, request, env);
  }
}
