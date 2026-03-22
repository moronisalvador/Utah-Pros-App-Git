// POST /api/send-esign
// Creates a sign request and emails the client a signing link.
//
// Request body:
// {
//   job_id:        uuid,
//   contact_id:    uuid,
//   signer_name:   string,
//   signer_email:  string,
//   sent_by:       uuid  (employee id),
//   doc_type?:     string  (default: 'coc')
// }

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

const APP_URL = 'https://dev.utahpros.app';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  try {
    const {
      job_id,
      contact_id,
      signer_name,
      signer_email,
      sent_by,
      doc_type = 'coc',
    } = await request.json();

    // ── Validate required fields ──
    if (!job_id)       return jsonResponse({ error: 'job_id is required' },       400, request, env);
    if (!signer_name)  return jsonResponse({ error: 'signer_name is required' },  400, request, env);
    if (!signer_email) return jsonResponse({ error: 'signer_email is required' }, 400, request, env);
    if (!sent_by)      return jsonResponse({ error: 'sent_by is required' },      400, request, env);

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(signer_email)) {
      return jsonResponse({ error: 'Invalid email address' }, 400, request, env);
    }

    // ── Verify job exists ──
    const jobs = await db.select('jobs', `id=eq.${job_id}&select=id,job_number,insured_name,address,city,state`);
    if (!jobs || jobs.length === 0) {
      return jsonResponse({ error: 'Job not found' }, 404, request, env);
    }
    const job = jobs[0];

    // ── Create sign request via RPC ──
    const signReq = await db.rpc('create_sign_request', {
      p_job_id:       job_id,
      p_contact_id:   contact_id || null,
      p_doc_type:     doc_type,
      p_signer_name:  signer_name,
      p_signer_email: signer_email,
      p_sent_by:      sent_by,
    });

    if (!signReq || signReq.error) {
      throw new Error(signReq?.error || 'Failed to create sign request');
    }

    const { token, id: sign_request_id } = signReq;
    const signingUrl = `${APP_URL}/sign/${token}`;
    const docLabel   = DOC_LABELS[doc_type] || 'Document';
    const locationStr = [job.address, job.city, job.state].filter(Boolean).join(', ') || 'your property';

    // ── Send email via SendGrid ──
    const emailRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from: {
          email: 'noreply@utah-pros.com',
          name:  'Utah Pros Restoration',
        },
        reply_to: {
          email: 'restoration@utah-pros.com',
          name:  'Utah Pros Restoration',
        },
        to: [{ email: signer_email, name: signer_name }],
        subject: `Please sign: ${docLabel} – Job #${job.job_number || job_id.slice(0, 8)}`,
        content: [
          {
            type:  'text/html',
            value: buildEmailHtml({
              signer_name,
              doc_label:    docLabel,
              job_number:   job.job_number,
              location_str: locationStr,
              signing_url:  signingUrl,
            }),
          },
          {
            type:  'text/plain',
            value: buildEmailText({
              signer_name,
              doc_label:    docLabel,
              job_number:   job.job_number,
              location_str: locationStr,
              signing_url:  signingUrl,
            }),
          },
        ],
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error('SendGrid error:', errBody);
      // Sign request was created — don't fail silently, but return partial success
      return jsonResponse({
        success:         false,
        email_error:     true,
        sign_request_id,
        token,
        message:         'Sign request created but email failed. Copy the signing link manually.',
        signing_url:     signingUrl,
      }, 500, request, env);
    }

    return jsonResponse({
      success:         true,
      sign_request_id,
      token,
      signing_url:     signingUrl,
    }, 200, request, env);

  } catch (err) {
    console.error('send-esign error:', err);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500, request, env);
  }
}

// ── Doc type labels ──
const DOC_LABELS = {
  coc:            'Certificate of Completion',
  work_auth:      'Work Authorization',
  direction_pay:  'Direction of Pay',
  change_order:   'Change Order',
};

// ── Email HTML ──
function buildEmailHtml({ signer_name, doc_label, job_number, location_str, signing_url }) {
  const first = signer_name.split(' ')[0];
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1e293b;padding:28px 32px;text-align:center;">
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Utah Pros Restoration</p>
            <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Licensed &amp; Insured · Utah</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Hi ${first},</p>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.6;">
              The work at <strong>${location_str}</strong> is complete. We just need your signature on the
              <strong>${doc_label}</strong>${job_number ? ` (Job #${job_number})` : ''} to wrap things up.
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.6;">
              It takes less than a minute — just review the document, type your name, and sign with your finger or mouse.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center">
                  <a href="${signing_url}"
                     style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;
                            text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.1px;">
                    Review &amp; Sign Document →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:28px 0 8px;font-size:12px;color:#94a3b8;text-align:center;">
              Or copy this link into your browser:
            </p>
            <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;word-break:break-all;">
              ${signing_url}
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
              Questions? Reply to this email or call us at <strong>(385) 384-4135</strong>.<br>
              This signing link expires in 30 days.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Plain text fallback ──
function buildEmailText({ signer_name, doc_label, job_number, location_str, signing_url }) {
  const first = signer_name.split(' ')[0];
  return `Hi ${first},

The work at ${location_str} is complete. Please review and sign the ${doc_label}${job_number ? ` (Job #${job_number})` : ''} at the link below:

${signing_url}

It takes less than a minute. The link expires in 30 days.

Questions? Email restoration@utah-pros.com or reply to this message.

— Utah Pros Restoration`;
}
