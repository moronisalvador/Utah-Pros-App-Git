/**
 * ════════════════════════════════════════════════
 * FILE: send-email-campaign.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Send" button on an email campaign hits this. It snapshots exactly
 *   who the campaign should go to, then emails each of them one at a time —
 *   but only after checking that each person hasn't unsubscribed or asked
 *   not to be contacted. Anyone who's blocked gets skipped, not emailed
 *   anyway, and every attempt (sent, skipped, or failed) is recorded on the
 *   campaign so the Marketing page can show real counts.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/send-email-campaign
 *   Rendered by:  src/pages/crm/CrmCampaigns.jsx ("Send now" on a draft campaign)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/supabase.js, functions/lib/automated-send.js
 *              (sendGatedEmail — the ONLY path this file uses to actually
 *              email someone; the suppression/consent gate lives inside it)
 *   Data:      reads  → email_campaigns, contacts (via queue_email_campaign /
 *                       preview_email_audience RPCs)
 *              writes → email_campaign_recipients, email_campaigns (via
 *                       queue_email_campaign / record_email_campaign_send
 *                       RPCs), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - Authenticated (Supabase session bearer token, verified against the
 *     anon-key-scoped /auth/v1/user endpoint — same reasoning as
 *     send-message.js's requireAuth for SMS: sending real marketing email
 *     costs money and reputation).
 *   - Runs the recipient loop synchronously in the request — acceptable at
 *     this phase's expected volume (disposable test rows only; no real
 *     campaign has been sent from this build). A campaign large enough to
 *     risk the Cloudflare Pages Function execution-time limit would need a
 *     batched/queued redesign — disclosed here rather than silently capped.
 *   - Never calls functions/lib/email.js directly — always through
 *     sendGatedEmail() so the suppression check can't be skipped.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { sendGatedEmail, renderTemplate } from '../lib/automated-send.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

const WORKER_NAME = 'send-email-campaign';

// Verifies the caller's Supabase session — the anon key is sufficient for
// /auth/v1/user (it just needs *a* valid apikey, not elevated privileges).
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { 'apikey': apiKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const auth = await requireAuth(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let campaignId;
  try {
    ({ campaign_id: campaignId } = await request.json());
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env);
  }
  if (!campaignId) return jsonResponse({ error: 'campaign_id is required' }, 400, request, env);

  let sent = 0, suppressed = 0, failed = 0;
  try {
    const [campaign] = await db.select('email_campaigns', `id=eq.${campaignId}`);
    if (!campaign) return jsonResponse({ error: 'Campaign not found' }, 404, request, env);
    if (!['draft', 'sending'].includes(campaign.status)) {
      return jsonResponse({ error: `Campaign is already ${campaign.status}` }, 409, request, env);
    }

    await db.rpc('queue_email_campaign', { p_campaign_id: campaignId });

    const recipients = await db.select(
      'email_campaign_recipients',
      `campaign_id=eq.${campaignId}&status=eq.pending&select=id,contact_id,email`
    );

    for (const recipient of recipients) {
      let result;
      try {
        // Re-fetch the live contact row rather than trusting the queue-time
        // snapshot — a name for {{name}} substitution, and a fresh `dnd`
        // check in case it changed between queueing and this send (a large
        // campaign can take a while; preview_email_audience only guaranteed
        // NOT dnd at snapshot time).
        const [contact] = await db.select('contacts', `id=eq.${recipient.contact_id}&select=id,name,email,dnd`);
        result = await sendGatedEmail(env, {
          contact: contact || { id: recipient.contact_id, email: recipient.email },
          subject: campaign.subject,
          html: renderTemplate(campaign.body_html, { name: contact?.name || recipient.email }),
          recipientId: recipient.id,
        });
      } catch (e) {
        result = { ok: false, skipped: false, error: String(e.message || e) };
      }

      const status = result.skipped ? 'suppressed' : result.ok ? 'sent' : 'failed';
      if (status === 'sent') sent++;
      else if (status === 'suppressed') suppressed++;
      else failed++;

      await db.rpc('record_email_campaign_send', {
        p_recipient_id: recipient.id,
        p_status: status,
        p_resend_id: result.resendId || null,
        p_error_message: result.error || (result.skipped ? result.reason : null),
      }).catch(e => console.error('record_email_campaign_send failed:', e.message));
    }

    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'completed',
      records_processed: recipients.length,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });

    return jsonResponse({ success: true, sent, suppressed, failed, total: recipients.length }, 200, request, env);
  } catch (err) {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'error',
      records_processed: sent + suppressed + failed,
      error_message: String(err.message || err).slice(0, 500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    }).catch(() => {});
    console.error('send-email-campaign error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}
