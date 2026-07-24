/**
 * ════════════════════════════════════════════════
 * FILE: callrail-api.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place that figures out WHICH CallRail account we're pulling data
 *   from. CallRail's call list lives at /v3/a/{account}/calls, so we need the
 *   account id — but the person connecting only pastes an API key, not an id.
 *   This looks the id up: first from what we've already saved, then from a
 *   server setting, and if neither exists it asks CallRail's API for it (the
 *   key can list its own accounts) and saves it for next time.
 *
 * WHERE IT LIVES:
 *   Non-pure CallRail helper (touches the DB + CallRail's REST API). Kept
 *   separate from the pure predicates in callrail.js on purpose.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      the worker-side supabase client is passed in
 *   External API:  CallRail REST API v3 (api.callrail.com/v3/a.json)
 *   Data:          reads  → integration_config (key='callrail_account_id')
 *                  writes → integration_config (stores it on first discovery)
 *
 * NOTES / GOTCHAS:
 *   - An API key can see more than one CallRail account; we take the first.
 *     A future multi-tenant version would let the connector pick, but UPR has
 *     exactly one account today.
 *   - Returns null (never throws) when the id can't be determined — callers
 *     surface a clear "couldn't determine the account" error instead.
 *   - resolveCallRecording() is the one place that turns a CallRail recording
 *     URL into playable audio: CallRail's recording endpoint either streams the
 *     audio directly OR returns JSON pointing at a short-lived signed CDN URL.
 *     Shared by callrail-recording.js (streams it to the browser) and
 *     transcribe-call.js (hands the signed URL to Deepgram, or the bytes).
 * ════════════════════════════════════════════════
 */

import { fetchWithTimeout } from './http.js';

const authHeader = (apiKey) => ({ Authorization: `Token token="${apiKey}"` });
const CALLRAIL_API_ROOT = 'https://api.callrail.com/v3';
const DISCOVERY_PAGE_SIZE = 250;
const MAX_DISCOVERY_PAGES = 4;
const DISCOVERY_REQUEST_TIMEOUT_MS = 5_000;

export class CallRailDiscoveryError extends Error {
  constructor(code, status = 503) {
    super('CallRail messaging options are temporarily unavailable.');
    this.name = 'CallRailDiscoveryError';
    this.code = code;
    this.status = status;
  }
}

async function fetchDiscoveryPage(url, apiKey, fetcher) {
  let response;
  try {
    response = await fetcher(
      url,
      { headers: authHeader(apiKey) },
      DISCOVERY_REQUEST_TIMEOUT_MS,
    );
  } catch {
    throw new CallRailDiscoveryError('CALLRAIL_DISCOVERY_UNAVAILABLE');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new CallRailDiscoveryError('CALLRAIL_CREDENTIAL_REJECTED');
    }
    if (response.status === 429) {
      throw new CallRailDiscoveryError('CALLRAIL_DISCOVERY_RATE_LIMITED', 429);
    }
    throw new CallRailDiscoveryError('CALLRAIL_DISCOVERY_UNAVAILABLE');
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new CallRailDiscoveryError('CALLRAIL_DISCOVERY_INVALID_RESPONSE');
  }
  return body;
}

/**
 * Read-only inventory of CallRail numbers eligible for staff P2P messaging.
 * It deliberately excludes destination numbers and call-flow details.
 */
export async function discoverCallRailMessagingOptions(apiKey, {
  accountId,
  fetcher = fetchWithTimeout,
  maxPages = MAX_DISCOVERY_PAGES,
} = {}) {
  if (!apiKey) throw new CallRailDiscoveryError('CALLRAIL_CREDENTIAL_MISSING');
  const resolvedAccountId = String(accountId || '').trim();
  if (!resolvedAccountId) {
    throw new CallRailDiscoveryError('CALLRAIL_ACCOUNT_ID_MISSING');
  }
  const grouped = new Map();
  const pageLimit = Math.min(
    Math.max(Number(maxPages) || 1, 1),
    MAX_DISCOVERY_PAGES,
  );

  for (let page = 1; page <= pageLimit; page += 1) {
    const body = await fetchDiscoveryPage(
      `${CALLRAIL_API_ROOT}/a/${encodeURIComponent(resolvedAccountId)}/trackers.json?per_page=${DISCOVERY_PAGE_SIZE}&page=${page}`,
      apiKey,
      fetcher,
    );
    const trackers = Array.isArray(body.trackers) ? body.trackers : [];
    for (const tracker of trackers) {
      if (
        tracker?.status !== 'active'
        || tracker?.sms_supported !== true
        || tracker?.sms_enabled !== true
      ) continue;

      const companyId = String(tracker?.company?.id || '').trim();
      if (!companyId) continue;
      if (!grouped.has(companyId)) {
        grouped.set(companyId, {
          id: companyId,
          name: String(tracker.company?.name || 'CallRail company'),
          senders: [],
        });
      }
      const company = grouped.get(companyId);
      const numbers = Array.isArray(tracker.tracking_numbers)
        ? tracker.tracking_numbers
        : [];
      for (const number of numbers) {
        const trackingNumber = String(number || '').trim();
        if (!trackingNumber) continue;
        company.senders.push({
          option_id: `${tracker.id}:${trackingNumber}`,
          tracker_id: String(tracker.id || ''),
          tracker_name: String(tracker.name || 'CallRail tracker'),
          tracker_type: String(tracker.type || 'unknown'),
          tracking_number: trackingNumber,
          sms_supported: true,
          sms_enabled: true,
        });
      }
    }

    const totalPages = Number(body.total_pages) || 1;
    if (totalPages > pageLimit) {
      throw new CallRailDiscoveryError('CALLRAIL_DISCOVERY_TRUNCATED');
    }
    if (page >= totalPages) break;
  }

  return Array.from(grouped.values()).filter((company) => company.senders.length > 0);
}

/**
 * Resolve the CallRail account id. Order: saved config → env (back-compat) →
 * discover via the API (and persist it). Returns a string id or null.
 */
export async function resolveCallRailAccountId(db, apiKey, env) {
  const [cfg] = await db.select('integration_config', 'key=eq.callrail_account_id&select=value');
  if (cfg?.value) return String(cfg.value);

  if (env?.CALLRAIL_ACCOUNT_ID) return String(env.CALLRAIL_ACCOUNT_ID);

  if (!apiKey) return null;

  const res = await fetchWithTimeout('https://api.callrail.com/v3/a.json', { headers: authHeader(apiKey) });
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  const id = (data.accounts || [])[0]?.id;
  if (!id) return null;

  // Persist for next time (guard against a concurrent insert racing us).
  const [existing] = await db.select('integration_config', 'key=eq.callrail_account_id&select=value');
  if (!existing) {
    await db.insert('integration_config', { key: 'callrail_account_id', value: String(id) });
  }
  return String(id);
}

/**
 * Resolve every documented identity for one configured CallRail account.
 *
 * Older UPR connections cached CallRail's numeric account id, while current
 * MMS media URLs use the masked `ACC...` resource id. CallRail exposes
 * `numeric_id` through field selection, so this lookup proves that both
 * identities belong to the same API-visible account instead of trusting an
 * arbitrary account segment from a webhook URL.
 */
export async function resolveCallRailAccountAliases(apiKey, configuredAccountId, {
  fetcher = fetchWithTimeout,
  maxPages = MAX_DISCOVERY_PAGES,
} = {}) {
  const configured = String(configuredAccountId || '').trim();
  if (!apiKey || !configured) {
    throw new CallRailDiscoveryError('CALLRAIL_ACCOUNT_ID_MISSING');
  }
  const pageLimit = Math.min(
    Math.max(Number(maxPages) || 1, 1),
    MAX_DISCOVERY_PAGES,
  );
  const accounts = [];
  for (let page = 1; page <= pageLimit; page += 1) {
    const body = await fetchDiscoveryPage(
      `${CALLRAIL_API_ROOT}/a.json?fields=numeric_id&per_page=250&page=${page}`,
      apiKey,
      fetcher,
    );
    accounts.push(...(Array.isArray(body.accounts) ? body.accounts : []));
    const totalPages = Number(body.total_pages) || 1;
    if (totalPages > pageLimit) {
      throw new CallRailDiscoveryError('CALLRAIL_DISCOVERY_TRUNCATED');
    }
    if (page >= totalPages) break;
  }
  const match = accounts.find((account) => (
    String(account?.id || '') === configured
    || String(account?.numeric_id || '') === configured
  ));
  if (!match?.id) return null;

  return Array.from(new Set([
    configured,
    String(match.id),
    match.numeric_id == null ? null : String(match.numeric_id),
  ].filter(Boolean)));
}

/**
 * Resolve a CallRail recording URL to playable audio. CallRail's recording
 * endpoint responds one of two ways, and this normalizes both:
 *   { kind: 'url',    url }             — a short-lived signed CDN URL that is
 *                                         publicly fetchable WITHOUT our API key
 *                                         (what Deepgram's URL-ingest needs).
 *   { kind: 'stream', response, contentType }
 *                                       — CallRail streamed the audio directly
 *                                         (already authed); consume response.body.
 *   { kind: 'error',  status, reason, contentType?, detail?, snippet? }
 *                                       — surfaces exactly what went wrong.
 * Never throws on a bad HTTP response — returns an 'error' shape so callers can
 * report a precise reason instead of a silent dead player.
 */
export async function resolveCallRecording(apiKey, recordingUrl) {
  // Guard the fetch: some URLs (notably CallRail's app.callrail.com signed
  // "recording/redirect" links) THROW when fetched server-side with the auth
  // header. Unhandled, that crashes the Worker → Cloudflare returns a raw 502
  // (text/html). Catch it so callers always get a clean error shape instead.
  let upstream;
  try {
    upstream = await fetchWithTimeout(recordingUrl, { headers: authHeader(apiKey) });
  } catch (e) {
    return { kind: 'error', status: 0, reason: 'fetch-failed', detail: String(e?.message || e) };
  }
  if (!upstream.ok || !upstream.body) {
    return { kind: 'error', status: upstream.status, reason: 'fetch-failed' };
  }

  const ct = (upstream.headers.get('Content-Type') || '').toLowerCase();

  // CallRail streamed the audio directly — hand back the authed response.
  if (ct.startsWith('audio/') || ct.includes('octet-stream')) {
    return { kind: 'stream', response: upstream, contentType: ct };
  }

  // CallRail returned JSON describing WHERE the audio lives (a signed URL).
  if (ct.includes('application/json')) {
    const data = await upstream.json().catch(() => null);
    const mediaUrl = data && (data.url || data.recording || data.media_url || data.audio_url);
    if (!mediaUrl) {
      return { kind: 'error', status: upstream.status, reason: 'json-no-url', detail: data };
    }
    return { kind: 'url', url: mediaUrl };
  }

  // Something unexpected (HTML error page, redirect stub, …) — keep a snippet.
  const snippet = (await upstream.text().catch(() => '')).slice(0, 300);
  return { kind: 'error', status: upstream.status, reason: 'unexpected', contentType: ct, snippet };
}

/**
 * Coerce CallRail's `transcription` field into plain text. CallRail may return
 * it as a string, an object (`{ text }` / `{ transcript }`), or an array of
 * segments (`[{ text }, …]`) depending on the Conversation Intelligence shape —
 * so this normalizes to a single string (or null) for the `inbound_leads.transcription`
 * text column. Best-effort; unverified against the live account.
 */
export function transcriptText(t) {
  if (!t) return null;
  if (typeof t === 'string') return t.trim() || null;
  if (Array.isArray(t)) {
    const joined = t
      .map((seg) => (typeof seg === 'string' ? seg : seg?.text || seg?.sentence || seg?.transcript || ''))
      .filter(Boolean)
      .join(' ')
      .trim();
    return joined || null;
  }
  if (typeof t === 'object') return (t.text || t.transcript || '').trim() || null;
  return null;
}
