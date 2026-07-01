/**
 * ════════════════════════════════════════════════
 * FILE: meta-ads.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Talks to Meta's (Facebook/Instagram) advertising system on the company's
 *   behalf: signs in once via Facebook's "Allow access" screen, keeps that
 *   permission valid, and asks Meta how much was spent on each ad campaign
 *   for a given day. No SDK — direct web requests, same style as
 *   quickbooks.js / google-ads.js.
 *
 * DEPENDS ON:
 *   Packages:      none (uses the platform fetch)
 *   Internal:      ./supabase.js
 *   External API:  Meta OAuth (facebook.com/dialog/oauth,
 *                  graph.facebook.com/oauth/access_token),
 *                  Meta Marketing API — Insights (graph.facebook.com)
 *   Data:          reads  → integration_credentials (provider='meta_ads')
 *                  writes → integration_credentials (provider='meta_ads')
 *
 * NOTES / GOTCHAS:
 *   - FOLLOWS THE SAME CONNECT/CALLBACK OAUTH SHAPE AS GOOGLE ADS/QBO, per
 *     docs/crm-roadmap.md's explicit design decision ("Google Ads and Meta
 *     both use real OAuth ... follow the exact /api/{provider}-connect +
 *     /api/{provider}-callback pattern"). The roadmap's earlier research
 *     section also floats a simpler "paste a long-lived System User token"
 *     option (generated manually in Business Manager, no redirect flow) —
 *     that's a legitimate alternative for a future session if the OAuth
 *     consent-screen review step turns out to be friction, but this build
 *     follows the locked design-decision section, not the earlier research
 *     framing.
 *   - META TOKENS DON'T USE A CLASSIC refresh_token GRANT. A short-lived
 *     user token (from the code exchange, ~1-2h) is exchanged once for a
 *     long-lived token (~60 days). To keep the connection alive past that,
 *     getValidAccessToken re-exchanges the CURRENT long-lived token for a
 *     fresh 60-day one (Meta supports re-exchanging a still-valid long-lived
 *     token) — this only works while the token hasn't fully expired, so a
 *     connection left untouched for 60+ days needs a manual reconnect via
 *     the Integrations page. refresh_token is intentionally never set.
 *   - INSIGHTS API SHAPE IS BEST-EFFORT, NOT VERIFIED AGAINST A LIVE AD
 *     ACCOUNT (same disclosed-gap pattern as google-ads.js/callrail-webhook.js):
 *     the API version, the `actions` field shape Meta uses for conversions,
 *     and exact response field names are written from the public Graph API
 *     reference, not exercised live. `platform_conversions` is deliberately
 *     informational only (per the roadmap), so this sums every `actions`
 *     entry's value rather than filtering to a specific action_type — a
 *     coarse total, not meant to reconcile with CallRail's lead counts.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const PROVIDER    = 'meta_ads';
const API_VERSION = 'v19.0'; // best-effort — see NOTES
const DIALOG_URL   = `https://www.facebook.com/${API_VERSION}/dialog/oauth`;
const GRAPH_BASE   = `https://graph.facebook.com/${API_VERSION}`;
const SCOPE         = 'ads_read';

// ── OAuth ──────────────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id:     env.META_APP_ID,
    redirect_uri:  env.META_REDIRECT_URI,
    scope:         SCOPE,
    response_type: 'code',
    state,
  });
  return `${DIALOG_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(env, code) {
  const params = new URLSearchParams({
    client_id:     env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri:  env.META_REDIRECT_URI,
    code,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function exchangeForLongLivedToken(env, shortLivedToken) {
  const params = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:          env.META_APP_ID,
    client_secret:       env.META_APP_SECRET,
    fb_exchange_token:   shortLivedToken,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta long-lived token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
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
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 60 * 24 * 60 * 60) * 1000;
  const row = {
    provider:         PROVIDER,
    access_token:     tokens.access_token,
    token_expires_at: new Date(now + ttlMs).toISOString(),
    environment:      'production',
    updated_at:       new Date(now).toISOString(),
    ...extra,
  };
  await db.upsert('integration_credentials', row);
  return row;
}

// Returns a valid access token, re-exchanging for a fresh long-lived token
// first if the current one expires within 5 days.
export async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.access_token) throw new Error('Meta Ads not connected');

  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 24 * 60 * 60 * 1000) {
    const tokens = await exchangeForLongLivedToken(env, conn.access_token);
    conn = await saveTokens(env, tokens, { connected_by: conn.connected_by, connected_at: conn.connected_at });
  }
  return conn.access_token;
}

// ── Reporting ──────────────────────────────────────────────────────────────────
// Returns [{ campaignId, campaignName, date, spend, impressions, clicks, conversions }]
// for every campaign with activity in [startDate, endDate] (both 'YYYY-MM-DD').
export async function fetchCampaignSpend(env, startDate, endDate) {
  const accessToken = await getValidAccessToken(env);
  const adAccountId = String(env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  if (!adAccountId) throw new Error('META_AD_ACCOUNT_ID not configured');

  const params = new URLSearchParams({
    level:          'campaign',
    fields:         'campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_range:     JSON.stringify({ since: startDate, until: endDate }),
    time_increment: '1',
    access_token:   accessToken,
  });

  const rows = [];
  let url = `${GRAPH_BASE}/act_${adAccountId}/insights?${params.toString()}`;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta Insights API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    for (const r of data.data || []) {
      const conversions = (r.actions || []).reduce((sum, a) => sum + Number(a.value || 0), 0);
      rows.push({
        campaignId:   r.campaign_id,
        campaignName: r.campaign_name,
        date:         r.date_start,
        spend:        Number(r.spend || 0),
        impressions:  Number(r.impressions || 0),
        clicks:       Number(r.clicks || 0),
        conversions,
      });
    }
    url = data.paging?.next || null;
  }
  return rows;
}
