/**
 * ════════════════════════════════════════════════
 * FILE: webflow-form-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Receives a notification from Webflow every time a visitor submits one of
 *   the native lead-capture forms on utahrestorationpros.com (Webflow's own
 *   "Html Form" / "Main Contact Form" elements — NOT the hosted /f/[public_id]
 *   embed). Webflow's Data API cannot insert an <iframe> embed onto a page
 *   (406), so the live site keeps its own native forms for design consistency
 *   with the cp-* system, and this webhook is the bridge that gets those
 *   submissions into UPR's lead pipeline instead of them just sitting in
 *   Webflow's own form-submission log.
 *
 * ENDPOINT:
 *   POST /api/webflow-form-webhook?secret=<shared secret>  (see NOTES)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-role client), ../lib/cors.js,
 *              ../lib/forms.js (pickConfiguredKey, isTruthy),
 *              ./form-submit.js (notifyNewLeadFromForm — reused so the lead.new
 *              alert reads exactly like every other web-form lead)
 *   Data:      reads  → integration_config (webhook shared secret),
 *                       inbound_leads (idempotency pre-check)
 *              writes → inbound_leads, contacts, form_submissions,
 *                       lead_attribution, sms_consent_log, system_events
 *                       (all via the upsert_lead_from_form RPC — the SAME RPC
 *                       the hosted /f/ embed uses, so TCPA consent logging,
 *                       contact matching, and attribution all work exactly
 *                       the same way for a Webflow-native submission), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - upsert_lead_from_form REQUIRES a real, published form_definitions row
 *     (it raises if the form isn't found/published) and locates the phone /
 *     email / name / consent fields by each field's `type` in that form's
 *     published schema — not by hardcoded key names. So FORM_SCHEMAS below
 *     must be kept byte-for-byte in sync with the two form_definitions rows
 *     registered in UPR ("Webflow — Site Contact Form (R2)" id
 *     650a9bb5-26d8-4718-91f7-1cf30f2ace33 and "…(Legacy)" id
 *     b285461f-5083-45e6-97a3-34da421e606f) — if a field key/type drifts
 *     between the Webflow form and either schema here, phone/consent
 *     detection silently breaks for that shape.
 *   - TWO shapes exist live right now: the R2-redesign pages ("Full-name",
 *     "SMS-consent", per-category checkboxes) and ~11 still-live legacy pages
 *     ("Name", "Kind of damage" dropdown, "SMS-Consent"). The site is
 *     mid-retirement of the legacy pages (WEBSITE-PUNCHLIST.md) — once
 *     they're all unpublished, the legacy branch below stops firing and can
 *     be deleted. Detection is by which distinctive key is present in the
 *     submission data (cheap and future-page-safe — no per-formId map to
 *     maintain), not by Webflow's formId (many distinct formIds share each
 *     shape, one per page).
 *   - AUTH IS A SHARED SECRET, same posture as callrail-webhook.js: Webflow's
 *     request-signature scheme (`x-webflow-signature`) is only computable by
 *     whoever holds the webhook's OAuth-app CLIENT SECRET — that's the Webflow
 *     MCP connector's app credential, which this project doesn't have — so a
 *     `?secret=` query param (checked against integration_config
 *     'webflow_webhook_secret', with env.WEBFLOW_WEBHOOK_SECRET as a fallback,
 *     mirroring the Turnstile-key pattern in forms.js) is the practical choice.
 *     Set the SAME value on the webhook URL when it's created in Webflow.
 *   - Webflow's form_submission payload carries no visitor IP/user-agent, so
 *     p_ip/p_user_agent are always null here (unlike the hosted /f/ embed,
 *     which has both from the real request).
 *   - Idempotency: keyed on Webflow's own submission id ('form:' + id), the
 *     exact convention upsert_lead_from_form already uses internally — a
 *     redelivery of the same submission is a no-op, never a duplicate lead.
 *   - Always returns 200 on processing errors (only 403 on a bad/missing
 *     secret) so Webflow doesn't enter a retry storm — mirrors
 *     callrail-webhook.js's same choice.
 *   - Every call writes a worker_runs row so a failed delivery is visible
 *     without digging through Cloudflare logs.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { pickConfiguredKey, isTruthy } from '../lib/forms.js';
import { notifyNewLeadFromForm } from './form-submit.js';

// Keep byte-for-byte in sync with the published schema on the matching
// form_definitions row (see NOTES) — used only to build a clean lead.new
// notification (schema-typed fields decide what the alert shows/hides), never
// sent to the RPC (which reads the schema from the DB itself).
const R2_SCHEMA = {
  fields: [
    { key: 'Full-name', label: 'Full name', type: 'text', required: true },
    { key: 'Phone', label: 'Phone', type: 'phone', required: true },
    { key: 'Email', label: 'Email', type: 'email', required: true },
    { key: 'Mold', label: 'Mold', type: 'checkbox', required: false },
    { key: 'Water-Damage', label: 'Water Damage', type: 'checkbox', required: false },
    { key: 'Fire-and-Smoke', label: 'Fire and Smoke', type: 'checkbox', required: false },
    { key: 'Remodeling', label: 'Remodeling', type: 'checkbox', required: false },
    { key: 'Message', label: 'Message', type: 'textarea', required: false },
    { key: 'SMS-consent', label: 'SMS consent', type: 'consent', required: false },
  ],
};
const LEGACY_SCHEMA = {
  fields: [
    { key: 'Name', label: 'Name', type: 'text', required: true },
    { key: 'Phone Number', label: 'Phone Number', type: 'phone', required: true },
    { key: 'Kind of damage', label: 'Kind of damage', type: 'select', required: true },
    { key: 'Message', label: 'Message', type: 'textarea', required: false },
    { key: 'SMS-Consent', label: 'SMS consent', type: 'consent', required: false },
  ],
};

export const R2_FORM_ID = '650a9bb5-26d8-4718-91f7-1cf30f2ace33';
export const LEGACY_FORM_ID = 'b285461f-5083-45e6-97a3-34da421e606f';
const ORG_ID = 'b1be7519-209b-493b-bb5b-b578b91db567'; // Utah Pros Restoration (crm_orgs)

// Pick which registered form (and matching schema) this submission's data shape
// belongs to. Keyed on a distinctive field name rather than Webflow's formId,
// since many distinct formIds (one per page) share each shape.
export function resolveForm(data) {
  if (data && Object.prototype.hasOwnProperty.call(data, 'Full-name')) {
    return { formId: R2_FORM_ID, schema: R2_SCHEMA };
  }
  if (data && Object.prototype.hasOwnProperty.call(data, 'Name')) {
    return { formId: LEGACY_FORM_ID, schema: LEGACY_SCHEMA };
  }
  return null;
}

// Did the visitor tick the SMS-consent checkbox? Checked by key pattern
// (case-insensitive) rather than a hardcoded key, since the R2 and legacy
// forms spell it "SMS-consent" / "SMS-Consent" respectively.
export function consentFromData(data) {
  const key = Object.keys(data || {}).find((k) => /sms.?consent/i.test(k));
  return key ? isTruthy(data[key]) : false;
}

async function webhookSecret(db, env) {
  let configValue = '';
  try {
    const rows = await db.select('integration_config', 'key=eq.webflow_webhook_secret&select=value');
    configValue = (rows[0] && rows[0].value) || '';
  } catch (e) {
    console.error('webflow-form-webhook secret lookup failed (falling back to env):', e);
  }
  return pickConfiguredKey(configValue, env.WEBFLOW_WEBHOOK_SECRET);
}

async function checkSecret(request, db, env) {
  const url = new URL(request.url);
  const provided = url.searchParams.get('secret');
  if (!provided) return false;
  const expected = await webhookSecret(db, env);
  if (!expected) return true; // not configured yet → don't block delivery before the key exists
  return provided === expected;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const authorized = await checkSecret(request, db, env);
  if (!authorized) {
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 200, request, env);
  }

  const payload = (body && typeof body === 'object' && body.payload) || body || {};
  const data = (payload.data && typeof payload.data === 'object') ? payload.data : {};
  const submissionId = payload.id || payload.submissionId;

  if (!submissionId) {
    await db.insert('worker_runs', {
      worker_name: 'webflow-form-webhook', status: 'error', records_processed: 0,
      error_message: ('Payload missing a submission id — raw: ' + JSON.stringify(body)).slice(0, 1500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    }).catch(() => {});
    return jsonResponse({ ok: false, error: 'Missing submission id in payload' }, 200, request, env);
  }

  const resolved = resolveForm(data);
  if (!resolved) {
    await db.insert('worker_runs', {
      worker_name: 'webflow-form-webhook', status: 'error', records_processed: 0,
      error_message: ('Unrecognized form shape — raw data: ' + JSON.stringify(data)).slice(0, 1500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    }).catch(() => {});
    return jsonResponse({ ok: false, error: 'Unrecognized form shape' }, 200, request, env);
  }

  const submissionToken = 'webflow:' + submissionId;
  const callrailId = 'form:' + submissionToken;

  // Newness pre-check, same pattern as callrail-webhook.js: this lead is NEW
  // iff no inbound_lead already carries this submission's dedup key. A
  // redelivery finds the row and will NOT re-fire lead.new.
  let leadExisted = true;
  try {
    const [row] = await db.select('inbound_leads', `callrail_id=eq.${encodeURIComponent(callrailId)}&select=id&limit=1`);
    leadExisted = !!row;
  } catch { leadExisted = true; }

  try {
    const lead = await db.rpc('upsert_lead_from_form', {
      p_form_id: resolved.formId,
      p_submission_token: submissionToken,
      p_data: data,
      p_utm: { source: 'webflow', medium: 'website', campaign: payload.name || null },
      p_consent: consentFromData(data),
      p_ip: null,
      p_user_agent: null,
      p_org_id: ORG_ID,
    });
    const leadRow = Array.isArray(lead) ? lead[0] : lead;

    await db.insert('worker_runs', {
      worker_name: 'webflow-form-webhook', status: 'completed', records_processed: 1,
      started_at: startedAt, completed_at: new Date().toISOString(),
    }).catch(() => {});

    if (!leadExisted) {
      context.waitUntil(notifyNewLeadFromForm({
        db, env, lead: leadRow, formName: payload.name || null, schema: resolved.schema, data,
      }));
    }

    return jsonResponse({ ok: true, lead_id: leadRow && leadRow.id }, 200, request, env);
  } catch (e) {
    await db.insert('worker_runs', {
      worker_name: 'webflow-form-webhook', status: 'error', records_processed: 0,
      error_message: String(e.message || e).slice(0, 500), started_at: startedAt, completed_at: new Date().toISOString(),
    }).catch(() => {});
    // Still 200 — see NOTES on avoiding a Webflow retry storm.
    return jsonResponse({ ok: false, error: 'Processing failed, logged for follow-up' }, 200, request, env);
  }
}
