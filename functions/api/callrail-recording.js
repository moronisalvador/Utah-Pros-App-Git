/**
 * ════════════════════════════════════════════════
 * FILE: callrail-recording.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets staff play a CallRail call recording INSIDE our app instead of being
 *   sent to CallRail's website. CallRail's recording link needs a secret API
 *   key that must never touch the browser, so this small server endpoint
 *   fetches the audio with the key attached and streams it straight back to
 *   the Call Log's audio player.
 *
 * ENDPOINT:
 *   GET /api/callrail-recording?lead_id=<uuid>   (active internal admin or
 *                                                   explicit crm_call_log access)
 *        → the audio bytes (Content-Type passed through from CallRail), or a
 *          JSON error.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ../lib/cors.js, ../lib/supabase.js, ../lib/auth.js,
 *                  ../lib/http.js
 *   External API:  CallRail REST API v3 (the call's recording URL)
 *   Data:          reads → inbound_leads (call identity + availability marker),
 *                          inbound_lead_recording_sources (service-only URL),
 *                          integration_credentials (provider='callrail' API key)
 *
 * NOTES / GOTCHAS:
 *   - Takes a lead_id (NOT a raw URL), requires a call row whose service-only
 *     source URL contains the same callrail_id, and only proxies an allowlisted
 *     CallRail-hosted URL. Identity and object checks run before the credential
 *     read or any provider request.
 *   - The API key is read from integration_credentials and sent as CallRail's
 *     `Authorization: Token token="…"` header; it is never exposed to the client.
 *   - CallRail's recording endpoint may 302 to a signed CDN URL; the platform
 *     fetch follows redirects, so the streamed body is the audio either way.
 * ════════════════════════════════════════════════
 */
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireEmployee } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { resolveCallRecording, resolveCallRailAccountId } from '../lib/callrail-api.js';
import { isAllowedRecordingUrl, extractCallId, callrailApiRecordingUrl } from '../lib/callrail.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORDING_CAPABILITY = 'crm_call_log';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

function denied(error = 'Forbidden', status = 403) {
  return { ok: false, error, status };
}

/**
 * Admin-mobile is role-gated to admins. The desktop Call Log also supports an
 * explicit per-employee/role crm_call_log capability, so the Worker preserves
 * both approved callers while excluding inactive and external identities.
 */
export async function authorizeCallrailRecording(request, env, db) {
  const auth = await requireEmployee(request, env, db);
  if (auth.error) return denied(auth.error, auth.status);

  const { employee } = auth;
  if (employee.is_external !== false) return denied();
  if (employee.role === 'admin') return { ok: true, ...auth, via: 'admin' };

  try {
    const [override] = await db.select(
      'employee_page_access',
      `employee_id=eq.${employee.id}&nav_key=eq.${RECORDING_CAPABILITY}&select=can_view&limit=1`,
    );
    if (override) {
      return override.can_view === true
        ? { ok: true, ...auth, via: 'employee_capability' }
        : denied();
    }

    const [permission] = await db.select(
      'nav_permissions',
      `role=eq.${employee.role}&nav_key=eq.${RECORDING_CAPABILITY}&select=can_view&limit=1`,
    );
    return permission?.can_view === true
      ? { ok: true, ...auth, via: 'role_capability' }
      : denied();
  } catch {
    return denied('Recording authorization lookup failed', 500);
  }
}

function authErrorResponse(auth, request, env) {
  if (auth.status === 401) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  }
  if (auth.status === 403) {
    return jsonResponse({ error: 'Forbidden' }, 403, request, env);
  }
  return jsonResponse(
    { error: 'Authorization check failed' },
    auth.status === 502 ? 502 : 500,
    request,
    env,
  );
}

/**
 * Injectable core used by contract tests. The production entry point below
 * supplies the service-role database client and the real timed provider helpers.
 */
export async function handleCallrailRecording({
  request,
  env,
  db,
  resolveRecordingImpl = resolveCallRecording,
  resolveAccountIdImpl = resolveCallRailAccountId,
  fetchSignedAudioImpl = fetchWithTimeout,
}) {
  const auth = await authorizeCallrailRecording(request, env, db);
  if (!auth.ok) return authErrorResponse(auth, request, env);

  const leadId = new URL(request.url).searchParams.get('lead_id');
  if (!leadId) return jsonResponse({ error: 'lead_id is required' }, 400, request, env);
  if (!UUID_RE.test(leadId)) {
    return jsonResponse({ error: 'No recording for this lead' }, 404, request, env);
  }

  let lead;
  try {
    [lead] = await db.select(
      'inbound_leads',
      `id=eq.${leadId}&select=id,source_type,callrail_id,recording_url&limit=1`,
    );
  } catch {
    return jsonResponse({ error: 'Lead lookup failed' }, 500, request, env);
  }
  if (lead?.source_type !== 'call' || !lead?.recording_url) {
    return jsonResponse({ error: 'No recording for this lead' }, 404, request, env);
  }

  let source;
  try {
    [source] = await db.select(
      'inbound_lead_recording_sources',
      `lead_id=eq.${leadId}&select=recording_url&limit=1`,
    );
  } catch {
    // Compatibility phase: before the S1e migration, the source table does not
    // exist and the real allowlisted URL is still on inbound_leads. After S1e,
    // the marker is intentionally not an allowed provider URL, so this fallback
    // cannot turn a post-migration source-table outage into provider access.
    if (!isAllowedRecordingUrl(lead.recording_url)) {
      return jsonResponse({ error: 'Lead lookup failed' }, 500, request, env);
    }
  }
  const recUrl = source?.recording_url || lead.recording_url;
  if (!recUrl) return jsonResponse({ error: 'No recording for this lead' }, 404, request, env);
  // SSRF guard: only ever proxy a CallRail-hosted recording URL. Accepts both
  // the api.callrail.com REST form (backfill) AND the app.callrail.com signed
  // redirect the live webhook delivers — see isAllowedRecordingUrl.
  if (!isAllowedRecordingUrl(recUrl)) {
    return jsonResponse({ error: 'Unsupported recording URL' }, 400, request, env);
  }
  const urlCallId = extractCallId(recUrl);
  if (!urlCallId || String(urlCallId).toLowerCase() !== String(lead.callrail_id || '').toLowerCase()) {
    return jsonResponse({ error: 'No recording for this lead' }, 404, request, env);
  }

  let cred;
  try {
    [cred] = await db.select(
      'integration_credentials',
      'provider=eq.callrail&select=access_token&limit=1',
    );
  } catch {
    return jsonResponse({ error: 'CallRail configuration lookup failed' }, 500, request, env);
  }
  const apiKey = cred?.access_token;
  if (!apiKey) return jsonResponse({ error: 'CallRail not connected' }, 400, request, env);

  // The LIVE webhook stores an app.callrail.com signed "recording/redirect" URL
  // that THROWS when fetched server-side (→ 502). The api.callrail.com REST form
  // (what the backfill stores) streams cleanly. So for the app form, rewrite to
  // the api form by call id + account id before proxying — see functions/lib/callrail.js.
  let fetchUrl = recUrl;
  if (/^https:\/\/app\.callrail\.com\//.test(recUrl)) {
    const callId = extractCallId(recUrl);
    let accountId;
    try {
      accountId = await resolveAccountIdImpl(db, apiKey, env);
    } catch {
      return jsonResponse({ error: 'CallRail recording fetch failed (0)' }, 502, request, env);
    }
    const apiUrl = callrailApiRecordingUrl(accountId, callId);
    if (apiUrl) fetchUrl = apiUrl;
  }

  const audioHeaders = (ct) => ({ 'Content-Type': ct || 'audio/mpeg', 'Cache-Control': 'private, max-age=300' });

  // resolveCallRecording handles both shapes CallRail returns (direct audio
  // stream vs. JSON → signed URL) — see functions/lib/callrail-api.js.
  let rec;
  try {
    rec = await resolveRecordingImpl(apiKey, fetchUrl);
  } catch {
    return jsonResponse({ error: 'CallRail recording fetch failed (0)' }, 502, request, env);
  }

  // Case 1 — CallRail streamed the audio directly: pass it straight through.
  if (rec.kind === 'stream') {
    return new Response(rec.response.body, { status: 200, headers: audioHeaders(rec.contentType) });
  }

  // Case 2 — a signed CDN URL. Fetch it (no auth — it's pre-signed) and stream.
  if (rec.kind === 'url') {
    let audio;
    try {
      audio = await fetchSignedAudioImpl(rec.url);
    } catch {
      return jsonResponse({ error: 'Signed audio fetch failed (0)' }, 502, request, env);
    }
    if (!audio.ok || !audio.body) {
      return jsonResponse({ error: `Signed audio fetch failed (${audio.status})` }, 502, request, env);
    }
    return new Response(audio.body, { status: 200, headers: audioHeaders((audio.headers.get('Content-Type') || '').toLowerCase()) });
  }

  // Case 3 — surface exactly what went wrong instead of a silent dead player.
  if (rec.reason === 'fetch-failed') {
    return jsonResponse({ error: `CallRail recording fetch failed (${rec.status})` }, 502, request, env);
  }
  if (rec.reason === 'json-no-url') {
    return jsonResponse({ error: 'CallRail returned JSON with no audio URL', detail: rec.detail }, 502, request, env);
  }
  return jsonResponse({ error: `Unexpected recording response (${rec.status}, ${rec.contentType || 'no content-type'})`, snippet: rec.snippet }, 502, request, env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  return handleCallrailRecording({ request, env, db: supabase(env) });
}
