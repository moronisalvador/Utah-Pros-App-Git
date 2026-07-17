/**
 * ════════════════════════════════════════════════
 * FILE: form-submit.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The public endpoint that receives a filled-out embeddable lead form. It is
 *   the guard on the front door: it checks the submission isn't spam (a hidden
 *   honeypot field, an impossibly fast fill, too many tries from one address,
 *   and optionally a Cloudflare Turnstile check), makes sure every required
 *   field is present and well-typed, and only then hands the data to the
 *   database function that turns it into a lead (and, if the person ticked the
 *   consent box, a real text-message opt-in). Anyone on the internet can POST
 *   here, so nothing is trusted — the published form schema in the database is
 *   the source of truth, not the request body.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/form-submit  (Cloudflare Pages Function)
 *   Rendered by:  n/a — called by the hosted form page functions/f/[public_id].js
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/supabase.js (service-role client),
 *              functions/lib/forms.js (validateSubmission, checkSpam,
 *              consentValue, sanitizeLinkMarkup, escapeHtml),
 *              functions/api/notify.js (dispatchEvent — lead.new alert)
 *   Data:      reads  → form_definitions, form_definition_versions,
 *                       form_submissions (per-IP rate check)
 *              writes → inbound_leads, contacts, form_submissions,
 *                       lead_attribution, sms_consent_log, system_events
 *                       (all via the upsert_lead_from_form RPC), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 10 (.claude/rules/crm-wave-ownership.md).
 *   - Permissive CORS ("*") ON PURPOSE — a form embedded on any customer site
 *     may POST here. There are no cookies/credentials; the write goes through a
 *     SECURITY DEFINER RPC, so "*" is safe here (unlike the allow-listed
 *     cors.js used by authenticated staff endpoints).
 *   - Spam-dropped submissions return 200 {ok:true} so a bot cannot tell it was
 *     filtered. Real validation failures return 400 with per-field errors.
 *   - Turnstile is per-form (form.turnstile_enabled). The secret key lives in the
 *     integration_config table (key 'turnstile_secret_key'), read via the
 *     service-role client — that table is RLS-locked so anon/authenticated can
 *     never read it. env.TURNSTILE_SECRET_KEY is a fallback. If neither is set,
 *     the check is skipped so forms keep working before a key exists.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { validateSubmission, checkSpam, consentValue, sanitizeLinkMarkup, pickConfiguredKey, escapeHtml } from '../lib/forms.js';
import { dispatchEvent } from './notify.js';

// ─── SECTION: lead.new notification content builder ───

// Field types we never surface in the alert: the consent tick is legal bookkeeping,
// not lead info, and the honeypot is a spam trap that should always be empty.
const NOTIFY_SKIP_TYPES = new Set(['consent']);
const NOTIFY_SKIP_KEYS = new Set(['hp', 'honeypot']);
// Keep the plain-text (bell/push) body legible — long free-text answers are
// truncated there; the HTML email keeps the full value.
const PLAIN_VALUE_MAX = 140;

// Turn a submitted value (string, array of chosen options, or empty) into one
// display string. Arrays (multi-select checkboxes) join with commas; blanks drop.
function displayValue(raw) {
  if (Array.isArray(raw)) {
    return raw.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean).join(', ');
  }
  return raw == null ? '' : String(raw).trim();
}

/**
 * Flatten a form submission into ordered { key, label, value } rows for the
 * notification — schema order first (so the alert reads like the form), skipping
 * consent/honeypot and any empty answer. Falls back to the raw data keys when a
 * schema is unavailable, so an alert is never blank.
 */
export function leadNotificationRows(schema, data) {
  const fields = (schema && Array.isArray(schema.fields)) ? schema.fields : [];
  const d = data && typeof data === 'object' ? data : {};
  const rows = [];
  const seen = new Set();

  for (const f of fields) {
    if (!f || !f.key) continue;
    if (NOTIFY_SKIP_TYPES.has(f.type) || NOTIFY_SKIP_KEYS.has(f.key)) {
      seen.add(f.key); // schema-defined but intentionally omitted — don't let the raw fallback re-add it
      continue;
    }
    const value = displayValue(d[f.key]);
    if (!value) continue;
    rows.push({ key: f.key, label: (f.label && String(f.label).trim()) || f.key, value });
    seen.add(f.key);
  }
  // Any submitted keys the schema didn't describe (defensive — schema is source
  // of truth, but never silently drop data the admin might need).
  for (const [k, v] of Object.entries(d)) {
    if (seen.has(k) || NOTIFY_SKIP_KEYS.has(k)) continue;
    const value = displayValue(v);
    if (!value) continue;
    rows.push({ key: k, label: k, value });
  }
  return rows;
}

// The lead's name for the title/subject, if the form captured one (a field whose
// key or label mentions "name"). Cosmetic — falls back to a generic title.
function pickLeadName(rows) {
  const match = rows.find((r) => /name/i.test(r.key) || /name/i.test(r.label));
  return match ? match.value : '';
}

function truncate(s, max) {
  const str = String(s);
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}

/**
 * Build the notification content for a web-form lead across all three channels:
 * a title (push title / email subject / bell title), a plain-text body (bell +
 * push — every field, long answers truncated), and branded HTML (email — the
 * full submission in a UPR-styled card). Every submitted value is HTML-escaped
 * for the email: form data is untrusted public input.
 */
export function buildLeadNotificationContent({ schema, data, formName, env, leadId } = {}) {
  const rows = leadNotificationRows(schema, data);
  const name = pickLeadName(rows);
  const form = formName && String(formName).trim();

  const title = name ? `New lead · ${name}` : 'New lead';

  // Plain text — bell + OS push. One "Label: value" per line, values truncated.
  let body;
  if (rows.length) {
    body = rows.map((r) => `${r.label}: ${truncate(r.value, PLAIN_VALUE_MAX)}`).join('\n');
    if (form) body += `\n— ${form}`;
  } else {
    // No parsed fields (e.g. schema-less) — keep the old, always-useful line.
    body = `Web form submission${form ? ` · ${form}` : ''}.`;
  }

  const html = buildLeadEmailHtml({ rows, name, form, env, leadId });
  return { title, body, html };
}

// Branded HTML card for the email channel — mirrors the UPR design tokens
// (#1e293b brand header, white card, --text-* / --border-* / --accent palette)
// used by functions/lib/email-template.js so every UPR email reads as one system.
function buildLeadEmailHtml({ rows, name, form, env, leadId }) {
  const base = (env && env.APP_BASE_URL) || 'https://utahpros.app';
  const leadsUrl = `${String(base).replace(/\/$/, '')}/crm/leads${leadId ? `?lead=${leadId}` : ''}`;

  const rowsHtml = rows.length
    ? rows.map((r) => `
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #f0f1f3;vertical-align:top;width:36%;color:#5f6672;font-size:13px;">${escapeHtml(r.label)}</td>
              <td style="padding:12px 0 12px 16px;border-bottom:1px solid #f0f1f3;vertical-align:top;color:#111318;font-size:14px;font-weight:500;">${escapeHtml(r.value).replace(/\n/g, '<br>')}</td>
            </tr>`).join('')
    : `
            <tr><td style="padding:12px 0;color:#5f6672;font-size:14px;">A new web-form submission came in. Open the lead for details.</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f9fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);border:1px solid #e2e5e9;">
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">New website lead</p>
          <p style="margin:6px 0 0;font-size:20px;font-weight:700;color:#ffffff;">${escapeHtml(name || 'New lead')}</p>
          ${form ? `<p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">${escapeHtml(form)}</p>` : ''}
        </td></tr>
        <tr><td style="padding:8px 32px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            ${rowsHtml}
          </table>
          <div style="margin-top:24px;">
            <a href="${escapeHtml(leadsUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">View lead &rarr;</a>
          </div>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#8b929e;">Utah Pros Restoration &middot; lead notification</p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── lead.new notification hook (Notification Center, Session B) ──
// Additive + fire-and-forget: announces a genuinely-new web-form lead to admins.
// The RPC is idempotent on the submission token, so the caller only invokes this
// when the pre-existence check saw no prior lead for this token — a resubmit /
// retry with the same token never re-fires. INERT until the catalog type is on.
// Passes the full submission through so the bell/push/email carry the form data,
// not just a "new lead" placeholder (schema/data optional — degrades gracefully).
export async function notifyNewLeadFromForm({ db, env, lead, formName, schema, data, dispatchImpl = dispatchEvent }) {
  try {
    if (!lead || lead.spam_flag) return;
    const { title, body, html } = buildLeadNotificationContent({ schema, data, formName, env, leadId: lead.id });
    const leadsLink = lead.id ? `/crm/leads?lead=${lead.id}` : '/crm/leads';
    await dispatchImpl({
      db, env,
      typeKey: 'lead.new',
      body: {
        title,
        body,
        html,
        link: leadsLink,
        entity_type: 'inbound_lead',
        entity_id: lead.id || null,
        payload: { source_type: 'form', callrail_id: lead.callrail_id || null },
        data: { route: leadsLink, lead_id: lead.id || null },
      },
    });
  } catch { /* fire-and-forget — a notify failure never breaks form intake */ }
}

const RATE_LIMIT_MAX = 10;          // max submissions per IP per window
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors() });
}

// The Turnstile secret lives in integration_config (managed in Supabase); a
// Cloudflare env var is a fallback. Read with the service-role client — the
// table is RLS-locked, so the secret is never visible to anon/authenticated.
async function turnstileSecret(db, env) {
  let configValue = '';
  try {
    const rows = await db.select('integration_config', 'key=eq.turnstile_secret_key&select=value');
    configValue = (rows[0] && rows[0].value) || '';
  } catch (e) {
    console.error('turnstile secret lookup failed (falling back to env):', e);
  }
  return pickConfiguredKey(configValue, env.TURNSTILE_SECRET_KEY);
}

async function verifyTurnstile(secret, token, ip) {
  if (!secret) return true; // not configured yet → don't block (works before the key exists)
  try {
    const body = new URLSearchParams({ secret, response: token || '' });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const out = await res.json();
    return !!out.success;
  } catch {
    return false; // a configured check that we cannot complete fails closed
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const ip = request.headers.get('CF-Connecting-IP') || null;
  const userAgent = request.headers.get('User-Agent') || null;
  const startedAt = new Date().toISOString();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const publicId = body.public_id;
  const data = body.data && typeof body.data === 'object' ? body.data : {};
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  if (!publicId) return json({ error: 'public_id is required' }, 400);

  // ── load the form + its PUBLISHED schema (server is the source of truth) ──
  let form, schema;
  try {
    const rows = await db.select(
      'form_definitions',
      `public_id=eq.${encodeURIComponent(publicId)}&select=id,org_id,status,turnstile_enabled,published_version_id&limit=1`,
    );
    form = rows[0];
    if (!form || form.status !== 'published' || !form.published_version_id) {
      return json({ error: 'Form not found or not published' }, 404);
    }
    const vers = await db.select(
      'form_definition_versions',
      `id=eq.${form.published_version_id}&select=schema`,
    );
    schema = (vers[0] && vers[0].schema) || { fields: [] };
  } catch (e) {
    console.error('form-submit load error:', e);
    return json({ error: 'Could not load form' }, 500);
  }

  // ── spam gate 1: honeypot + minimum fill time (silent drop) ──
  const elapsedMs = typeof body.t0 === 'number' ? Date.now() - body.t0 : undefined;
  const spam = checkSpam({ honeypot: body.hp, elapsedMs });
  if (spam.spam) {
    // Look successful so a bot cannot learn it was filtered.
    return json({ ok: true, thankYou: sanitizeLinkMarkup(schema.thankYou || '') });
  }

  // ── spam gate 2: per-IP rate limit ──
  if (ip) {
    try {
      const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
      const recent = await db.select(
        'form_submissions',
        `ip_address=eq.${encodeURIComponent(ip)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      );
      if (recent.length >= RATE_LIMIT_MAX) {
        return json({ error: 'Too many submissions. Please try again later.' }, 429);
      }
    } catch (e) {
      console.error('form-submit rate-check error (continuing):', e);
    }
  }

  // ── spam gate 3: optional Cloudflare Turnstile (per-form toggle) ──
  if (form.turnstile_enabled) {
    const secret = await turnstileSecret(db, env);
    const ok = await verifyTurnstile(secret, body.turnstile_token, ip);
    if (!ok) return json({ error: 'Verification failed. Please try again.' }, 400);
  }

  // ── server-side schema validation ──
  const result = validateSubmission(schema, data);
  if (!result.valid) {
    return json({ error: 'Please fix the highlighted fields.', errors: result.errors }, 400);
  }

  const consent = consentValue(schema, data);
  const submissionToken =
    (typeof body.submission_token === 'string' && body.submission_token.trim()) ||
    crypto.randomUUID();

  // Newness pre-check: the lead is NEW iff no inbound_lead already carries this
  // submission's callrail_id ('form:<token>'). A resubmit with the same token
  // finds the row and will NOT re-fire lead.new. Default to "existing" on error.
  let leadExisted = true;
  try {
    const [row] = await db.select('inbound_leads', `callrail_id=eq.${encodeURIComponent('form:' + submissionToken)}&select=id&limit=1`);
    leadExisted = !!row;
  } catch { leadExisted = true; }

  try {
    const lead = await db.rpc('upsert_lead_from_form', {
      p_form_id: form.id,
      p_submission_token: submissionToken,
      p_data: data,
      p_utm: utm,
      p_consent: consent,
      p_ip: ip,
      p_user_agent: userAgent,
      p_org_id: form.org_id,
    });

    // Notify admins on a genuinely-new submission only (idempotent by the pre-check).
    if (!leadExisted) {
      const leadRow = Array.isArray(lead) ? lead[0] : lead;
      context.waitUntil(notifyNewLeadFromForm({ db, env, lead: leadRow, formName: schema?.name || null, schema, data }));
    }

    await db.insert('worker_runs', {
      worker_name: 'form-submit',
      status: 'completed',
      records_processed: 1,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    }).catch(() => {});

    return json({ ok: true, thankYou: sanitizeLinkMarkup(schema.thankYou || '') });
  } catch (e) {
    console.error('form-submit RPC error:', e);
    await db.insert('worker_runs', {
      worker_name: 'form-submit',
      status: 'error',
      records_processed: 0,
      error_message: String(e && e.message ? e.message : e).slice(0, 500),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    }).catch(() => {});
    return json({ error: 'Something went wrong submitting the form. Please try again.' }, 500);
  }
}
