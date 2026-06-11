// Shared transactional email sender — Resend (https://resend.com).
// Replaced SendGrid on Jun 11 2026: the SendGrid account ran out of credits
// (every send 401'd "Maximum credits exceeded" since mid-April 2026).
//
// Env: RESEND_API_KEY — Cloudflare Pages → Settings → Variables and Secrets.
// Optional: EMAIL_FROM / EMAIL_REPLY_TO to override the defaults below.
//
// sendEmail() never throws. It returns:
//   { ok: true,  id }              — Resend accepted the message
//   { ok: false, status, error }   — status 0 means missing key / network error

const DEFAULT_FROM     = 'Utah Pros Restoration <restoration@utah-pros.com>';
const DEFAULT_REPLY_TO = 'restoration@utah-pros.com';

// "Jane Doe <jane@example.com>" — Resend accepts named addresses as strings.
export function namedAddress(name, email) {
  const clean = String(name || '').replace(/[<>"]/g, '').trim();
  return clean ? `${clean} <${email}>` : email;
}

export async function sendEmail(env, { to, subject, html, text, from, replyTo, attachments }) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, status: 0, error: 'RESEND_API_KEY missing in Cloudflare Pages env vars' };
  }

  const payload = {
    from:     from || env.EMAIL_FROM || DEFAULT_FROM,
    to:       Array.isArray(to) ? to : [to],
    reply_to: replyTo || env.EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
    subject,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (attachments?.length) {
    payload.attachments = attachments.map(a => ({
      filename:     a.filename,
      content:      a.content,            // base64 string
      content_type: a.content_type || a.type,
    }));
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: errBody.slice(0, 500) };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || String(e) };
  }
}
