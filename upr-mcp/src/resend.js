// Resend API layer for the MCP worker.
// Lets the assistant TEST + TROUBLESHOOT (and, if ever needed, fully drive) UPR's
// transactional email from chat: the esign link, signed-doc confirmation,
// scope/demo sheet, water-loss report, and billing 2FA all send through Resend
// (see functions/lib/email.js). Auth reuses the SAME token the Pages functions
// use: Bearer RESEND_API_KEY (set as an MCP worker secret). Base:
// https://api.resend.com — see EMAIL-DELIVERABILITY.md.
//
// Design: a generic core (resendGet / resendRequest) makes the MCP capable of
// any Resend endpoint (emails, domains, api-keys, audiences, broadcasts, ...);
// the named exports below are documented conveniences over the email + domain
// endpoints UPR actually cares about.

const BASE = 'https://api.resend.com';
// Mirror functions/lib/email.js: From is a verified utahpros.app sender, and
// Reply-To stays on the SAME domain (a From/Reply-To domain mismatch trips
// Gmail's spoof warning). Override per-call or via EMAIL_FROM / EMAIL_REPLY_TO.
const DEFAULT_FROM = 'Utah Pros Restoration <restoration@utahpros.app>';
const DEFAULT_REPLY_TO = 'restoration@utahpros.app';

// Core fetch. `path` begins with '/'. Handles 204 (→ null) and non-JSON bodies.
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
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.name)) || (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    throw new Error(`Resend ${options.method || 'GET'} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

// ─── Generic power tools (reach any endpoint) ────────────────────────────────
export async function resendGet(env, path) {
  return resendFetch(env, path.startsWith('/') ? path : `/${path}`);
}
export async function resendRequest(env, method, path, body) {
  return resendFetch(env, path.startsWith('/') ? path : `/${path}`, {
    method: String(method || 'POST').toUpperCase(),
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
}

// ─── Emails ──────────────────────────────────────────────────────────────────
// POST /emails — send one email through the same provider the app uses.
export async function resendSend(env, { to, subject, html, text, from, replyTo, cc, bcc, attachments } = {}) {
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
  if (cc) payload.cc = Array.isArray(cc) ? cc : [cc];
  if (bcc) payload.bcc = Array.isArray(bcc) ? bcc : [bcc];
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content,                              // base64 string
      content_type: a.contentType || a.content_type,  // optional
    }));
  }
  return resendFetch(env, '/emails', { method: 'POST', body: JSON.stringify(payload) });
}

// GET /emails/{id} — delivery status of one sent email. `last_event` is the
// lifecycle state: sent / delivered / delivery_delayed / bounced / complained.
export async function resendGetEmail(env, id) {
  return resendFetch(env, `/emails/${encodeURIComponent(String(id))}`);
}

// ─── Domains (deliverability) ────────────────────────────────────────────────
// GET /domains — sending domains + verification status (DKIM/SPF/DMARC).
export async function resendListDomains(env) {
  const data = await resendFetch(env, '/domains');
  return Array.isArray(data) ? data : (data.data || data.domains || []);
}
// GET /domains/{id} — one domain with its full DNS record set + statuses.
export async function resendGetDomain(env, id) {
  return resendFetch(env, `/domains/${encodeURIComponent(String(id))}`);
}
// POST /domains/{id}/verify — (re)trigger verification for a domain.
export async function resendVerifyDomain(env, id) {
  return resendFetch(env, `/domains/${encodeURIComponent(String(id))}/verify`, { method: 'POST' });
}
