/**
 * ════════════════════════════════════════════════
 * FILE: callrail-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Receives a notification from CallRail every time something happens with
 *   a tracked phone call or website form — the call started, the call
 *   finished, the recording is ready, or someone filled out a form. It saves
 *   (or updates) one row per call/form in our own database so staff can see
 *   every lead in one place, without having to also check CallRail.
 *
 * ENDPOINT:
 *   POST /api/callrail-webhook?secret=<shared secret>  (see NOTES)
 *
 * DEPENDS ON:
 *   Packages:      none (uses the platform fetch)
 *   Internal:      ../lib/supabase.js (service-role client), ../lib/cors.js,
 *                  ../lib/callrail.js (shouldCreateContact — used only for
 *                  logging/telemetry here; upsert_lead_from_callrail is the
 *                  actual server-side enforcement)
 *   Data:          reads  → integration_config (webhook shared secret)
 *                  writes → inbound_leads, contacts, system_events (all via
 *                           the upsert_lead_from_callrail RPC), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - AUTH IS A DOCUMENTED PLACEHOLDER (docs/crm-roadmap.md "Open items to
 *     confirm before Phase 1 starts"): CallRail lets you fully customize the
 *     webhook target URL per event type, so this checks a `?secret=` query
 *     param against integration_config('callrail_webhook_secret') rather
 *     than a signature header — simple, and doesn't require guessing at an
 *     unverified HMAC scheme. CONFIRM against CallRail's current webhook
 *     docs/dashboard at connect time; switch to header-signature validation
 *     here if CallRail's actual mechanism differs.
 *   - PAYLOAD FIELD NAMES ARE BEST-EFFORT (same open item): CallRail's exact
 *     JSON keys per event type aren't verified against a live payload in
 *     this session. mapCallPayload()/mapFormPayload() below use defensive
 *     multi-key fallbacks (matching the style already used in
 *     sync-encircle.js for the same reason) — adjust the key names against a
 *     real webhook delivery before relying on this in production.
 *   - Always returns 200 on processing errors (only 403 on a bad/missing
 *     secret) so CallRail doesn't enter a retry storm — mirrors
 *     twilio-webhook.js's same choice, and the cross-cutting "guard against
 *     runaway retries" rule in docs/crm-roadmap.md.
 *   - Every call writes a worker_runs row so a failed delivery is visible
 *     without digging through Cloudflare logs.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ─── SECTION: Helpers ──────────────
async function checkSecret(request, db) {
  const url = new URL(request.url);
  const provided = url.searchParams.get('secret');
  if (!provided) return false;
  const [row] = await db.select('integration_config', `key=eq.callrail_webhook_secret&select=value`);
  return !!row?.value && row.value === provided;
}

function firstOf(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

// Best-effort mapping of a CallRail "call" webhook payload — see NOTES above.
function mapCallPayload(body) {
  return {
    p_callrail_id:     String(firstOf(body, ['id', 'call_id', 'callrail_id'])),
    p_source_type:     'call',
    p_tracking_number: firstOf(body, ['tracking_phone_number', 'tracking_number']),
    p_caller_number:   firstOf(body, ['customer_phone_number', 'caller_number', 'from_number']),
    p_duration_sec:    firstOf(body, ['duration', 'duration_sec']),
    p_spam_flag:       !!firstOf(body, ['spam', 'spam_flag']),
    p_source:          firstOf(body, ['source', 'utm_source']),
    p_medium:          firstOf(body, ['medium', 'utm_medium']),
    p_campaign:        firstOf(body, ['campaign', 'utm_campaign']),
    p_recording_url:   firstOf(body, ['recording', 'recording_url']),
    p_transcription:   firstOf(body, ['transcription', 'transcript']),
    p_form_data:       null,
    p_lead_status:     firstOf(body, ['lead_status']) || 'new',
    p_value:           firstOf(body, ['value']),
    p_direction:       firstOf(body, ['direction']),
    p_occurred_at:     firstOf(body, ['start_time', 'created_at', 'occurred_at']) || new Date().toISOString(),
    p_raw_payload:     body,
  };
}

// Best-effort mapping of a CallRail "form submission" webhook payload.
function mapFormPayload(body) {
  return {
    p_callrail_id:     String(firstOf(body, ['id', 'form_id', 'callrail_id'])),
    p_source_type:     'form',
    p_tracking_number: null,
    p_caller_number:   firstOf(body, ['phone_number', 'customer_phone_number']),
    p_duration_sec:    null,
    p_spam_flag:       !!firstOf(body, ['spam', 'spam_flag']),
    p_source:          firstOf(body, ['source', 'utm_source']),
    p_medium:          firstOf(body, ['medium', 'utm_medium']),
    p_campaign:        firstOf(body, ['campaign', 'utm_campaign']),
    p_recording_url:   null,
    p_transcription:   null,
    p_form_data:       firstOf(body, ['form_data', 'formdata']) || body,
    p_lead_status:     'new',
    p_value:           firstOf(body, ['value']),
    p_direction:       'inbound',
    p_occurred_at:     firstOf(body, ['created_at', 'occurred_at']) || new Date().toISOString(),
    p_raw_payload:     body,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const authorized = await checkSecret(request, db);
  if (!authorized) {
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400, request, env);
  }

  const isForm = !!firstOf(body, ['form_data', 'formdata']) || body?.event_type === 'form_submission';
  const params = isForm ? mapFormPayload(body) : mapCallPayload(body);

  if (!params.p_callrail_id || params.p_callrail_id === 'null') {
    await db.insert('worker_runs', {
      worker_name: 'callrail-webhook', status: 'error', records_processed: 0,
      error_message: 'Payload missing an id field', started_at: startedAt, completed_at: new Date().toISOString(),
    });
    // Still 200 — malformed payload isn't something CallRail should retry forever.
    return jsonResponse({ ok: false, error: 'Missing lead id in payload' }, 200, request, env);
  }

  try {
    const lead = await db.rpc('upsert_lead_from_callrail', params);
    await db.insert('worker_runs', {
      worker_name: 'callrail-webhook', status: 'completed', records_processed: 1,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return jsonResponse({ ok: true, lead_id: lead.id }, 200, request, env);
  } catch (e) {
    await db.insert('worker_runs', {
      worker_name: 'callrail-webhook', status: 'error', records_processed: 0,
      error_message: String(e.message || e).slice(0, 500), started_at: startedAt, completed_at: new Date().toISOString(),
    });
    // Still 200 — see NOTES on avoiding a CallRail retry storm.
    return jsonResponse({ ok: false, error: 'Processing failed, logged for follow-up' }, 200, request, env);
  }
}
