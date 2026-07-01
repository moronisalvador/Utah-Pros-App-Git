/**
 * ════════════════════════════════════════════════
 * FILE: metaads.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant ask Meta's (Facebook/Instagram) advertising system how
 *   much UPR spent on each ad campaign, from a Claude chat. It reuses the
 *   company's existing Meta sign-in (kept valid automatically) and can run a
 *   ready-made per-campaign spend report or read any Graph API path with the
 *   account token attached.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (platform fetch)
 *   Internal:      ./supabase.js (reads/refreshes the stored token)
 *   External API:  Meta OAuth + Marketing/Insights API (graph.facebook.com)
 *   Data:          reads → integration_credentials (provider='meta_ads')
 *                  writes → integration_credentials (re-exchanged long-lived token)
 *   Config:        META_APP_ID/SECRET (token re-exchange), META_AD_ACCOUNT_ID
 *
 * NOTES / GOTCHAS:
 *   - Long-lived-token logic + Insights shape ported from functions/lib/meta-ads.js.
 *     Meta has no classic refresh_token grant: getValidAccessToken re-exchanges the
 *     current long-lived token for a fresh 60-day one when it's within 5 days of
 *     expiry. A connection idle past 60 days needs a manual reconnect in the app.
 *   - The API version (v19.0) and Insights field shapes are best-effort from the
 *     public reference (same disclosed gap as the app lib). Conversions sum every
 *     `actions` entry — a coarse total, not a reconciled lead count.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

const PROVIDER = 'meta_ads';
const API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

async function getConnection(env) {
  const rows = await supabase(env).select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

async function exchangeForLongLivedToken(env, shortLivedToken) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error('META_APP_ID / META_APP_SECRET are not configured for the MCP worker.');
  }
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta long-lived token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Returns a valid access token, re-exchanging (and persisting) if it expires within 5 days.
async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.access_token) throw new Error('Meta Ads is not connected in UPR (integration_credentials provider=meta_ads is missing).');
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 24 * 60 * 60 * 1000) {
    const tokens = await exchangeForLongLivedToken(env, conn.access_token);
    const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 60 * 24 * 60 * 60) * 1000;
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

// GET any Graph API path (read-only) with the account token attached.
// path e.g. "/act_123456/campaigns" or "/me/adaccounts".
export async function metaGet(env, path, params = {}) {
  const accessToken = await getValidAccessToken(env);
  const qp = new URLSearchParams({ ...params, access_token: accessToken });
  const p = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${GRAPH_BASE}${p}?${qp.toString()}`);
  if (!res.ok) throw new Error(`Meta Graph API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Ready-made per-campaign-per-day spend for [startDate, endDate] (both 'YYYY-MM-DD').
// Ported from fetchCampaignSpend in functions/lib/meta-ads.js (paginates, hard-capped).
export async function campaignInsights(env, startDate, endDate) {
  const accessToken = await getValidAccessToken(env);
  const adAccountId = String(env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
  if (!adAccountId) throw new Error('META_AD_ACCOUNT_ID is not configured for the MCP worker.');

  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    time_increment: '1',
    access_token: accessToken,
  });

  const MAX_PAGES = 50;
  const rows = [];
  let url = `${GRAPH_BASE}/act_${adAccountId}/insights?${params.toString()}`;
  let page = 0;
  while (url && page < MAX_PAGES) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta Insights API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    for (const r of data.data || []) {
      const conversions = (r.actions || []).reduce((sum, a) => sum + Number(a.value || 0), 0);
      rows.push({
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        date: r.date_start,
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        conversions,
      });
    }
    url = (data.paging && data.paging.next) || null;
    page++;
  }
  return rows;
}
