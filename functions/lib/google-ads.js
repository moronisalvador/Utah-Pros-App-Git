/**
 * ════════════════════════════════════════════════
 * FILE: google-ads.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Talks to Google's advertising system on the company's behalf: signs in
 *   once via Google's normal "Allow access" screen, keeps that permission
 *   valid automatically, and asks Google how much was spent on each ad
 *   campaign for a given day. No SDK — just direct web requests, the same
 *   style already used for QuickBooks in this codebase.
 *
 * DEPENDS ON:
 *   Packages:      none (uses the platform fetch)
 *   Internal:      ./supabase.js
 *   External API:  Google OAuth 2.0 (accounts.google.com / oauth2.googleapis.com),
 *                  Google Ads API (googleads.googleapis.com)
 *   Data:          reads  → integration_credentials (provider='google_ads')
 *                  writes → integration_credentials (provider='google_ads')
 *
 * NOTES / GOTCHAS:
 *   - MIRRORS functions/lib/quickbooks.js's shape (buildAuthorizeUrl /
 *     exchangeCodeForTokens / refreshTokens / saveTokens / getValidAccessToken)
 *     deliberately, per docs/crm-roadmap.md Phase 2: "Google Ads and Meta both
 *     use real OAuth, so they follow the exact /api/{provider}-connect +
 *     /api/{provider}-callback pattern already proven by quickbooks-connect.js."
 *   - SEPARATE OAUTH APP FROM GOOGLE DRIVE/CALENDAR ON PURPOSE. This repo
 *     already has a GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET pair (google-drive.js)
 *     for per-user Drive/Calendar access (tokens land in user_google_accounts,
 *     one row per employee). Google Ads API access needs its own developer
 *     token application and a single company-wide connection (one row in
 *     integration_credentials, like QBO) — reusing the per-user Drive/Calendar
 *     app would conflate two different consent/storage models, so this uses
 *     its own env vars: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
 *     GOOGLE_ADS_REDIRECT_URI, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID
 *     (+ optional GOOGLE_ADS_LOGIN_CUSTOMER_ID for MCC/manager-account setups).
 *   - GAQL QUERY SHAPE IS BEST-EFFORT, NOT VERIFIED AGAINST A LIVE ACCOUNT
 *     (same disclosed-gap pattern as callrail-webhook.js's payload mapping):
 *     the Google Ads API version pinned below (v18), the searchStream request/
 *     response shape, and the exact GAQL field names are written from the
 *     public API reference, not exercised against a real developer-token
 *     account in this session (the roadmap's own Phase 2 prerequisite —
 *     developer token approval — is an external, days-to-weeks process this
 *     session cannot complete or verify). Confirm against a live account
 *     before the first real cron run; the ad_spend upsert boundary the
 *     mapping feeds is unit/integration-testable independent of this.
 *   - cost_micros is Google's own unit (1,000,000 micros = $1) — divided down
 *     to dollars once, at the edge, in fetchCampaignSpend below.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const PROVIDER      = 'google_ads';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL      = 'https://oauth2.googleapis.com/token';
const SCOPE          = 'https://www.googleapis.com/auth/adwords';
const API_VERSION    = 'v18'; // best-effort — see NOTES

// ── OAuth ──────────────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id:     env.GOOGLE_ADS_CLIENT_ID,
    response_type: 'code',
    scope:         SCOPE,
    redirect_uri:  env.GOOGLE_ADS_REDIRECT_URI,
    access_type:   'offline', // required to receive a refresh_token
    prompt:        'consent', // forces a refresh_token even on a repeat connect
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(env, params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      ...params,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google Ads token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export function exchangeCodeForTokens(env, code) {
  return postToken(env, {
    grant_type:   'authorization_code',
    code,
    redirect_uri: env.GOOGLE_ADS_REDIRECT_URI,
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
    // Google only returns refresh_token on first consent (or prompt=consent) —
    // never overwrite an existing one with an absent value on refresh.
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    token_expires_at: new Date(now + ttlMs).toISOString(),
    environment:      'production',
    updated_at:       new Date(now).toISOString(),
    ...(tokens.scope ? { granted_scopes: tokens.scope } : {}),
    ...extra,
  };
  await db.upsert('integration_credentials', row);
  return row;
}

// Returns a valid access token, refreshing first if it expires within 5 minutes.
export async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('Google Ads not connected');

  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await saveTokens(env, tokens, { connected_by: conn.connected_by, connected_at: conn.connected_at });
  }
  return conn.access_token;
}

// ── Reporting ──────────────────────────────────────────────────────────────────
// Returns [{ campaignId, campaignName, date, spend, impressions, clicks, conversions }]
// for every campaign with activity in [startDate, endDate] (both 'YYYY-MM-DD').
export async function fetchCampaignSpend(env, startDate, endDate) {
  const accessToken = await getValidAccessToken(env);
  const customerId = String(env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID not configured');

  const query = `
    SELECT campaign.id, campaign.name, segments.date,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `.trim();

  const headers = {
    'Authorization':    `Bearer ${accessToken}`,
    'developer-token':  env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type':     'application/json',
  };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');
  }

  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }) },
  );
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const chunks = await res.json();
  const rows = [];
  for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) {
    for (const r of chunk.results || []) {
      rows.push({
        campaignId:   String(r.campaign?.id),
        campaignName: r.campaign?.name,
        date:         r.segments?.date,
        spend:        Number(r.metrics?.costMicros || 0) / 1_000_000,
        impressions:  Number(r.metrics?.impressions || 0),
        clicks:       Number(r.metrics?.clicks || 0),
        conversions:  Number(r.metrics?.conversions || 0),
      });
    }
  }
  return rows;
}
