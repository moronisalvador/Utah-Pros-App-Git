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
 *   Internal:      ../lib/supabase.js (service-role client), ../lib/cors.js
 *   Data:          reads  → integration_config (webhook shared secret),
 *                           contacts (linked by phone — never created here)
 *                  writes → inbound_leads, system_events (via the
 *                           upsert_lead_from_callrail RPC), worker_runs
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
 *   - PAYLOAD SHAPE IS CONFIRMED against a live delivery: CallRail POSTs the
 *     call webhook as `application/x-www-form-urlencoded` (NOT JSON), so after
 *     decoding every value is a string, and the call id arrives under
 *     `resource_id` (there is no top-level `id`). The pure mappers
 *     (mapCallPayload/mapFormPayload in ../lib/callrail.js) handle both — they
 *     coerce boolean-ish strings and Number()-ify duration. See
 *     functions/lib/callrail.test.js, which pins the real payload as a fixture.
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
import { firstOf, mapCallPayload, mapFormPayload, extractCallId, callrailApiRecordingUrl } from '../lib/callrail.js';
import { resolveCallRailAccountId } from '../lib/callrail-api.js';

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

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const authorized = await checkSecret(request, db);
  if (!authorized) {
    return new Response('Forbidden', { status: 403 });
  }

  // Read the body once as text, then try JSON, then form-encoding — CallRail may
  // POST either. `raw` is kept so we can capture the exact bytes when mapping fails.
  const raw = await request.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(raw); } catch { /* not JSON — try form below */ }
  if (!body) {
    try { body = Object.fromEntries(new URLSearchParams(raw)); } catch { /* not form either */ }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    await db.insert('worker_runs', {
      worker_name: 'callrail-webhook', status: 'error', records_processed: 0,
      error_message: ('Unparseable payload — raw: ' + raw).slice(0, 1500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return jsonResponse({ ok: false, error: 'Unparseable payload' }, 200, request, env);
  }

  const isForm = !!firstOf(body, ['form_data', 'formdata']) || body?.event_type === 'form_submission';
  const params = isForm ? mapFormPayload(body) : mapCallPayload(body);

  if (!params.p_callrail_id || params.p_callrail_id === 'null') {
    // Capture the RAW payload so we can map the real field names — the id key isn't
    // where we guessed. (Round 1: diagnostic capture; Round 2 fixes the mapping.)
    await db.insert('worker_runs', {
      worker_name: 'callrail-webhook', status: 'error', records_processed: 0,
      error_message: ('Payload missing an id field — raw: ' + raw).slice(0, 1500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    // Still 200 — malformed payload isn't something CallRail should retry forever.
    return jsonResponse({ ok: false, error: 'Missing lead id in payload' }, 200, request, env);
  }

  // Normalize the recording URL at ingest: CallRail's webhook delivers an
  // app.callrail.com signed "recording/redirect" link that THROWS when fetched
  // server-side (502 on playback + transcription). Store the api.callrail.com
  // REST form instead — the same shape the backfill stores and every consumer
  // (recording proxy, transcribe-call) streams cleanly. Account id comes from
  // integration_config (no API call needed); if it can't be resolved we keep the
  // original URL (the recording proxy also rewrites app→api defensively).
  if (params.p_recording_url && /^https:\/\/app\.callrail\.com\//.test(params.p_recording_url)) {
    try {
      const accountId = await resolveCallRailAccountId(db, null, env);
      const apiUrl = callrailApiRecordingUrl(accountId, extractCallId(params.p_recording_url));
      if (apiUrl) params.p_recording_url = apiUrl;
    } catch { /* keep original URL — playback rewrite is the safety net */ }
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
