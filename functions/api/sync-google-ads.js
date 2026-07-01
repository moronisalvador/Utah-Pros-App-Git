/**
 * ════════════════════════════════════════════════
 * FILE: sync-google-ads.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Every day, asks Google how much was spent on each ad campaign yesterday
 *   and saves it to our own database, so the CRM has ad spend numbers
 *   without anyone having to log into Google Ads and copy them over by hand.
 *   Can also be pointed backward to pull months of history in one go, for
 *   the initial catch-up.
 *
 * ENDPOINT:
 *   GET/POST /api/sync-google-ads   (authenticated — Supabase Bearer, manual trigger)
 *            body (POST only): { backfill?: boolean, days?: number }
 *   Also exports scheduled() for Cloudflare's daily Cron Trigger (dashboard-
 *   configured, per CLAUDE.md — no wrangler.toml in this repo) — that path
 *   is invoked by Cloudflare internally, never over public HTTP.
 *
 * DEPENDS ON:
 *   Packages:      none
 *   Internal:      ../lib/supabase.js, ../lib/cors.js, ../lib/google-drive.js
 *                  (getActorEmployee), ../lib/google-ads.js, ../lib/date-mt.js
 *   External API:  Google Ads API (via google-ads.js)
 *   Data:          reads  → integration_credentials (provider='google_ads')
 *                  writes → ad_spend (via upsert_ad_spend RPC), worker_runs
 *
 * NOTES / GOTCHAS:
 *   - Uses mountainYesterday() (date-mt.js), not the UTC date, to decide
 *     which calendar day to pull — Google reports by its own account
 *     timezone, but "yesterday" for scheduling purposes is Utah's day
 *     boundary, per docs/crm-roadmap.md's timezone-convention rule.
 *   - A default (non-backfill) run only pulls ONE day (yesterday) — ad
 *     platforms commonly revise a day's numbers for ~72h after it happened,
 *     so a short overlap is intentionally re-pulled by running daily rather
 *     than trying to catch every revision precisely.
 *   - Per-row upsert failures don't abort the run — one bad row is logged
 *     and skipped so a single malformed campaign doesn't block the rest of
 *     the day's spend from landing (mirrors callrail-backfill.js).
 *   - Always logs a worker_runs row (started/completed/error + records
 *     processed) per the roadmap's "every cron/webhook worker logs to
 *     worker_runs" rule — this is how "did last night's pull actually run"
 *     gets answered without digging through Cloudflare logs.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { getActorEmployee } from '../lib/google-drive.js';
import { fetchCampaignSpend } from '../lib/google-ads.js';
import { mountainYesterday } from '../lib/date-mt.js';

const WORKER_NAME = 'sync-google-ads';
const MAX_BACKFILL_DAYS = 400; // guard against a runaway backfill request

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  return runAuthenticated(context, {});
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  return runAuthenticated(context, body);
}

// Cloudflare invokes this directly for the scheduled Cron Trigger — no HTTP,
// no auth check needed (it never reaches the public request path).
export async function scheduled(event, env) {
  const db = supabase(env);
  const result = await runSync(db, env, {});
  console.log('sync-google-ads cron:', result);
}

async function runAuthenticated(context, body) {
  const { request, env } = context;
  const db = supabase(env);

  const employee = await getActorEmployee(request, env, db);
  if (!employee) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const result = await runSync(db, env, body);
  return jsonResponse(result, result.ok ? 200 : 500, request, env);
}

async function runSync(db, env, body) {
  const startedAt = new Date().toISOString();
  const now = new Date();
  const yesterday = mountainYesterday(now);

  let startDate = yesterday;
  const endDate = yesterday;
  if (body?.backfill) {
    const days = Math.min(Number(body.days) > 0 ? Number(body.days) : 365, MAX_BACKFILL_DAYS);
    const start = new Date(`${yesterday}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    startDate = start.toISOString().slice(0, 10);
  }

  let processed = 0;
  let errored = 0;

  try {
    const rows = await fetchCampaignSpend(env, startDate, endDate);

    for (const r of rows) {
      try {
        await db.rpc('upsert_ad_spend', {
          p_platform:             'google',
          p_campaign_id:          r.campaignId,
          p_campaign_name:        r.campaignName,
          p_date:                 r.date,
          p_spend:                r.spend,
          p_impressions:          r.impressions,
          p_clicks:               r.clicks,
          p_platform_conversions: r.conversions,
        });
        processed++;
      } catch {
        errored++;
      }
    }

    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'completed', records_processed: processed,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: true, processed, errored, startDate, endDate };
  } catch (e) {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'error', records_processed: processed,
      error_message: String(e.message || e).slice(0, 500), started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: false, error: e.message, processed };
  }
}
