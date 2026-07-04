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
 *              consentValue, sanitizeLinkMarkup)
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
import { validateSubmission, checkSpam, consentValue, sanitizeLinkMarkup, pickConfiguredKey } from '../lib/forms.js';
import { dispatchEvent } from './notify.js';

// ── lead.new notification hook (Notification Center, Session B) ──
// Additive + fire-and-forget: announces a genuinely-new web-form lead to admins.
// The RPC is idempotent on the submission token, so the caller only invokes this
// when the pre-existence check saw no prior lead for this token — a resubmit /
// retry with the same token never re-fires. INERT until the catalog type is on.
export async function notifyNewLeadFromForm({ db, env, lead, formName, dispatchImpl = dispatchEvent }) {
  try {
    if (!lead || lead.spam_flag) return;
    await dispatchImpl({
      db, env,
      typeKey: 'lead.new',
      body: {
        title: 'New lead',
        body: `Web form submission${formName ? ` · ${formName}` : ''}.`,
        link: '/leads',
        entity_type: 'inbound_lead',
        entity_id: lead.id || null,
        payload: { source_type: 'form', callrail_id: lead.callrail_id || null },
        data: { route: '/leads', lead_id: lead.id || null },
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
      context.waitUntil(notifyNewLeadFromForm({ db, env, lead: leadRow, formName: schema?.name || null }));
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
