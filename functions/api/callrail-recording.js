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
 *   GET /api/callrail-recording?lead_id=<uuid>   (authenticated — Supabase Bearer)
 *        → the audio bytes (Content-Type passed through from CallRail), or a
 *          JSON error.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ../lib/cors.js, ../lib/supabase.js, ../lib/google-drive.js
 *                  (reuses its generic getActorEmployee Bearer-token check)
 *   External API:  CallRail REST API v3 (the call's recording URL)
 *   Data:          reads → inbound_leads (recording_url), integration_credentials
 *                          (provider='callrail' API key)
 *
 * NOTES / GOTCHAS:
 *   - Takes a lead_id (NOT a raw URL) and only proxies the recording_url stored
 *     on that lead, and only when it is an api.callrail.com URL — so this can't
 *     be turned into an open proxy (SSRF guard).
 *   - The API key is read from integration_credentials and sent as CallRail's
 *     `Authorization: Token token="…"` header; it is never exposed to the client.
 *   - CallRail's recording endpoint may 302 to a signed CDN URL; the platform
 *     fetch follows redirects, so the streamed body is the audio either way.
 * ════════════════════════════════════════════════
 */
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const leadId = new URL(request.url).searchParams.get('lead_id');
  if (!leadId) return jsonResponse({ error: 'lead_id is required' }, 400, request, env);

  const [lead] = await db.select('inbound_leads', `id=eq.${leadId}&select=recording_url`);
  const recUrl = lead?.recording_url;
  if (!recUrl) return jsonResponse({ error: 'No recording for this lead' }, 404, request, env);
  // SSRF guard: only ever proxy a CallRail-hosted recording URL.
  if (!/^https:\/\/api\.callrail\.com\//.test(recUrl)) {
    return jsonResponse({ error: 'Unsupported recording URL' }, 400, request, env);
  }

  const [cred] = await db.select('integration_credentials', `provider=eq.callrail&select=access_token`);
  const apiKey = cred?.access_token;
  if (!apiKey) return jsonResponse({ error: 'CallRail not connected' }, 400, request, env);

  const audioHeaders = (ct) => ({ 'Content-Type': ct || 'audio/mpeg', 'Cache-Control': 'private, max-age=300' });

  const upstream = await fetch(recUrl, { headers: { Authorization: `Token token="${apiKey}"` } });
  if (!upstream.ok || !upstream.body) {
    return jsonResponse({ error: `CallRail recording fetch failed (${upstream.status})` }, 502, request, env);
  }

  const ct = (upstream.headers.get('Content-Type') || '').toLowerCase();

  // Case 1 — CallRail streamed the audio directly: pass it straight through.
  if (ct.startsWith('audio/') || ct.includes('octet-stream')) {
    return new Response(upstream.body, { status: 200, headers: audioHeaders(ct) });
  }

  // Case 2 — CallRail returned JSON describing WHERE the audio lives (a signed
  // URL). Fetch that (no auth — it's pre-signed) and stream it.
  if (ct.includes('application/json')) {
    const data = await upstream.json().catch(() => null);
    const mediaUrl = data && (data.url || data.recording || data.media_url || data.audio_url);
    if (!mediaUrl) {
      return jsonResponse({ error: 'CallRail returned JSON with no audio URL', detail: data }, 502, request, env);
    }
    const audio = await fetch(mediaUrl);
    if (!audio.ok || !audio.body) {
      return jsonResponse({ error: `Signed audio fetch failed (${audio.status})` }, 502, request, env);
    }
    return new Response(audio.body, { status: 200, headers: audioHeaders((audio.headers.get('Content-Type') || '').toLowerCase()) });
  }

  // Case 3 — something unexpected (HTML/redirect page/error). Surface exactly
  // what CallRail sent so this is diagnosable instead of a silent dead player.
  const snippet = (await upstream.text().catch(() => '')).slice(0, 300);
  return jsonResponse({ error: `Unexpected recording response (${upstream.status}, ${ct || 'no content-type'})`, snippet }, 502, request, env);
}
