/**
 * ════════════════════════════════════════════════
 * FILE: callrail-backfill.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A one-time, manually-triggered catch-up. It asks CallRail for calls it
 *   already has on file (not just new ones going forward) and saves them the
 *   same way the live webhook does, so the Call Log isn't empty on day one.
 *   Not a cron job — someone clicks a button to run it. CALLS ONLY for now —
 *   see NOTES on why historical form leads are deliberately not backfilled
 *   yet (new form leads still arrive live via callrail-webhook.js once
 *   CallRail is connected; this only affects pre-connection history).
 *
 * ENDPOINT:
 *   POST /api/callrail-backfill   (authenticated — Supabase Bearer)
 *        body: { days?: number }  — how far back to pull (default 30)
 *
 * DEPENDS ON:
 *   Packages:      none (uses the platform fetch)
 *   Internal:      ../lib/supabase.js, ../lib/cors.js, ../lib/google-drive.js
 *                  (getActorEmployee)
 *   External API:  CallRail REST API v3 (api.callrail.com)
 *   Data:          reads  → integration_credentials (provider='callrail')
 *                  writes → inbound_leads, contacts, system_events (all via
 *                           upsert_lead_from_callrail), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - CALLRAIL ENDPOINT/FIELD NAMES ARE BEST-EFFORT (docs/crm-roadmap.md
 *     "Open items to confirm before Phase 1 starts"): the account id and
 *     exact list-calls response shape aren't verified against a live
 *     CallRail account in this session. Confirm the endpoint path, auth
 *     header format, and response field names against CallRail's v3 API
 *     docs before running this against a real account — same caveat as
 *     callrail-webhook.js's payload mapping (kept consistent with it here).
 *   - DISCLOSED GAP, NOT AN OVERSIGHT: the roadmap's Phase 1 spec asks the
 *     backfill to cover "historical calls + form leads." This worker only
 *     backfills calls (`/v3/a/{account}/calls.json`) — CallRail's historical
 *     form-submission list endpoint is a second, differently-shaped API this
 *     session couldn't verify without a live account (same open item as
 *     whether the site's form even routes through CallRail's Form Tracking
 *     product at all — see roadmap "Open items to confirm before Phase 1
 *     starts"). Deferred rather than guessed at. Does not affect *live* form
 *     leads once CallRail is connected — those arrive the same way calls do,
 *     through callrail-webhook.js's mapFormPayload().
 *   - Paginates defensively (stops after `per_page` returns fewer rows than
 *     requested, or after a hard cap) rather than assuming a `has_more` flag.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';

const MAX_PAGES = 50; // hard cap — guards against a runaway pagination loop

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

function firstOf(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

function mapCall(c) {
  return {
    p_callrail_id:     String(firstOf(c, ['id'])),
    p_source_type:     'call',
    p_tracking_number: firstOf(c, ['tracking_phone_number']),
    p_caller_number:   firstOf(c, ['customer_phone_number']),
    p_duration_sec:    firstOf(c, ['duration']),
    p_spam_flag:       !!firstOf(c, ['spam']),
    p_source:          firstOf(c, ['source']),
    p_medium:          firstOf(c, ['medium']),
    p_campaign:        firstOf(c, ['campaign']),
    p_recording_url:   firstOf(c, ['recording']),
    p_transcription:   firstOf(c, ['transcription']),
    p_form_data:       null,
    p_lead_status:     firstOf(c, ['lead_status']) || 'new',
    p_value:           firstOf(c, ['value']),
    p_direction:       firstOf(c, ['direction']),
    p_occurred_at:     firstOf(c, ['start_time']) || new Date().toISOString(),
    p_raw_payload:     c,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const body = await request.json().catch(() => ({}));
  const days = Number(body.days) > 0 ? Number(body.days) : 30;

  const [cred] = await db.select('integration_credentials', `provider=eq.callrail&select=access_token`);
  const apiKey = cred?.access_token;
  const accountId = env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    return jsonResponse({ error: 'CallRail not connected (missing API key or CALLRAIL_ACCOUNT_ID)' }, 400, request, env);
  }

  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let processed = 0;
  let page = 1;
  let errored = 0;

  try {
    while (true) {
      const res = await fetch(
        `https://api.callrail.com/v3/a/${accountId}/calls.json?start_date=${startDate}&per_page=100&page=${page}`,
        { headers: { 'Authorization': `Token token="${apiKey}"` } }
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`CallRail API ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json();
      const calls = Array.isArray(data) ? data : data.calls || [];
      if (!calls.length) break;

      for (const c of calls) {
        try {
          await db.rpc('upsert_lead_from_callrail', mapCall(c));
          processed++;
        } catch {
          errored++;
        }
      }

      if (calls.length < 100 || page >= MAX_PAGES) break;
      page++;
    }

    await db.insert('worker_runs', {
      worker_name: 'callrail-backfill', status: 'completed', records_processed: processed,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return jsonResponse({ ok: true, processed, errored, pages: page }, 200, request, env);
  } catch (e) {
    await db.insert('worker_runs', {
      worker_name: 'callrail-backfill', status: 'error', records_processed: processed,
      error_message: String(e.message || e).slice(0, 500), started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return jsonResponse({ error: e.message, processed }, 500, request, env);
  }
}
