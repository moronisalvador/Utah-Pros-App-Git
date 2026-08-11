/**
 * ════════════════════════════════════════════════
 * FILE: qbo.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives the owner-only MCP worker access to UPR's one QuickBooks company. It
 *   refreshes the shared login only when the exact saved version still wins,
 *   so a reconnect cannot be overwritten by an older request.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./supabase.js
 *   Data:      reads  → integration_config, integration_credentials,
 *                       qbo_company_binding
 *              writes → integration_credentials and qbo_company_binding through
 *                       refresh_qbo_connection_cas
 *
 * NOTES / GOTCHAS:
 *   - Every database and Intuit request has a 15-second timeout.
 *   - Before the binding migration, an expired MCP token fails closed instead
 *     of restoring the former blind credential upsert.
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

function isBindingTableUnavailable(error) {
  const message = String(error?.message || '');
  return /\b(?:42P01|PGRST205)\b/.test(message)
    || (/qbo_company_binding/i.test(message) && /(?:does not exist|schema cache|not find)/i.test(message));
}

async function getCompanyBinding(env) {
  const db = supabase(env, fetchWithTimeout);
  try {
    const rows = await db.select(
      'qbo_company_binding',
      'singleton=eq.true&select=environment,realm_id,generation&limit=1',
    );
    return { available: true, binding: rows?.[0] || null };
  } catch (error) {
    if (isBindingTableUnavailable(error)) return { available: false, binding: null };
    throw error;
  }
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
    generation: conn.qbo_binding_generation ?? null,
  };
}

function connectionMatchesSnapshot(conn, snapshot) {
  return Boolean(conn)
    && String(conn.environment || '') === String(snapshot.environment || '')
    && String(conn.realm_id || '') === String(snapshot.realmId || '')
    && String(conn.qbo_binding_generation ?? '') === String(snapshot.generation ?? '');
}

function bindingMatchesSnapshot(binding, snapshot) {
  return Boolean(binding)
    && String(binding.environment || '') === String(snapshot.environment || '')
    && String(binding.realm_id || '') === String(snapshot.realmId || '')
    && String(binding.generation ?? '') === String(snapshot.generation ?? '');
}

// Re-read both sources immediately before an allowed read reaches Intuit. The
// credential and immutable company binding must still describe the exact
// snapshot used to construct the company URL; a reconnect therefore fails
// before a request can cross into a different QBO realm.
async function assertReadBindingSnapshot(env, snapshot) {
  const [connection, bindingState] = await Promise.all([getConnection(env), getCompanyBinding(env)]);
  if (!bindingState.available
      || !connectionMatchesSnapshot(connection, snapshot)
      || !bindingMatchesSnapshot(bindingState.binding, snapshot)) {
    throw connectionChangedError('QuickBooks company binding changed before the MCP read could be dispatched; retry the request.');
  }
}

async function refreshConnectionCas(env, tokens, expectedConnection) {
  await assertQboProviderTrafficEnabled(env);
  const db = supabase(env, fetchWithTimeout);
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
  const result = await db.rpc('refresh_qbo_connection_cas', {
    p_expected_environment: expectedConnection.environment || qboEnvironment(env),
    p_expected_realm_id: expectedConnection.realm_id,
    p_expected_generation: expectedConnection.qbo_binding_generation,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token || null,
    p_token_expires_at: new Date(Date.now() + ttlMs).toISOString(),
    p_granted_scopes: tokens.scope || null,
  });
  const outcome = Array.isArray(result) ? result[0] : result;
  if (!outcome?.ok) throw connectionChangedError();
  const current = await getConnection(env);
  if (!current
      || String(current.realm_id) !== String(expectedConnection.realm_id)
      || String(current.qbo_binding_generation) !== String(outcome.generation)) {
    throw connectionChangedError();
  }
  return current;
}

async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('QuickBooks not connected in UPR (integration_credentials missing).');
  const { available, binding } = await getCompanyBinding(env);
  if (!available || !binding
    || String(binding.realm_id) !== String(conn.realm_id)
    || String(binding.environment) !== String(conn.environment || qboEnvironment(env))
    || String(binding.generation) !== String(conn.qbo_binding_generation)) {
    throw connectionChangedError('QuickBooks company binding does not match the MCP credential; reconnect before retrying.');
  }
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    if (!available || conn.qbo_binding_generation == null) {
      throw connectionChangedError('QuickBooks binding migration is required before the MCP can refresh this login.');
    }
    await assertQboProviderTrafficEnabled(env);
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await refreshConnectionCas(env, tokens, conn);
  }
  const refreshedBinding = await getCompanyBinding(env);
  const snapshot = snapshotConnection(env, conn);
  if (!refreshedBinding.available || !bindingMatchesSnapshot(refreshedBinding.binding, snapshot)) {
    throw connectionChangedError('QuickBooks company binding changed while the MCP login was being prepared; retry the request.');
  }
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
  await assertQboProviderTrafficEnabled(env);
  await assertReadBindingSnapshot(env, snapshot);
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
