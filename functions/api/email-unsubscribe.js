/**
 * ════════════════════════════════════════════════
 * FILE: email-unsubscribe.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The page someone lands on when they click "Unsubscribe" at the bottom of
 *   a marketing email, or when their email app does a one-click unsubscribe
 *   for them. It records that they don't want marketing email anymore so no
 *   future campaign ever sends to that address again — no login needed,
 *   since the person clicking isn't a UPR employee.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — public Cloudflare Pages Function, not a React page
 *   Rendered by:  linked from the footer of every campaign email
 *                 (functions/lib/automated-send.js) and from the
 *                 List-Unsubscribe / List-Unsubscribe-Post email headers
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/supabase.js
 *   Data:      reads  → none directly (the RPC does its own lookup)
 *              writes → email_suppressions, email_campaign_recipients (both
 *                       via the email_unsubscribe RPC)
 *
 * NOTES / GOTCHAS:
 *   - No auth — this is a public link by design (RFC 8058 one-click
 *     unsubscribe requires an unauthenticated POST to succeed). Worst case
 *     of no signature is someone unsubscribing an email address they don't
 *     own, which only removes that address from marketing sends — not a
 *     security-sensitive action, so no HMAC/token scheme was added.
 *   - Accepts either `?rid=<email_campaign_recipients.id>` (from a campaign
 *     send footer — resolves the exact email + campaign) or a bare
 *     `?email=<address>` (from any other automated send).
 *   - Handles both GET (a human clicking the link) and POST (Gmail's
 *     List-Unsubscribe=One-Click, which POSTs to the same URL with no body).
 *   - Always returns a 200 HTML confirmation page even on an internal error,
 *     except when neither `rid` nor `email` was provided at all (400) —
 *     mirrors track-open.js's "don't block/bounce the requester" pattern.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';

function htmlResponse(message, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribe — Utah Pros Restoration</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333;">
<h2>Utah Pros Restoration</h2><p>${message}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

async function handle(request, env) {
  const url = new URL(request.url);
  const rid = url.searchParams.get('rid');
  const email = url.searchParams.get('email');

  if (!rid && !email) {
    return htmlResponse('This unsubscribe link is missing its recipient information.', 400);
  }

  const db = supabase(env);
  try {
    await db.rpc('email_unsubscribe', {
      p_email: email || null,
      p_recipient_id: rid || null,
    });
  } catch (err) {
    // Don't leak internals to a public, unauthenticated endpoint — log server-side only.
    console.error('email-unsubscribe error:', err);
  }

  return htmlResponse("You've been unsubscribed from Utah Pros Restoration marketing emails.");
}

export async function onRequestGet(context) {
  return handle(context.request, context.env);
}

// RFC 8058 one-click unsubscribe — Gmail/Outlook POST here with no body.
export async function onRequestPost(context) {
  return handle(context.request, context.env);
}
