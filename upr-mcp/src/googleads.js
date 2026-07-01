/**
 * ════════════════════════════════════════════════
 * FILE: googleads.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant ask Google's advertising system how much UPR spent on each
 *   ad campaign, from a Claude chat. It reuses the company's existing Google Ads
 *   sign-in (kept valid automatically) and can run either a ready-made
 *   "spend per campaign per day" report or any custom Google Ads query.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ./supabase.js (reads/refreshes the stored OAuth token)
 *   External API:  Google OAuth (oauth2.googleapis.com), Google Ads API (googleads.googleapis.com)
 *   Data:          reads → integration_credentials (provider='google_ads')
 *                  writes → integration_credentials (refreshed token)
 *   Config:        GOOGLE_ADS_CLIENT_ID/SECRET (token refresh), GOOGLE_ADS_DEVELOPER_TOKEN,
 *                  GOOGLE_ADS_CUSTOMER_ID, optional GOOGLE_ADS_LOGIN_CUSTOMER_ID
 *
 * NOTES / GOTCHAS:
 *   - Token refresh + GAQL query shape ported from functions/lib/google-ads.js.
 *     Reuses UPR's existing google_ads connection (one row in
 *     integration_credentials) — no second authorization.
 *   - The API version (v18), searchStream shape, and GAQL field names are
 *     best-effort from the public reference (same disclosed gap as the app lib) —
 *     confirm against a live developer-token account.
 *   - cost_micros is Google's unit (1,000,000 = $1); campaignSpend divides to $.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const PROVIDER = 'google_ads';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_VERSION = 'v18';

async function getConnection(env) {
  const rows = await supabase(env).select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

async function refreshTokens(env, refreshToken) {
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
    throw new Error('GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET are not configured for the MCP worker.');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google Ads token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Returns a valid access token, refreshing (and persisting) if it expires within 5 min.
async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('Google Ads is not connected in UPR (integration_credentials provider=google_ads is missing a refresh_token).');
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const tokens = await refreshTokens(env, conn.refresh_token);
    const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
    const row = {
      provider: PROVIDER,
      access_token: tokens.access_token,
      token_expires_at: new Date(Date.now() + ttlMs).toISOString(),
      updated_at: new Date().toISOString(),
      connected_by: conn.connected_by,
      connected_at: conn.connected_at,
    };
    await supabase(env).upsert('integration_credentials', row);
    return tokens.access_token;
  }
  return conn.access_token;
}

// Run any GAQL query via searchStream against the configured customer id.
export async function googleAdsQuery(env, query) {
  const accessToken = await getValidAccessToken(env);
  const customerId = String(env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID is not configured for the MCP worker.');
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is not configured for the MCP worker.');

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, '');

  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query: String(query || '').trim() }) },
  );
  if (!res.ok) throw new Error(`Google Ads API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const chunks = await res.json();
  const results = [];
  for (const chunk of Array.isArray(chunks) ? chunks : [chunks]) {
    for (const r of chunk.results || []) results.push(r);
  }
  return results;
}

// Ready-made "spend per campaign per day" report for [startDate, endDate]
// (both 'YYYY-MM-DD'). Ported from fetchCampaignSpend in functions/lib/google-ads.js.
export async function campaignSpend(env, startDate, endDate) {
  const query = `
    SELECT campaign.id, campaign.name, segments.date,
           metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `.trim();
  const rows = await googleAdsQuery(env, query);
  return rows.map((r) => ({
    campaignId: String(r.campaign && r.campaign.id),
    campaignName: r.campaign && r.campaign.name,
    date: r.segments && r.segments.date,
    spend: Number((r.metrics && r.metrics.costMicros) || 0) / 1_000_000,
    impressions: Number((r.metrics && r.metrics.impressions) || 0),
    clicks: Number((r.metrics && r.metrics.clicks) || 0),
    conversions: Number((r.metrics && r.metrics.conversions) || 0),
  }));
}
