// POST /api/resend-esign
// Resends the signing email for an existing pending sign request.
// Does NOT create a new sign request — reuses the same token and link.
// Resets email open tracking so the new send gets fresh open data.
//
// Body: { sign_request_id }

import { handleOptions, jsonResponse } from '../lib/cors.js';

const APP_URL = 'https://dev.utahpros.app';

const DOC_LABELS = {
  coc:           'Certificate of Completion',
  work_auth:     'Work Authorization',
  direction_pay: 'Direction of Pay',
  change_order:  'Change Order',
};

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonResponse({ error: 'Supabase env vars missing' }, 500, request, env);
  }
  if (!env.SENDGRID_API_KEY) {
    return jsonResponse({ error: 'SENDGRID_API_KEY missing' }, 500, request, env);
  }

  const sbHeaders = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
  };

  try {
    const { sign_request_id } = await request.json();
    if (!sign_request_id) return jsonResponse({ error: 'sign_request_id is required' }, 400, request, env);

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
    const signingUrl = `${APP_URL}/sign/${token}`;
    const docLabel   = DOC_LABELS[sr.doc_type] || 'Document';
    const locationStr = [job.address, job.city, job.state].filter(Boolean).join(', ') || 'your property';

    // ── Send email ──
    const emailRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: sr.signer_email, name: sr.signer_name }],
          subject: `Reminder: Please sign your ${docLabel} – Job #${job.job_number || sign_request_id.slice(0, 8)}`,
        }],
        from:     { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
        reply_to: { email: 'restoration@utah-pros.com', name: 'Utah Pros Restoration' },
        content: [
          { type: 'text/plain', value: buildEmailText({ signer_name: sr.signer_name, doc_label: docLabel, job_number: job.job_number, location_str: locationStr, signing_url: signingUrl }) },
          { type: 'text/html',  value: buildEmailHtml({ signer_name: sr.signer_name, doc_label: docLabel, job_number: job.job_number, location_str: locationStr, signing_url: signingUrl, token }) },
        ],
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error('SendGrid resend error:', errBody);
      return jsonResponse({
        success:         true,
        email_error:     true,
        sendgrid_status: emailRes.status,
        sendgrid_error:  errBody,
        signing_url:     signingUrl,
      }, 200, request, env);
    }

    // ── Update sign request: bump sent_at, reset open tracking ──
    const now = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/sign_requests?id=eq.${sign_request_id}`, {
      method:  'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({
        sent_at:          now,
        email_opened_at:  null,
        email_open_count: 0,
        updated_at:       now,
      }),
    });

    return jsonResponse({ success: true, signing_url: signingUrl }, 200, request, env);

  } catch (err) {
    console.error('resend-esign error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

function buildEmailHtml({ signer_name, doc_label, job_number, location_str, signing_url, token }) {
  const first = signer_name.split(' ')[0];
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
      <img src="https://dev.utahpros.app/api/track-open?t=${token}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;" alt="" />
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailText({ signer_name, doc_label, job_number, location_str, signing_url }) {
  const first = signer_name.split(' ')[0];
  return `Hi ${first},\n\nReminder — your signature is still needed on the ${doc_label}${job_number ? ` (Job #${job_number})` : ''} for the work at ${location_str}:\n\n${signing_url}\n\nIt takes less than a minute. The link expires in 30 days.\n\nQuestions? Email restoration@utah-pros.com\n\n— Utah Pros Restoration`;
}
