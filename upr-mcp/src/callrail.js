/**
 * ════════════════════════════════════════════════
 * FILE: callrail.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant read UPR's phone-call tracking data (CallRail) and turn a
 *   recorded call into written text (Deepgram) from a Claude chat — list the
 *   calls that came in, look one up, grab its recording, or transcribe it.
 *   CallRail is how UPR knows which ad/campaign made the phone ring; Deepgram is
 *   the AI service that writes out what was said. Neither key ever touches the
 *   browser — this reuses the SAME keys the app already stored.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ./supabase.js (service-role client — reads the stored keys)
 *   External API:  CallRail REST API v3 (api.callrail.com), Deepgram (api.deepgram.com)
 *   Data:          reads → integration_credentials (provider='callrail' + 'deepgram'
 *                          access_token), integration_config (callrail_account_id)
 *
 * NOTES / GOTCHAS:
 *   - CallRail auth is a header quirk: `Authorization: Token token="<key>"` (the
 *     key is wrapped in `token="…"`), NOT a plain Bearer. Ported from
 *     functions/lib/callrail-api.js.
 *   - CallRail's REST calls are account-scoped: /v3/a/{account_id}/…. The account
 *     id is looked up from integration_config (key=callrail_account_id) and, if
 *     missing, discovered from /v3/a.json (the key can list its own accounts) and
 *     cached back — mirroring resolveCallRailAccountId in the app.
 *   - resolveRecording() normalizes CallRail's two recording shapes (a direct
 *     audio stream vs. JSON pointing at a short-lived signed CDN URL) to a URL the
 *     assistant (or Deepgram) can fetch. Ported from resolveCallRecording.
 *   - Deepgram is a PAID per-call API — the transcribe tool is a guarded [WRITE]
 *     in tools.js so it never fires without confirm:true.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const CR_BASE = 'https://api.callrail.com/v3';
const DG_URL = 'https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&smart_format=true';

// CallRail's header quirk: the key is wrapped in token="…", not a plain Bearer.
const crAuth = (apiKey) => ({ Authorization: `Token token="${apiKey}"` });

// ─── Credential lookup (reuses the MCP's service-role Supabase client) ───────────
async function callrailKey(env) {
  const rows = await supabase(env).select('integration_credentials', `provider=eq.callrail&select=access_token&limit=1`);
  const key = rows && rows[0] && rows[0].access_token;
  if (!key) throw new Error('CallRail is not connected in UPR (integration_credentials provider=callrail is missing) — connect it on the Integrations page first.');
  return key;
}

async function deepgramKey(env) {
  const rows = await supabase(env).select('integration_credentials', `provider=eq.deepgram&select=access_token&limit=1`);
  const key = rows && rows[0] && rows[0].access_token;
  if (!key) throw new Error('Deepgram is not connected in UPR (integration_credentials provider=deepgram is missing).');
  return key;
}

// Resolve the CallRail account id: saved config → env (back-compat) → discover
// via the API (and cache it). Ported from functions/lib/callrail-api.js.
async function callrailAccountId(env, apiKey) {
  const db = supabase(env);
  const [cfg] = await db.select('integration_config', 'key=eq.callrail_account_id&select=value');
  if (cfg && cfg.value) return String(cfg.value);
  if (env.CALLRAIL_ACCOUNT_ID) return String(env.CALLRAIL_ACCOUNT_ID);

  const res = await fetch(`${CR_BASE}/a.json`, { headers: crAuth(apiKey) });
  if (!res.ok) throw new Error(`CallRail account lookup ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json().catch(() => ({}));
  const id = (data.accounts || [])[0] && (data.accounts || [])[0].id;
  if (!id) throw new Error('Could not determine the CallRail account id (the API key returned no accounts).');
  const [existing] = await db.select('integration_config', 'key=eq.callrail_account_id&select=value');
  if (!existing) await db.insert('integration_config', { key: 'callrail_account_id', value: String(id) });
  return String(id);
}

// Core CallRail fetch. `path` begins with '/'. Handles non-JSON + surfaces errors.
async function crFetch(env, path, options = {}) {
  const apiKey = await callrailKey(env);
  const res = await fetch(`${CR_BASE}${path}`, {
    ...options,
    headers: { ...crAuth(apiKey), 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    throw new Error(`CallRail ${options.method || 'GET'} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

// ─── Generic power tools (reach any endpoint) ────────────────────────────────────
// path may be account-relative ("/calls.json") — the {account_id} is injected — or
// absolute ("/a/123/calls.json"); pass account:false to skip injection entirely.
export async function callrailGet(env, path, { account = true } = {}) {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!account || p.startsWith('/a/') || p.startsWith('/a.json')) return crFetch(env, p);
  const acct = await callrailAccountId(env, await callrailKey(env));
  return crFetch(env, `/a/${acct}${p}`);
}
export async function callrailRequest(env, method, path, body, { account = true } = {}) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const full = (!account || p.startsWith('/a/')) ? p : `/a/${await callrailAccountId(env, await callrailKey(env))}${p}`;
  return crFetch(env, full, { method: String(method || 'POST').toUpperCase(), ...(body != null ? { body: JSON.stringify(body) } : {}) });
}

// ─── Calls ───────────────────────────────────────────────────────────────────────
// GET /v3/a/{account}/calls.json — the call log, newest first.
export async function callrailListCalls(env, { start_date, end_date, search, per_page = 50, page = 1 } = {}) {
  const acct = await callrailAccountId(env, await callrailKey(env));
  const qp = new URLSearchParams({ per_page: String(Math.min(Number(per_page) || 50, 250)), page: String(page || 1), sort: 'start_time', order: 'desc' });
  if (start_date) qp.set('start_date', start_date);
  if (end_date) qp.set('end_date', end_date);
  if (search) qp.set('search', search);
  return crFetch(env, `/a/${acct}/calls.json?${qp.toString()}`);
}

// GET /v3/a/{account}/calls/{id}.json — one call, with common fields expanded.
export async function callrailGetCall(env, callId) {
  const acct = await callrailAccountId(env, await callrailKey(env));
  const qp = new URLSearchParams({ fields: 'recording,recording_player,tags,lead_status,source_name,keywords,transcription' });
  return crFetch(env, `/a/${acct}/calls/${encodeURIComponent(String(callId))}.json?${qp.toString()}`);
}

// GET /v3/a/{account}/form_submissions.json — web form leads CallRail captured.
export async function callrailListFormSubmissions(env, { start_date, end_date, per_page = 50, page = 1 } = {}) {
  const acct = await callrailAccountId(env, await callrailKey(env));
  const qp = new URLSearchParams({ per_page: String(Math.min(Number(per_page) || 50, 250)), page: String(page || 1) });
  if (start_date) qp.set('start_date', start_date);
  if (end_date) qp.set('end_date', end_date);
  return crFetch(env, `/a/${acct}/form_submissions.json?${qp.toString()}`);
}

// ─── Recording resolution (stream vs. signed-URL) ────────────────────────────────
// Turns a CallRail recording URL into a fetchable audio URL. Ported from
// resolveCallRecording — returns { url } (signed CDN) or { streamed: true } when
// CallRail returns the audio bytes directly (an authed stream we can't hand off).
export async function resolveRecording(env, recordingUrl) {
  if (!/^https:\/\/api\.callrail\.com\//.test(String(recordingUrl || ''))) {
    throw new Error('Unsupported recording URL — only api.callrail.com recording URLs are allowed (SSRF guard).');
  }
  const apiKey = await callrailKey(env);
  const upstream = await fetch(recordingUrl, { headers: crAuth(apiKey) });
  if (!upstream.ok) throw new Error(`CallRail recording fetch failed (${upstream.status}).`);
  const ct = (upstream.headers.get('Content-Type') || '').toLowerCase();
  if (ct.startsWith('audio/') || ct.includes('octet-stream')) {
    return { streamed: true, content_type: ct, note: 'CallRail streamed the audio directly (authed) — no shareable URL; use callrail_transcribe to get text.' };
  }
  if (ct.includes('application/json')) {
    const data = await upstream.json().catch(() => null);
    const mediaUrl = data && (data.url || data.recording || data.media_url || data.audio_url);
    if (!mediaUrl) throw new Error('CallRail returned JSON with no audio URL.');
    return { url: mediaUrl };
  }
  const snippet = (await upstream.text().catch(() => '')).slice(0, 200);
  throw new Error(`Unexpected CallRail recording response (${upstream.status}, ${ct || 'no content-type'}): ${snippet}`);
}

// ─── Deepgram transcription ──────────────────────────────────────────────────────
// Send a recording URL to Deepgram and return diarized text. Prefers handing
// Deepgram the signed URL (no worker buffering); falls back to posting bytes.
export async function deepgramTranscribeUrl(env, recordingUrl) {
  const dgKey = await deepgramKey(env);
  const rec = await resolveRecording(env, recordingUrl);

  let dgRes;
  if (rec.url) {
    dgRes = await fetch(DG_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${dgKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rec.url }),
    });
  } else {
    // CallRail streamed the audio (authed) — re-fetch with the key and POST bytes.
    const audio = await fetch(recordingUrl, { headers: crAuth(await callrailKey(env)) });
    dgRes = await fetch(DG_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${dgKey}`, 'Content-Type': rec.content_type || 'audio/mpeg' },
      body: await audio.arrayBuffer(),
    });
  }
  if (!dgRes.ok) throw new Error(`Deepgram ${dgRes.status}: ${(await dgRes.text().catch(() => '')).slice(0, 300)}`);
  const json = await dgRes.json();
  const text = formatDeepgramTranscript(json);
  if (!text) throw new Error('Deepgram returned an empty transcript.');
  return { transcription: text, chars: text.length };
}

// Normalize a Deepgram "listen" response into readable, speaker-labeled text.
// Ported verbatim from functions/lib/deepgram.js (kept pure, no network/DB).
function formatDeepgramTranscript(deepgramJson) {
  const alt = deepgramJson && deepgramJson.results && deepgramJson.results.channels &&
    deepgramJson.results.channels[0] && deepgramJson.results.channels[0].alternatives &&
    deepgramJson.results.channels[0].alternatives[0];
  if (!alt) return null;

  const paras = alt.paragraphs && alt.paragraphs.paragraphs;
  if (Array.isArray(paras) && paras.length) {
    const turns = paras.map((p) => {
      const text = (p.sentences || []).map((s) => (typeof s === 'string' ? s : s.text || '')).filter(Boolean).join(' ').trim();
      if (!text) return '';
      const label = Number.isInteger(p.speaker) ? `Speaker ${p.speaker + 1}: ` : '';
      return `${label}${text}`;
    }).filter(Boolean);
    const joined = turns.join('\n\n').trim();
    if (joined) return joined;
  }
  const paraText = alt.paragraphs && alt.paragraphs.transcript;
  if (typeof paraText === 'string' && paraText.trim()) return paraText.trim();
  if (typeof alt.transcript === 'string' && alt.transcript.trim()) return alt.transcript.trim();
  return null;
}
