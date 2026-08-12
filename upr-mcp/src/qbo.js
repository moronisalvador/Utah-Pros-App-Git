/**
 * ════════════════════════════════════════════════
 * FILE: qbo.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the owner-only MCP worker access to UPR's one QuickBooks company. It
 *   refreshes the shared login only when the exact saved credential version
 *   still wins, so a reconnect cannot be overwritten by an older request.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./supabase.js
 *   Data:      reads  → integration_config, integration_credentials
 *              writes → integration_credentials through a conditional PATCH
 *
 * NOTES / GOTCHAS:
 *   - Every database and Intuit request has a 15-second timeout.
 *   - This schema-free foundation deliberately uses the existing credential
 *     row's realm + updated_at as a refresh CAS. The later binding migration
 *     replaces it with the durable company-generation RPC.
 *   - This release intentionally exposes QBO only as a read surface in MCP.
 *     A later durable-command design must replace the mutation boundary before
 *     any MCP write can be re-enabled.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const PROVIDER      = 'quickbooks';
const TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = '70';
const QBO_TIMEOUT_MS = 15_000;
const QBO_PROVIDER_TRAFFIC_KEY = 'qbo_provider_traffic_enabled';

function fetchWithTimeout(url, options = {}) {
  const signal = options.signal || (
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(QBO_TIMEOUT_MS)
      : undefined
  );
  return fetch(url, signal ? { ...options, signal } : options);
}

function apiBase(environment) {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}
function qboEnvironment(env) {
  return (env.QBO_ENVIRONMENT || 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
}
function basicAuth(env) {
  return 'Basic ' + btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`);
}

function qboProviderTrafficDisabledError() {
  const error = new Error('QuickBooks provider traffic is temporarily disabled.');
  error.code = 'qbo_provider_traffic_disabled';
  error.reason = 'qbo_provider_traffic_disabled';
  error.status = 503;
  return error;
}

// This is a release containment boundary, not a configurable kill switch.
// The MCP has no durable QBO-command ledger for create/update/delete/send, so
// allowing a write during maintenance (or merely after an operator flips the
// provider gate) could leave an external side effect without a recoverable
// command record. Keep this ahead of every mutation primitive: it must run
// before any credential lookup, token refresh/CAS, or Intuit request.
export function assertQboMcpMutationDurableBoundary() {
  const error = new Error('QBO MCP mutations require a durable command boundary before they can be enabled.');
  error.code = 'qbo_mcp_mutation_durable_boundary_required';
  error.reason = 'qbo_mcp_mutation_durable_boundary_required';
  error.status = 503;
  throw error;
}

// This is deliberately stricter than the MCP-wide upr_mcp_enabled kill switch.
// A provider request or credential write needs a fresh, exact-true decision
// close to its side effect; a missing/malformed/failed lookup is never an allow.
async function assertQboProviderTrafficEnabled(env) {
  try {
    const rows = await supabase(env, fetchWithTimeout).select(
      'integration_config',
      `key=eq.${QBO_PROVIDER_TRAFFIC_KEY}&select=value&limit=1`,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row || typeof row !== 'object' || !Object.hasOwn(row, 'value') || row.value !== 'true') {
      throw qboProviderTrafficDisabledError();
    }
  } catch (error) {
    if (error?.code === 'qbo_provider_traffic_disabled') throw error;
    throw qboProviderTrafficDisabledError();
  }
}

async function refreshTokens(env, refreshToken) {
  await assertQboProviderTrafficEnabled(env);
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(env),
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) {
    const error = new Error(`QuickBooks token refresh failed (HTTP ${res.status}).`);
    error.code = 'qbo_token_refresh_failed';
    error.status = res.status;
    error.intuitTid = res.headers.get('intuit_tid') || null;
    throw error;
  }
  return res.json();
}

async function getConnection(env) {
  const db = supabase(env, fetchWithTimeout);
  const rows = await db.select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

function connectionChangedError(message = 'QuickBooks connection changed while its token refreshed; retry the MCP request.') {
  const error = new Error(message);
  error.code = 'qbo-connection-changed';
  error.status = 409;
  return error;
}

function snapshotConnection(env, conn) {
  return {
    environment: conn.environment || qboEnvironment(env),
    realmId: conn.realm_id || null,
    updatedAt: conn.updated_at || null,
  };
}

function connectionVersion(conn) {
  return {
    realmId: conn?.realm_id || null,
    updatedAt: conn?.updated_at || null,
  };
}

function connectionMatchesSnapshot(conn, snapshot) {
  return Boolean(conn)
    && String(conn.environment || '') === String(snapshot.environment || '')
    && String(conn.realm_id || '') === String(snapshot.realmId || '')
    && String(conn.updated_at || '') === String(snapshot.updatedAt || '');
}

// Re-read the existing credential immediately before an allowed read reaches
// Intuit. A reconnect changes realm/environment/updated_at, so the old request
// fails before it can cross into the replacement company.
async function assertReadConnectionSnapshot(env, snapshot) {
  const connection = await getConnection(env);
  if (!connectionMatchesSnapshot(connection, snapshot)) {
    throw connectionChangedError('QuickBooks connection changed before the MCP read could be dispatched; retry the request.');
  }
}

async function refreshConnectionCas(env, tokens, expectedConnection) {
  await assertQboProviderTrafficEnabled(env);
  const db = supabase(env, fetchWithTimeout);
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
  if (!expectedConnection.realm_id || !expectedConnection.updated_at) {
    throw connectionChangedError('QuickBooks credential version is missing; reconnect before retrying.');
  }
  const rows = await db.update(
    'integration_credentials',
    `provider=eq.${PROVIDER}`
      + `&realm_id=eq.${encodeURIComponent(String(expectedConnection.realm_id))}`
      + `&updated_at=eq.${encodeURIComponent(String(expectedConnection.updated_at))}`,
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || expectedConnection.refresh_token,
      token_expires_at: new Date(Date.now() + ttlMs).toISOString(),
      updated_at: new Date().toISOString(),
      ...(tokens.scope ? { granted_scopes: tokens.scope } : {}),
    },
  );
  if (!Array.isArray(rows) || rows.length !== 1
      || String(rows[0].realm_id) !== String(expectedConnection.realm_id)) {
    throw connectionChangedError();
  }
  const current = await getConnection(env);
  const written = connectionVersion(rows[0]);
  if (!current
      || String(current.realm_id || '') !== String(written.realmId || '')
      || String(current.updated_at || '') !== String(written.updatedAt || '')) {
    throw connectionChangedError();
  }
  return current;
}

async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('QuickBooks not connected in UPR (integration_credentials missing).');
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const expected = conn;
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await refreshConnectionCas(env, tokens, expected);
  }
  const snapshot = snapshotConnection(env, conn);
  if (!snapshot.realmId) throw connectionChangedError('QuickBooks credential realm is missing; reconnect before retrying.');
  return {
    accessToken: conn.access_token,
    realmId: snapshot.realmId,
    environment: snapshot.environment,
    snapshot,
  };
}

// Low-level QBO fetch. `path` begins with '/' (e.g. '/invoice').
async function qboFetch(env, path, options = {}) {
  await assertQboProviderTrafficEnabled(env);
  const { accessToken, realmId, environment, snapshot } = await getValidAccessToken(env);
  await assertReadConnectionSnapshot(env, snapshot);
  await assertQboProviderTrafficEnabled(env);
  const url = `${apiBase(environment)}/v3/company/${realmId}${path}`;
  return fetchWithTimeout(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
}

async function asError(res, data, fallback) {
  const e = new Error(`${fallback} (HTTP ${res.status}).`);
  e.code = 'qbo_provider_request_failed';
  e.status = res.status;
  e.intuitTid = res.headers.get('intuit_tid') || null;
  return e;
}

// ── Generic primitives (cover every entity, full read+write) ──────────────────

// Read-only SQL passthrough. Rejects anything that isn't a SELECT.
export async function qboQuery(env, sql) {
  const s = String(sql || '').trim();
  if (!/^select\s/i.test(s)) throw new Error('Only SELECT statements are allowed in qbo_query.');
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(s)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, 'QBO query failed');
  return data.QueryResponse || {};
}

const ENTITY_PATH = (entity) => `/${String(entity).toLowerCase()}`;
const ENTITY_NAME = (entity) => String(entity).charAt(0).toUpperCase() + String(entity).slice(1).toLowerCase();

// Fetch a single entity (incl. its SyncToken) by Id.
export async function qboGet(env, entity, id) {
  const qr = await qboQuery(env, `SELECT * FROM ${ENTITY_NAME(entity)} WHERE Id = '${String(id).replace(/'/g, "\\'")}'`);
  const arr = qr[ENTITY_NAME(entity)];
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function qboCreate(env, entity, payload) {
  assertQboMcpMutationDurableBoundary();
  const res = await qboFetch(env, `${ENTITY_PATH(entity)}?minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, `QBO create ${entity} failed`);
  return data[ENTITY_NAME(entity)];
}

// Sparse update: fetches current SyncToken, then sends only the changed fields.
// Unspecified fields are preserved by QBO (sparse semantics).
export async function qboSparseUpdate(env, entity, id, fields) {
  assertQboMcpMutationDurableBoundary();
  const current = await qboGet(env, entity, id);
  if (!current || current.SyncToken == null) throw new Error(`${entity} ${id} not found in QBO.`);
  const res = await qboFetch(env, `${ENTITY_PATH(entity)}?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    body: JSON.stringify({ Id: String(id), SyncToken: current.SyncToken, sparse: true, ...fields }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, `QBO update ${entity} failed`);
  return data[ENTITY_NAME(entity)];
}

export async function qboDelete(env, entity, id) {
  assertQboMcpMutationDurableBoundary();
  const current = await qboGet(env, entity, id);
  if (!current || current.SyncToken == null) throw new Error(`${entity} ${id} not found in QBO.`);
  const res = await qboFetch(env, `${ENTITY_PATH(entity)}?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify({ Id: String(id), SyncToken: current.SyncToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, `QBO delete ${entity} failed`);
  return data;
}

// Reports: /reports/{name} (ProfitAndLoss, BalanceSheet, AgedReceivables, ...).
export async function qboReport(env, name, params = {}) {
  const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION }).toString();
  const res = await qboFetch(env, `/reports/${name}?${qs}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, `QBO report ${name} failed`);
  return data;
}

// Email a transaction (Invoice/Estimate) to the customer. Omitting sendTo uses
// the transaction's billing email. If QBO Payments is enabled, the emailed
// invoice includes a pay-now link.
export async function qboSend(env, entity, id, sendTo) {
  assertQboMcpMutationDurableBoundary();
  const path = `${ENTITY_PATH(entity)}/${id}/send?minorversion=${MINOR_VERSION}${sendTo ? `&sendTo=${encodeURIComponent(sendTo)}` : ''}`;
  const res = await qboFetch(env, path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, `QBO send ${entity} failed`);
  return data[ENTITY_NAME(entity)];
}
