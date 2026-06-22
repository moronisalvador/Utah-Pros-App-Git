// POST /api/billing-2fa — email-2FA gate for the Stripe payout destinations
// (deposit bank + instant-payout debit card). These control where our money lands, so
// they are NOT a plain click-and-edit field: a change requires a one-time code emailed
// to the owner, verified here before the service role writes the protected settings.
//
// The four payout keys are NOT in the open set_billing_setting whitelist — this worker
// is the only writer. Auth: Supabase Bearer + admin/manager role. Codes are single-use,
// 10-minute, SHA-256-hashed in billing_2fa_codes.
//
// Body:
//   { "action": "request" }                         — generate + email a code
//   { "action": "commit", "code": "123456",
//     "changes": { stripe_payout_bank_name, stripe_payout_bank_id,
//                  stripe_instant_card_name, stripe_instant_card_id } }

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

const PROTECTED_KEYS = ['stripe_payout_bank_id', 'stripe_payout_bank_name', 'stripe_instant_card_id', 'stripe_instant_card_name'];
const CODE_TTL_MIN = 10;

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function sixDigit() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}
function maskEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return e;
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

// Logged-in admin/manager only (the emailed code is the real gate; this is defense-in-depth).
async function getActor(request, env, db) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (!user?.id) return null;
  const emp = (await db.select('employees', `auth_user_id=eq.${user.id}&select=id,role,email&limit=1`))?.[0];
  if (!emp || !['admin', 'manager'].includes(emp.role)) return null;
  return emp;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const actor = await getActor(request, env, db);
  if (!actor) return jsonResponse({ ok: false, error: 'Unauthorized — admins/managers only' }, 401, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  // ── Request a code ──
  if (body.action === 'request') {
    if (!env.SENDGRID_API_KEY) {
      return jsonResponse({ ok: false, error: 'Email is not configured (SENDGRID_API_KEY missing) — cannot send a verification code.' }, 503, request, env);
    }
    const cfg = (await db.select('integration_config', `key=eq.billing_2fa_email&select=value&limit=1`))?.[0];
    const to = cfg?.value || 'moroni.s@utah-pros.com';

    const code = sixDigit();
    await db.insert('billing_2fa_codes', {
      purpose: 'payout_destination', code_hash: await sha256hex(code),
      requested_by: actor.id, expires_at: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000).toISOString(),
    });

    const fromEmail = env.DEMO_SHEET_FROM_EMAIL || 'restoration@utah-pros.com';
    const html = `<p>Someone is changing the <b>Stripe payout destination</b> (deposit bank / instant-payout debit card) in UPR.</p>
      <p style="font-size:26px;font-weight:800;letter-spacing:4px;margin:14px 0">${code}</p>
      <p>Enter this code in <b>Payment Settings</b> to confirm. It expires in ${CODE_TTL_MIN} minutes. If this wasn't you, ignore this email — nothing changes without the code.</p>
      <p style="color:#888;font-size:12px">Requested by ${actor.email || actor.id}</p>`;
    const emailRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }], subject: 'UPR — payout settings verification code' }],
        from: { email: fromEmail, name: 'Utah Pros Restoration' },
        reply_to: { email: fromEmail, name: 'Utah Pros Restoration' },
        content: [
          { type: 'text/plain', value: `UPR payout-settings verification code: ${code} (expires in ${CODE_TTL_MIN} min). If this wasn't you, ignore it.` },
          { type: 'text/html', value: html },
        ],
      }),
    });
    if (!emailRes.ok) {
      const errBody = await emailRes.text().catch(() => '');
      return jsonResponse({ ok: false, error: `Email send failed (SendGrid ${emailRes.status}) — verification code not delivered.`, sendgrid_status: emailRes.status, sendgrid_error: errBody.slice(0, 300) }, 200, request, env);
    }
    return jsonResponse({ ok: true, sent: true, to: maskEmail(to), expires_in_min: CODE_TTL_MIN }, 200, request, env);
  }

  // ── Commit a change with a valid code ──
  if (body.action === 'commit') {
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return jsonResponse({ ok: false, error: 'Enter the 6-digit code from the email.' }, 400, request, env);

    const changes = body.changes || {};
    const keys = Object.keys(changes).filter(k => PROTECTED_KEYS.includes(k));
    if (!keys.length) return jsonResponse({ ok: false, error: 'No payout-destination changes provided.' }, 400, request, env);

    const codeHash = await sha256hex(code);
    const row = (await db.select('billing_2fa_codes', `code_hash=eq.${codeHash}&purpose=eq.payout_destination&used_at=is.null&select=id,expires_at&limit=1`))?.[0];
    if (!row) return jsonResponse({ ok: false, error: 'Invalid code.' }, 400, request, env);
    if (new Date(row.expires_at).getTime() < Date.now()) return jsonResponse({ ok: false, error: 'Code expired — request a new one.' }, 400, request, env);

    await db.update('billing_2fa_codes', `id=eq.${row.id}`, { used_at: new Date().toISOString() }); // single-use
    const now = new Date().toISOString();
    for (const k of keys) {
      await db.upsert('integration_config', { key: k, value: String(changes[k] ?? ''), updated_at: now });
    }
    return jsonResponse({ ok: true, updated: keys }, 200, request, env);
  }

  return jsonResponse({ ok: false, error: 'Unknown action' }, 400, request, env);
}
