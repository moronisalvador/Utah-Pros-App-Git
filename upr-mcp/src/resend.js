// Resend API layer for the MCP worker.
// Lets the assistant TEST + TROUBLESHOOT UPR's transactional email from chat:
// the esign link, signed-doc confirmation, scope/demo sheet, water-loss report,
// and billing 2FA all send through Resend (see functions/lib/email.js). These
// tools hit the same Resend REST API so you can ask "did this email send / did
// it bounce / is our DKIM still valid?" without leaving the conversation.
// Auth reuses the SAME token the Pages functions use: Bearer RESEND_API_KEY (set
// as an MCP worker secret). Base: https://api.resend.com — see EMAIL-DELIVERABILITY.md.

const BASE = 'https://api.resend.com';
// Mirror functions/lib/email.js: From is a verified utahpros.app sender, and
// Reply-To stays on the SAME domain (a From/Reply-To domain mismatch trips
// Gmail's spoof warning). Override per-call or via EMAIL_FROM / EMAIL_REPLY_TO.
const DEFAULT_FROM = 'Utah Pros Restoration <restoration@utahpros.app>';
const DEFAULT_REPLY_TO = 'restoration@utahpros.app';

async function resendFetch(env, path, options = {}) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured for the MCP worker — add it as a secret (wrangler secret put RESEND_API_KEY).');
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data).slice(0, 300);
    throw new Error(`Resend ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

// POST /emails — send one email through the same provider the app uses.
export async function resendSend(env, { to, subject, html, text, from, replyTo } = {}) {
  const toList = Array.isArray(to) ? to : [to];
  const payload = {
    from: from || env.EMAIL_FROM || DEFAULT_FROM,
    to: toList,
    subject: subject || '',
    reply_to: replyTo || env.EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (!html && !text) payload.text = 'Test email from the UPR MCP.';
  return resendFetch(env, '/emails', { method: 'POST', body: JSON.stringify(payload) });
}

// GET /emails/{id} — delivery status of one sent email. `last_event` is the
// lifecycle state: sent / delivered / delivery_delayed / bounced / complained.
export async function resendGetEmail(env, id) {
  return resendFetch(env, `/emails/${encodeURIComponent(String(id))}`);
}

// GET /domains — sending domains with their verification + DKIM/SPF/DMARC status.
// The first stop when troubleshooting deliverability.
export async function resendListDomains(env) {
  const data = await resendFetch(env, '/domains');
  return Array.isArray(data) ? data : (data.data || data.domains || []);
}
