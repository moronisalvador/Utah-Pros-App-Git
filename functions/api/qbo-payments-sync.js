/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A safety net for the QuickBooks payment webhook. On a schedule (and on demand),
 *   it asks QuickBooks for recent payments and makes sure each one is recorded in
 *   UPR. If a webhook was ever missed (network hiccup, downtime), this catches it so
 *   invoices don't silently drift out of date.
 *
 * WHERE IT LIVES:
 *   Route:   GET/POST /api/qbo-payments-sync  (point an hourly cron at this, like
 *            /api/process-scheduled). Also exports scheduled() for Cloudflare cron.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  lib/supabase.js, lib/cors.js, lib/quickbooks.js (qboFetch, getConnection),
 *              lib/qbo-payment-sync.js (syncQboPaymentToUpr)
 *   Data:      reads → QBO Payments (Intuit), invoices/payments (Supabase)
 *              writes → payments (insert, via qbo-payment-sync; deduped)
 *
 * NOTES / GOTCHAS:
 *   - Idempotent: syncQboPaymentToUpr skips payments already recorded, so re-running is safe.
 *   - Looks back LOOKBACK_DAYS by TxnDate; tune if needed. Low volume → cheap.
 *   - No-ops cleanly when QuickBooks isn't connected.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { requireEmployee } from '../lib/auth.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { qboFetch, getConnection } from '../lib/quickbooks.js';
import { syncQboPaymentToUpr } from '../lib/qbo-payment-sync.js';

const MINOR_VERSION = '70';
const LOOKBACK_DAYS = 7;

// Auth: x-webhook-secret (server-side cron) or a Supabase Bearer (admin).
// Mirrors qbo-invoice.js so manual triggers and the scheduler both work.
async function isAuthorized(request, env) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) return true;
  const auth = await requireEmployee(request, env);
  return auth.ok;
}

// ─── SECTION: Reconcile ──────────────
async function reconcile(env) {
  const startedAt = new Date().toISOString();
  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) return { ok: false, error: 'QuickBooks not connected' };

  const db = supabase(env);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const q = `SELECT Id, TxnDate FROM Payment WHERE TxnDate >= '${since}' MAXRESULTS 500`;

  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) return { ok: false, error: `QBO query ${res.status}` };
  const data = await res.json().catch(() => ({}));
  const payments = data?.QueryResponse?.Payment || [];

  let recorded = 0, skipped = 0;
  for (const p of payments) {
    try {
      const r = await syncQboPaymentToUpr(env, db, String(p.Id));
      for (const x of (r.results || [])) { if (x.recorded) recorded++; else skipped++; }
    } catch (err) {
      console.error('qbo-payments-sync: payment', p.Id, err?.message || err);
    }
  }

  try {
    await db.insert('worker_runs', {
      worker_name: 'qbo-payments-sync', status: 'completed', records_processed: recorded,
      error_message: null, started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort logging */ }

  return { ok: true, scanned: payments.length, recorded, skipped };
}

// ─── SECTION: Handlers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  return jsonResponse(await reconcile(env), 200, request, env);
}
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  return jsonResponse(await reconcile(env), 200, request, env);
}
// Cloudflare cron trigger (if configured in wrangler.toml [triggers] crons).
export async function scheduled(event, env, ctx) {
  await reconcile(env);
}
