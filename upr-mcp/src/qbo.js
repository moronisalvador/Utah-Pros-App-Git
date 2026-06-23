// QuickBooks Online API layer for the MCP worker.
// Token logic is ported verbatim from functions/lib/quickbooks.js so this worker
// reuses the SAME UPR<->QBO connection: tokens live in Supabase
// `integration_credentials` (provider = 'quickbooks'), refreshed automatically.
// No second QBO authorization is needed — UPR is already connected.

import { supabase } from './supabase.js';

const PROVIDER      = 'quickbooks';
const TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const MINOR_VERSION = '70';

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

async function refreshTokens(env, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(env),
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || '';
    throw new Error(`QBO token endpoint ${res.status}${tid ? ` [tid ${tid}]` : ''}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function getConnection(env) {
  const db = supabase(env);
  const rows = await db.select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

async function saveTokens(env, tokens, extra = {}) {
  const db = supabase(env);
  const now = Date.now();
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
  const row = {
    provider:         PROVIDER,
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token,
    token_expires_at: new Date(now + ttlMs).toISOString(),
    updated_at:       new Date(now).toISOString(),
    ...extra,
  };
  await db.upsert('integration_credentials', row);
  return row;
}

async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('QuickBooks not connected in UPR (integration_credentials missing).');
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await saveTokens(env, tokens, { realm_id: conn.realm_id, environment: conn.environment });
  }
  return {
    accessToken: conn.access_token,
    realmId:     conn.realm_id,
    environment: conn.environment || qboEnvironment(env),
  };
}

// Low-level QBO fetch. `path` begins with '/' (e.g. '/invoice').
async function qboFetch(env, path, options = {}) {
  const { accessToken, realmId, environment } = await getValidAccessToken(env);
  const url = `${apiBase(environment)}/v3/company/${realmId}${path}`;
  return fetch(url, {
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
  const fault = data?.Fault?.Error?.[0];
  const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `${fallback} (HTTP ${res.status})`);
  e.qboCode = fault?.code;
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
  const path = `${ENTITY_PATH(entity)}/${id}/send?minorversion=${MINOR_VERSION}${sendTo ? `&sendTo=${encodeURIComponent(sendTo)}` : ''}`;
  const res = await qboFetch(env, path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw await asError(res, data, `QBO send ${entity} failed`);
  return data[ENTITY_NAME(entity)];
}
