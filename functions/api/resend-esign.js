// POST /api/resend-esign
// Resends an existing pending sign request by email, by text, or both.
// Does NOT create a new sign request — reuses the same token and link.
// Resets email open tracking when an email actually goes out.
//
// Body: { sign_request_id, channels? }
//   channels — ['email'] | ['sms'] | ['sms','email'].  Defaults to ['email'],
//   which is exactly the pre-2026-08-08 behaviour, so callers that send only
//   { sign_request_id } are unaffected.
//
// The SMS path is deliberately an HTTP call to /api/send-message, mirroring
// send-esign.js: consent, DND, opt-out, provider selection, idempotency and the
// conversation row all live in that handler (AGENTS.md §14 — staff 1:1 sends go
// through it and nothing else). A direct Twilio call here would bypass the
// consent chokepoint AND leave the customer's thread with no record of the
// reminder. `signature_request` is already an approved
// TRANSACTIONAL_SERVICE_SMS_PURPOSES entry, so no consent exception is added.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireUser } from '../lib/auth.js';
import { sendEmail } from '../lib/email.js';
import { buildSigningUrl } from '../lib/short-link.js';

const VALID_CHANNELS = ['email', 'sms'];

/**
 * True when the row has no real address to email.
 *
 * NULL is the obvious case (3 of 58 rows). The one that bites is the second:
 * older clients invented `collect-<ts>@noemail.local` purely to satisfy a
 * not-null check when a link was texted rather than emailed, and 9 of 58 rows
 * still carry one. That is a non-null string, so a plain `!signer_email` guard
 * sails past it and hands Resend a bogus domain — bounces on a synthetic TLD
 * cost real sender reputation (EMAIL-DELIVERABILITY.md). TechJobDocuments.jsx
 * already treats the placeholder as absent when it renders the row; this is the
 * server-side twin of that judgement.
 */
function hasRealEmail(address) {
  const v = String(address || '').trim().toLowerCase();
  return Boolean(v) && !v.endsWith('@noemail.local');
}

/** Normalize the channels input to a deduped, validated list. Null = invalid. */
function parseChannels(raw) {
  if (raw === undefined || raw === null) return ['email'];      // frozen default
  const list = Array.isArray(raw) ? raw : [raw];
  const seen = [];
  for (const c of list) {
    const v = String(c || '').trim().toLowerCase();
    if (!VALID_CHANNELS.includes(v)) return null;
    if (!seen.includes(v)) seen.push(v);
  }
  return seen.length ? seen : null;
}

// Same rule as send-esign: APP_URL wins, otherwise derive from the host this
// request arrived on. A hardcoded dev fallback meant a missing Production
// APP_URL resent customers dev links without anything looking broken.
const getAppUrl = (env, request) => {
  if (env.APP_URL) return env.APP_URL;
  try { return new URL(request.url).origin; } catch { return 'https://utahpros.app'; }
};

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Pinned against the six other copies by
// tests/qa/unit/esign-doc-type-label-parity.test.js.
const DOC_LABELS = {
  coc:                     'Certificate of Completion',
  work_auth:               'Work Authorization',
  direction_pay:           'Direction of Pay',
  change_order:            'Change Order',
  recon_agreement:         'Reconstruction Agreement',
  cat3_removal:            'Emergency Removal Authorization',
  emergency_demo:          'Emergency Demolition Authorization',
  coverage_unconfirmed:    'Coverage Not Confirmed Acknowledgment',
  service_declined:        'Declination of Recommended Services',
  equipment_early_removal: 'Early Equipment Removal',
  access_release:          'Property Access Authorization',
  other:                   'Custom Authorization',
};

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Verify caller is authenticated
  const auth = await requireUser(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonResponse({ error: 'Supabase env vars missing' }, 500, request, env);
  }
  // NOT a hard precondition any more: an SMS-only resend needs no Resend key, and
  // failing the whole request on a missing email credential would refuse a text
  // this worker is perfectly able to send. Checked inside the email branch instead.

  const sbHeaders = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };

  try {
    const { sign_request_id, channels: rawChannels } = await request.json();
    if (!sign_request_id) return jsonResponse({ error: 'sign_request_id is required' }, 400, request, env);

    const channels = parseChannels(rawChannels);
    if (!channels) {
      return jsonResponse({ error: `channels must be a non-empty subset of ${VALID_CHANNELS.join(', ')}` }, 400, request, env);
    }

    // Fetch sign request + job in one query
    const srRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${sign_request_id}&select=*,job:jobs(id,job_number,insured_name,address,city,state)&limit=1`,
      { headers: sbHeaders }
    );
    if (!srRes.ok) throw new Error(`Failed to fetch sign request: ${await srRes.text()}`);
    const rows = await srRes.json();
    if (!rows?.length) return jsonResponse({ error: 'Sign request not found' }, 404, request, env);

    const sr = rows[0];

    if (sr.status === 'signed')    return jsonResponse({ error: 'Document already signed — cannot resend' }, 409, request, env);
    if (sr.status === 'cancelled') return jsonResponse({ error: 'Sign request is cancelled' }, 410, request, env);

    const job        = sr.job || {};
    const token      = sr.token;
    const APP_URL    = getAppUrl(env, request);
    const signingUrl = buildSigningUrl(APP_URL, token);
    const docLabel   = DOC_LABELS[sr.doc_type] || 'Document';
    const locationStr = [job.address, job.city, job.state].filter(Boolean).join(', ') || 'your property';

    const results = {};   // per-channel outcome, additive to the frozen { success } shape
    let emailSent = false;

    // ── Email ──
    if (channels.includes('email')) {
      // Guarded, not assumed: a link originally TEXTED to a contact with no email
      // leaves signer_email null, and sendEmail would previously have been handed
      // `to: { email: null }`. Refuse that channel by name instead.
      if (!env.RESEND_API_KEY) {
        results.email = { ok: false, reason: 'email_not_configured' };
      } else if (!hasRealEmail(sr.signer_email)) {
        results.email = { ok: false, reason: 'no_email_on_file' };
      } else {
        const emailRes = await sendEmail(env, {
          to:      { email: sr.signer_email, name: sr.signer_name },
          subject: `Reminder: Please sign your ${docLabel} – Job #${job.job_number || sign_request_id.slice(0, 8)}`,
          text:    buildEmailText({ signer_name: sr.signer_name, doc_label: docLabel, job_number: job.job_number, location_str: locationStr, signing_url: signingUrl }),
          html:    buildEmailHtml({ signer_name: sr.signer_name, doc_label: docLabel, job_number: job.job_number, location_str: locationStr, signing_url: signingUrl, token, appUrl: APP_URL }),
        });
        if (emailRes.ok) {
          emailSent = true;
          results.email = { ok: true };
        } else {
          console.error('resend-esign email error:', emailRes.error);
          results.email = { ok: false, reason: 'send_failed', status: emailRes.status, detail: emailRes.error };
        }
      }
    }

    // ── Text, through the staff send chokepoint ──
    if (channels.includes('sms')) {
      if (!sr.contact_id) {
        results.sms = { ok: false, reason: 'no_contact_on_request' };
      } else {
        const convRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_or_create_conversation`, {
          method: 'POST', headers: sbHeaders,
          body: JSON.stringify({ p_contact_id: sr.contact_id }),
        });
        const conversation = convRes.ok ? await convRes.json() : null;
        const conversationId = typeof conversation === 'string'
          ? conversation
          : (conversation?.id || conversation?.conversation_id || null);

        if (!conversationId) {
          results.sms = { ok: false, reason: 'no_conversation' };
        } else {
          const sendRes = await fetch(`${new URL(request.url).origin}/api/send-message`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: request.headers.get('Authorization'),
            },
            body: JSON.stringify({
              conversation_id: conversationId,
              body: `Reminder — your ${docLabel} is ready to sign: ${signingUrl}`,
              sent_by: sr.sent_by,
            }),
          });
          let sendJson = null;
          try { sendJson = await sendRes.json(); } catch { /* non-JSON handled below */ }

          // send-message answers 201 even when the PROVIDER rejects: the failure
          // rides inside the body as error_code/error_message, or as `error` on a
          // per-recipient twilio entry. Checking only sendRes.ok reported a text
          // that never left — the same defect send-esign.js already had to fix.
          const providerRejected = Boolean(
            sendJson?.error_code
            || sendJson?.error_message
            || (Array.isArray(sendJson?.twilio) && sendJson.twilio.some((r) => r && r.error)),
          );
          results.sms = (!sendRes.ok || providerRejected)
            ? {
                ok: false,
                reason: sendJson?.code || 'send_failed',
                detail: sendJson?.error_message || sendJson?.error || null,
              }
            : { ok: true, conversation_id: conversationId };
        }
      }
    }

    const anyDelivered = Object.values(results).some((r) => r.ok);

    // ── Update sign request: bump sent_at; reset open tracking only if an email went ──
    if (anyDelivered) {
      const now = new Date().toISOString();
      const patch = { sent_at: now, updated_at: now };
      if (emailSent) { patch.email_opened_at = null; patch.email_open_count = 0; }
      await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${sign_request_id}`, {
        method: 'PATCH', headers: sbHeaders, body: JSON.stringify(patch),
      });
    }

    // `success` stays true whenever the request itself was handled, preserving the
    // frozen contract both callers check; per-channel truth lives in `results`.
    return jsonResponse({
      success: true,
      delivered: anyDelivered,
      channels,
      results,
      signing_url: signingUrl,
      // Back-compat: the pre-2026-08-08 shape callers still read on an email failure.
      ...(results.email && !results.email.ok
        ? { email_error: true, email_status: results.email.status, email_error_detail: results.email.detail }
        : {}),
    }, 200, request, env);

  } catch (err) {
    console.error('resend-esign error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

function buildEmailHtml({ signer_name, doc_label, job_number, location_str, signing_url, token, appUrl }) {
  const first = escHtml(signer_name.split(' ')[0]);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#1e293b;padding:28px 32px;text-align:center;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">Utah Pros Restoration</p>
          <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Licensed &amp; Insured · Utah</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;display:inline-block;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;">Reminder</p>
          <p style="margin:12px 0 16px;font-size:16px;color:#0f172a;">Hi ${first},</p>
          <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
            We're following up — your signature is still needed on the <strong>${doc_label}</strong>${job_number ? ` (Job #${job_number})` : ''}
            for the work at <strong>${location_str}</strong>.
          </p>
          <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
            It takes less than a minute — review the document, type your name, and sign with your finger or mouse.
          </p>
          <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
            <a href="${signing_url}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">
              Review &amp; Sign Document →
            </a>
          </td></tr></table>
          <p style="margin:28px 0 4px;font-size:12px;color:#94a3b8;text-align:center;">Or copy this link:</p>
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;">${signing_url}</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
            Questions? Reply to this email or call <strong>(801) 427-0582</strong>.<br>This link expires in 30 days.
          </p>
        </td></tr>
      </table>
      <img src="${appUrl}/api/track-open?t=${token}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" alt="" />
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailText({ signer_name, doc_label, job_number, location_str, signing_url }) {
  const first = escHtml(signer_name.split(' ')[0]);
  return `Hi ${first},\n\nReminder — your signature is still needed on the ${doc_label}${job_number ? ` (Job #${job_number})` : ''} for the work at ${location_str}:\n\n${signing_url}\n\nIt takes less than a minute. The link expires in 30 days.\n\nQuestions? Email restoration@utah-pros.com\n\n— Utah Pros Restoration`;
}
