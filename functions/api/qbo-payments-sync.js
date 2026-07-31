/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A safety net for the QuickBooks webhook. On a schedule (and on demand), it asks
 *   QuickBooks for recent payments and makes sure each one is recorded in UPR, and
 *   for recent estimate answers (a customer accepted or declined an estimate online)
 *   and mirrors those too. If a webhook was ever missed (network hiccup, downtime,
 *   a missing Intuit subscription), this catches it within the hour.
 *
 * WHERE IT LIVES:
 *   Route:   GET/POST /api/qbo-payments-sync  (point an hourly cron at this, like
 *            /api/process-scheduled). Also exports scheduled() for Cloudflare cron.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  lib/supabase.js, lib/cors.js, lib/qbo-auth.js (authorizeQboRequest),
 *              lib/quickbooks.js (qboFetch, getConnection),
 *              lib/qbo-payment-sync.js (syncQboPaymentToUpr),
 *              lib/qbo-estimate-sync.js (syncQboEstimateToUpr),
 *              lib/worker-runs.js (recordWorkerRun)
 *   Data:      reads → QBO Payments + Estimates (Intuit), invoices/payments/estimates (Supabase)
 *              writes → payments (insert, via qbo-payment-sync; deduped);
 *                       estimates status (via qbo-estimate-sync; guarded/idempotent)
 *
 * NOTES / GOTCHAS:
 *   - Idempotent: syncQboPaymentToUpr skips payments already recorded and
 *     syncQboEstimateToUpr skips estimates already decided, so re-running is safe.
 *   - Looks back LOOKBACK_DAYS by TxnDate / LastUpdatedTime; tune if needed. Low volume → cheap.
 *   - An estimate-sweep failure never blocks payment reconciliation (and payments run first).
 *   - No-ops cleanly when QuickBooks isn't connected.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboRequest } from '../lib/qbo-auth.js';
import { qboFetch, getConnection } from '../lib/quickbooks.js';
import { syncQboPaymentToUpr } from '../lib/qbo-payment-sync.js';
import { syncQboEstimateToUpr } from '../lib/qbo-estimate-sync.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { recordReconciliation, reconciliationItem, resolveReconciliation } from '../lib/qbo-reconciliation.js';

const MINOR_VERSION = '70';
const LOOKBACK_DAYS = 7;

// Customer answers worth mirroring; Pending/Closed estimates are noise.
const ESTIMATE_STATUSES_TO_SYNC = new Set(['Accepted', 'Rejected', 'Converted']);

// ─── SECTION: Estimate sweep ──────────────
// Mirror recent QBO estimate answers (accept/decline/convert) into UPR. The
// real-time path is the Estimate webhook; this sweep catches anything missed.
async function sweepEstimates(env, db, since) {
  const q = `SELECT Id, TxnStatus FROM Estimate WHERE MetaData.LastUpdatedTime >= '${since}' MAXRESULTS 500`;
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) return { ok: false, error: `QBO estimate query ${res.status}` };
  const data = await res.json().catch(() => ({}));
  const all = data?.QueryResponse?.Estimate || [];
  const candidates = all.filter((e) => ESTIMATE_STATUSES_TO_SYNC.has(String(e.TxnStatus || '')));

  let acted = 0, skipped = 0;
  const reconciliation = [];
  for (const e of candidates) {
    try {
      const r = await syncQboEstimateToUpr(env, db, String(e.Id));
      if (r?.result?.action) acted++; else skipped++;
      const item = reconciliationItem('Estimate', e.Id, r?.result);
      if (item) reconciliation.push(await recordReconciliation(db, item));
      else await resolveReconciliation(db, 'Estimate', e.Id);
    } catch (err) {
      console.error('qbo-payments-sync: estimate', e.Id, err?.message || err);
    }
  }
  return {
    ok: true, scanned: candidates.length, acted, skipped,
    reconciliation_count: reconciliation.length,
    reconciliation_reasons: reconciliation.map((item) => item.reason),
  };
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
  const paymentReconciliation = [];
  for (const p of payments) {
    try {
      const r = await syncQboPaymentToUpr(env, db, String(p.Id));
      for (const x of (r.results || [])) {
        if (x.recorded) recorded++; else skipped++;
        const entity = x?.qboInvoiceId ? 'Invoice' : 'Payment';
        const qboId = x?.qboInvoiceId || p.Id;
        const item = reconciliationItem(entity, qboId, x);
        if (item) paymentReconciliation.push(await recordReconciliation(db, item));
        else await resolveReconciliation(db, entity, qboId);
      }
    } catch (err) {
      console.error('qbo-payments-sync: payment', p.Id, err?.message || err);
    }
  }

  // Estimate answers sweep — isolated so it can never break payment reconciliation.
  let estimates;
  try {
    estimates = await sweepEstimates(env, db, since);
  } catch (err) {
    console.error('qbo-payments-sync: estimate sweep', err?.message || err);
    estimates = { ok: false, error: String(err?.message || err) };
  }

  // records_processed keeps its historical meaning (payments recorded); the
  // estimate sweep outcome rides along in meta.
  await recordWorkerRun(db, {
    workerName: 'qbo-payments-sync', status: 'completed', recordsProcessed: recorded,
    startedAt, meta: {
      estimates,
      reconciliation_count: paymentReconciliation.length + (estimates?.reconciliation_count || 0),
      reconciliation_reasons: [
        ...paymentReconciliation.map((item) => item.reason),
        ...(estimates?.reconciliation_reasons || []),
      ],
    },
  });

  return { ok: true, scanned: payments.length, recorded, skipped, estimates };
}

// ─── SECTION: Handlers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authorizeQboRequest(request, env, supabase(env));
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  return jsonResponse(await reconcile(env), 200, request, env);
}
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authorizeQboRequest(request, env, supabase(env));
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  return jsonResponse(await reconcile(env), 200, request, env);
}
// Cloudflare cron trigger (if configured in wrangler.toml [triggers] crons).
export async function scheduled(event, env, ctx) {
  void ctx;
  await reconcile(env);
}
