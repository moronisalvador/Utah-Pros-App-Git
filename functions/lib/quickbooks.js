// QuickBooks Online (Intuit) helper for Cloudflare Workers.
// No SDK — pure fetch(), works in V8 isolates. Mirrors functions/lib/supabase.js.
//
// Tokens live in the `integration_credentials` table (provider = 'quickbooks'),
// readable/writable only by the service-role key. Access tokens last ~1 hour;
// refresh tokens roll forward on each refresh and are persisted automatically.

import { supabase } from './supabase.js';

const PROVIDER      = 'quickbooks';
const TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPE         = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '70';

// ── Environment helpers ────────────────────────────────────────────────────────
export function qboEnvironment(env) {
  return (env.QBO_ENVIRONMENT || 'production').toLowerCase() === 'sandbox'
    ? 'sandbox'
    : 'production';
}

export function apiBase(environment) {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

function basicAuth(env) {
  return 'Basic ' + btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`);
}

// ── OAuth ──────────────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id:     env.QBO_CLIENT_ID,
    response_type: 'code',
    scope:         SCOPE,
    redirect_uri:  env.QBO_REDIRECT_URI,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(env, params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(env),
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    throw new Error(`QBO token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

export function exchangeCodeForTokens(env, code) {
  return postToken(env, {
    grant_type:   'authorization_code',
    code,
    redirect_uri: env.QBO_REDIRECT_URI,
  });
}

export function refreshTokens(env, refreshToken) {
  return postToken(env, {
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
}

// ── Connection persistence ──────────────────────────────────────────────────────
export async function getConnection(env) {
  const db = supabase(env);
  const rows = await db.select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

export async function saveTokens(env, tokens, extra = {}) {
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

// Returns a valid access token, refreshing first if it expires within 5 minutes.
export async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('QuickBooks not connected');

  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await saveTokens(env, tokens, {
      realm_id:    conn.realm_id,
      environment: conn.environment,
    });
  }
  return {
    accessToken: conn.access_token,
    realmId:     conn.realm_id,
    environment: conn.environment || qboEnvironment(env),
  };
}

// ── QuickBooks API ───────────────────────────────────────────────────────────────
export async function qboFetch(env, path, options = {}) {
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

export async function fetchCompanyName(env) {
  try {
    const { realmId } = await getValidAccessToken(env);
    const res = await qboFetch(env, `/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.CompanyInfo?.CompanyName || null;
  } catch {
    return null;
  }
}

// ── Customer mapping + create ────────────────────────────────────────────────────
// Maps a UPR contacts row → a QuickBooks Customer payload.
export function mapContactToCustomer(contact) {
  const name = (contact.name || '').trim();
  const parts = name ? name.split(/\s+/) : [];
  const cust = {
    DisplayName: name || contact.company || `UPR contact ${String(contact.id).slice(0, 8)}`,
  };
  if (parts.length > 1) {
    cust.GivenName  = parts.slice(0, -1).join(' ');
    cust.FamilyName = parts[parts.length - 1];
  } else if (name) {
    cust.GivenName = name;
  }
  if (contact.company) cust.CompanyName     = contact.company;
  if (contact.email)   cust.PrimaryEmailAddr = { Address: contact.email };
  if (contact.phone)   cust.PrimaryPhone     = { FreeFormNumber: contact.phone };

  const addr = {};
  if (contact.billing_address) addr.Line1                  = contact.billing_address;
  if (contact.billing_city)    addr.City                   = contact.billing_city;
  if (contact.billing_state)   addr.CountrySubDivisionCode = contact.billing_state;
  if (contact.billing_zip)     addr.PostalCode             = contact.billing_zip;
  if (Object.keys(addr).length) cust.BillAddr = addr;

  return cust;
}

// Looks up an existing customer by exact DisplayName (dedup before create).
export async function findCustomerByDisplayName(env, displayName) {
  const safe = displayName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${safe}'`;
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const list = data?.QueryResponse?.Customer || [];
  return list[0] || null;
}

export async function createCustomer(env, payload) {
  const res = await qboFetch(env, `/customer?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO create customer ${res.status}`);
    e.qboCode = fault?.code;
    e.status  = res.status;
    throw e;
  }
  return data.Customer;
}
