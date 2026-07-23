/**
 * ════════════════════════════════════════════════
 * FILE: encircle.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the owner-only MCP worker read and carefully confirmed write access to
 *   Encircle. It uses the same managed database key as the main app, while the
 *   old Worker secret remains a temporary fallback until rotation is complete.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./supabase.js
 *   Data:      reads → integration_credentials
 *              writes → Encircle only through explicitly invoked tools
 *
 * NOTES / GOTCHAS:
 *   - An explicit managed "disabled" state suppresses the Worker-secret fallback.
 *   - Encircle credentials are intentionally not cached, so disable is immediate.
 * ════════════════════════════════════════════════
 */
import { supabase } from './supabase.js';

// Encircle API layer for the MCP worker.
// Encircle is UPR's claims source-of-truth. This module exposes the Encircle
// REST API to the assistant so it can read AND (carefully) write claims, notes,
// media, rooms, assignments, etc. — e.g. recover the TRUE claim-filed date
// (date_claim_created — the live API does NOT return a created_at field) the UPR
// import never persisted, write our CLM number back onto a
// claim, pull a claim's photos, or post a note. Auth reuses the SAME token the
// Cloudflare Pages functions use: Bearer ENCIRCLE_API_KEY (set as an MCP worker
// secret). Base: https://api.encircleapp.com — see ENCIRCLE_API_REFERENCE.md.
//
// Design: a generic core (encircleGet / encircleRequest) makes the MCP capable
// of almost any Encircle endpoint; the named exports below are thin, documented
// conveniences over the highest-value endpoints.

const BASE = 'https://api.encircleapp.com';
const ENCIRCLE_TIMEOUT_MS = 15_000;

function fetchWithTimeout(url, options = {}) {
  const signal = options.signal || (
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ENCIRCLE_TIMEOUT_MS)
      : undefined
  );
  return fetch(url, signal ? { ...options, signal } : options);
}

export function clearEncircleCredentialCache() {
  // Kept as a stable test/rotation seam. Encircle is intentionally uncached.
}

export async function resolveEncircleApiKey(env) {
  if (env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const rows = await supabase(env).select(
        'integration_credentials',
        'provider=eq.encircle&select=access_token,managed_status&limit=1',
      );
      const row = rows?.[0];
      if (row?.managed_status === 'disabled') {
        return { apiKey: undefined, source: 'disabled' };
      }
      if (row?.managed_status === 'active' && String(row.access_token || '').trim()) {
        return { apiKey: String(row.access_token).trim(), source: 'managed' };
      }
    } catch {
      // Pre-migration schema or transient DB failure: keep the legacy secret as
      // the zero-downtime rollback path.
    }
  }
  const fallback = String(env?.ENCIRCLE_API_KEY || '').trim();
  return {
    apiKey: fallback || undefined,
    source: fallback ? 'environment' : 'unconfigured',
  };
}

// Core fetch. `path` begins with '/'. Handles 204 (→ null) and non-JSON bodies,
// and surfaces Encircle's error message. options.method/body for writes.
async function encircleFetch(env, path, options = {}) {
  const { apiKey } = await resolveEncircleApiKey(env);
  if (!apiKey) {
    throw new Error('Encircle is not configured for the MCP worker.');
  }
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Encircle-Attribution': 'UtahProsRestorationApp',
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    throw new Error(`Encircle ${options.method || 'GET'} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return data;
}

// ─── Generic power tools (reach any endpoint) ────────────────────────────────
export async function encircleGet(env, path) {
  return encircleFetch(env, path.startsWith('/') ? path : `/${path}`);
}
export async function encircleRequest(env, method, path, body) {
  return encircleFetch(env, path.startsWith('/') ? path : `/${path}`, {
    method: String(method || 'POST').toUpperCase(),
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
}

// ─── Claims ──────────────────────────────────────────────────────────────────
// GET /v1/property_claims/{id} — full claim incl. date_claim_created (true filed
// date; the live API returns date_claim_created, NOT created_at), date_of_loss,
// status, full_address, policyholder, contractor_identifier (CLM).
export async function encircleGetClaim(env, claimId) {
  return encircleFetch(env, `/v1/property_claims/${encodeURIComponent(String(claimId))}`);
}

// GET /v1/property_claims — list/search. Supports policyholder_name,
// contractor_identifier (our CLM), assignment_identifier, insurer_identifier,
// plus limit/order/after (cursor). Returns { list, cursor } so paging is usable.
export async function encircleListClaims(env, opts = {}) {
  const { limit = 50, order = 'newest', after, policyholder_name, contractor_identifier, assignment_identifier, insurer_identifier } = opts;
  const qp = { limit: String(Math.min(Number(limit) || 50, 100)), order };
  if (after) qp.after = after;
  if (policyholder_name) qp.policyholder_name = policyholder_name;
  if (contractor_identifier) qp.contractor_identifier = contractor_identifier;
  if (assignment_identifier) qp.assignment_identifier = assignment_identifier;
  if (insurer_identifier) qp.insurer_identifier = insurer_identifier;
  const data = await encircleFetch(env, `/v1/property_claims?${new URLSearchParams(qp).toString()}`);
  if (data && Array.isArray(data.list)) return { list: data.list, cursor: data.cursor || null };
  const list = Array.isArray(data) ? data : (data.property_claims || data.results || data.claims || data.data || []);
  return { list, cursor: null };
}

// PATCH /v1/property_claims/{id} — update claim fields (e.g. write our CLM number
// into contractor_identifier, set date_claim_created/date_of_loss). fields is a
// raw Encircle claim patch — see ENCIRCLE_API_REFERENCE.md "Update Claim".
export async function encircleUpdateClaim(env, claimId, fields) {
  return encircleRequest(env, 'PATCH', `/v1/property_claims/${encodeURIComponent(String(claimId))}`, fields);
}

// POST /v1/property_claims — create a claim. policyholder_name is required.
export async function encircleCreateClaim(env, fields) {
  return encircleRequest(env, 'POST', '/v1/property_claims', fields);
}

// ─── Web app deep link (302 → Location) ──────────────────────────────────────
// GET /v1/property_claims/{id}/webapp_redirect returns a 302 to the Encircle web
// app. We read the Location header manually so the tool returns the URL itself.
export async function encircleWebappLink(env, claimId) {
  const { apiKey } = await resolveEncircleApiKey(env);
  if (!apiKey) throw new Error('Encircle is not configured for the MCP worker.');
  const res = await fetchWithTimeout(`${BASE}/v1/property_claims/${encodeURIComponent(String(claimId))}/webapp_redirect`, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'X-Encircle-Attribution': 'UtahProsRestorationApp' },
  });
  const location = res.headers.get('location');
  if (location) return { url: location };
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Encircle webapp_redirect ${claimId} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
