/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A safety net for QuickBooks webhooks. On a schedule (and on demand), it
 *   reconciles recent payment changes, retries durable receipt work that could
 *   not finish, and mirrors customer estimate answers missed by their webhook.
 *
 * WHERE IT LIVES:
 *   Route:   GET/POST /api/qbo-payments-sync  (point an hourly cron at this, like
 *            /api/process-scheduled). Also exports scheduled() for Cloudflare cron.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  lib/supabase.js, lib/cors.js, lib/qbo-auth.js (authorizeQboRequest),
 *              lib/quickbooks.js (qboFetch, getConnection),
 *              lib/qbo-payment-sync.js (payment reconciliation/removal),
 *              lib/qbo-estimate-sync.js (syncQboEstimateToUpr),
 *              lib/worker-runs.js (recordWorkerRun)
 *   Data:      reads → QBO Payment CDC + Estimates, qbo_events, receipt/invoice/payment data
 *              writes → payment projections, qbo_events, receipt service RPCs, worker_runs;
 *                       estimates status through qbo-estimate-sync
 *
 * NOTES / GOTCHAS:
 *   - CDC catches payment updates and deletions even when their transaction date is old.
 *     When CDC is unusable (non-OK, unreadable, or a Fault riding on HTTP 200) the sweep
 *     fails CLOSED into a MetaData.LastUpdatedTime window query — never TxnDate, which
 *     misses backdated entries. Intuit dateTimes are sent second-precision (no millis).
 *   - The seven-day overlap, durable retry queue, and idempotent estimate sync make re-runs safe.
 *   - An estimate-sweep failure never blocks payment reconciliation (and payments run first),
 *     but ANY dropped work makes the worker_runs row status 'error', never 'completed'.
 *   - worker_runs meta records scanned, the query window, source, and webhook_missed — the
 *     count of payments this sweep newly recorded that the webhook never delivered.
 *   - No-ops cleanly when QuickBooks isn't connected.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { authorizeQboRequest, QBO_ADMIN_ROLES } from '../lib/qbo-auth.js';
import { qboFetch, getConnection } from '../lib/quickbooks.js';
import { syncQboPaymentToUpr, removeQboPaymentFromUpr } from '../lib/qbo-payment-sync.js';
import { syncQboEstimateToUpr } from '../lib/qbo-estimate-sync.js';
import { isReceivePaymentsGateOpen } from '../lib/qbo-receipt.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { recordReconciliation, reconciliationItem, resolveReconciliation } from '../lib/qbo-reconciliation.js';

const MINOR_VERSION = '70';
const CDC_OVERLAP_DAYS = 7;
const QUERY_MAX_RESULTS = 500;
const RECEIPT_PROCESSING_STALE_MS = 10 * 60 * 1000;

// Intuit's documented dateTime carries second precision only (YYYY-MM-DDTHH:MM:SS,
// optionally Z or ±HH:MM). toISOString()'s fractional seconds sit outside that
// contract, so every provider-facing window and query literal strips them.
export function qboDateTime(epochMs) {
  return new Date(epochMs).toISOString().replace(/\.\d+Z$/, 'Z');
}

export function cdcPayments(body) {
  const changes = [];
  for (const response of body?.CDCResponse || []) {
    for (const query of response?.QueryResponse || []) {
      for (const payment of query?.Payment || []) changes.push(payment);
    }
  }
  return changes;
}

// A CDC request can fail INSIDE an HTTP-200 body: Intuit rides Fault objects on the
// CDCResponse elements (and their per-entity QueryResponse entries). Reading that as
// "no changes" is exactly how a broken sweep reports green — surface it instead.
export function cdcFault(body) {
  for (const response of body?.CDCResponse || []) {
    for (const fault of [response?.Fault, ...(response?.QueryResponse || []).map((q) => q?.Fault)]) {
      const err = fault?.Error?.[0];
      if (err) {
        return [err.code ? `fault ${err.code}` : 'fault', err.Message, err.Detail]
          .filter(Boolean).join(' — ');
      }
    }
  }
  return null;
}

export async function drainReceiptRetries(env, db, realmId, { receiptEnabled = false } = {}) {
  if (!receiptEnabled) return { processed: 0, failed: 0 };
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - RECEIPT_PROCESSING_STALE_MS).toISOString();
  const dueRetries = await db.select(
    'qbo_events',
    `entity=eq.Payment&status=eq.retry&qbo_entity_id=not.is.null&or=(next_retry_at.is.null,next_retry_at.lte.${encodeURIComponent(now)})&select=id,operation,qbo_realm_id,qbo_entity_id,retry_count&order=created_at.asc&limit=100`,
  );
  // A worker can be interrupted after its atomic claim but before it persists a terminal
  // outcome. Recover only old receipt-mode claims; a fresh processing row is still owned by
  // the webhook invocation that created it.
  const staleProcessing = await db.select(
    'qbo_events',
    `entity=eq.Payment&status=eq.processing&qbo_realm_id=not.is.null&qbo_entity_id=not.is.null&created_at=lte.${encodeURIComponent(staleBefore)}&select=id,operation,qbo_realm_id,qbo_entity_id,retry_count&order=created_at.asc&limit=100`,
  );
  const events = [...new Map([...(dueRetries || []), ...(staleProcessing || [])]
    .map((event) => [event.id, event])).values()];
  let processed = 0;
  let failed = 0;
  for (const event of events || []) {
    if (event.qbo_realm_id && String(event.qbo_realm_id) !== String(realmId)) {
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: 'ignored',
        error: 'realm_mismatch',
        processed_at: new Date().toISOString(),
      });
      continue;
    }
    try {
      const operation = String(event.operation || '');
      if (['Delete', 'Void', 'Merge'].includes(operation)) {
        await removeQboPaymentFromUpr(db, event.qbo_entity_id, {
          receiptEnabled: true,
          status: operation === 'Delete' ? 'deleted' : 'voided',
          eventKey: event.id,
          realmId,
          env,
        });
      } else {
        await syncQboPaymentToUpr(env, db, event.qbo_entity_id, { receiptEnabled: true });
      }
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: 'processed',
        error: null,
        processed_at: new Date().toISOString(),
        next_retry_at: null,
        retry_count: Number(event.retry_count || 0) + 1,
      });
      processed++;
    } catch (error) {
      const retryCount = Number(event.retry_count || 0) + 1;
      const transientDatabaseFailure =
        /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(error?.message || ''));
      const retryable = (error?.retryable === true || transientDatabaseFailure) && retryCount < 8;
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: retryable ? 'retry' : 'error',
        error: String(error?.message || error).slice(0, 500),
        retry_count: retryCount,
        next_retry_at: retryable
          ? new Date(Date.now() + Math.min(6 * 60, 5 * (2 ** retryCount)) * 60 * 1000).toISOString()
          : null,
      });
      failed++;
    }
  }
  return { processed, failed };
}

async function persistCdcFailure(env, db, realmId, payment, error, receiptEnabled) {
  if (!receiptEnabled) return;
  const eventId = `cdc-retry:${realmId}:${payment.Id}:${payment.MetaData?.LastUpdatedTime || payment.SyncToken || 'current'}`;
  const retryable = error?.retryable === true
    || /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(error?.message || ''));
  // A failed REMOVAL must retry as a removal: drainReceiptRetries routes by the
  // stored operation, and a 'CDC' tag would re-run the sync path, which resolves
  // a deleted payment as benign payment-not-found and never completes the removal.
  const operation = String(payment?.status || '').toLowerCase() === 'deleted' ? 'Delete' : 'CDC';
  try {
    const claimed = await db.rpc('claim_qbo_receipt_event', {
      p_id: eventId,
      p_entity: 'Payment',
      p_operation: operation,
      p_realm_id: String(realmId),
      p_entity_id: String(payment.Id),
      p_provider_updated_at: payment.MetaData?.LastUpdatedTime || null,
    });
    if (!claimed) return;
    await db.update('qbo_events', `id=eq.${encodeURIComponent(eventId)}`, {
      status: retryable ? 'retry' : 'error',
      error: String(error?.message || error).slice(0, 500),
      next_retry_at: retryable ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
    });
  } catch (queueError) {
    console.error('qbo-payments-sync: could not persist CDC failure', queueError);
  }
}

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

  const db = supabase(env, fetchWithTimeout);
  const changedSince = qboDateTime(Date.now() - CDC_OVERLAP_DAYS * 86400000);
  const queryWindow = { changed_since: changedSince, days: CDC_OVERLAP_DAYS };
  // A run that could not even build its payment feed leaves an honest error row —
  // an invisible run is indistinguishable from a green one (the 2026-08 outage
  // failure mode: 'completed' every hour while nothing was ever swept).
  const failRun = async (message, meta = {}) => {
    await recordWorkerRun(db, {
      workerName: 'qbo-payments-sync', status: 'error', errorMessage: message,
      startedAt, meta: { scanned: 0, query_window: queryWindow, ...meta },
    });
    return { ok: false, error: message };
  };

  let receiptEnabled;
  let payments;
  let source = 'cdc';
  let cdcError = null;
  try {
    // Same gate resolution as qbo-webhook.js, passed through to the same sync/remove functions.
    receiptEnabled = await isReceivePaymentsGateOpen(env, db);
    const cdc = await qboFetch(env, `/cdc?entities=Payment&changedSince=${encodeURIComponent(changedSince)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
    const cdcBody = cdc.ok ? await cdc.json().catch(() => null) : null;
    cdcError = !cdc.ok ? `HTTP ${cdc.status}`
      : cdcBody == null ? 'unreadable body'
        : !Array.isArray(cdcBody.CDCResponse) ? 'unrecognized body'
          : cdcFault(cdcBody);
    if (cdcError == null) {
      payments = cdcPayments(cdcBody);
    } else {
      // Fail CLOSED on any CDC degradation: sweep by provider modification time
      // instead of reading it as "no changes". LastUpdatedTime, never TxnDate — a
      // payment ENTERED during a webhook outage but backdated past the window
      // would be permanently invisible to a TxnDate filter.
      source = 'query-fallback';
      // SELECT * so the rows carry MetaData like CDC rows do — the retry queue
      // keys failure idempotency on MetaData.LastUpdatedTime, and a projected
      // row without it would collapse every failed version onto one key.
      const q = `SELECT * FROM Payment WHERE MetaData.LastUpdatedTime >= '${changedSince}' MAXRESULTS ${QUERY_MAX_RESULTS}`;
      const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
      if (!res.ok) return failRun(`QBO query ${res.status} (cdc: ${cdcError})`, { source, cdc_error: cdcError });
      payments = (await res.json().catch(() => ({})))?.QueryResponse?.Payment || [];
    }
  } catch (error) {
    return failRun(String(error?.message || error), { source, ...(cdcError ? { cdc_error: cdcError } : {}) });
  }

  let recorded = 0, skipped = 0, failed = 0;
  const failures = [];
  const paymentReconciliation = [];
  for (const p of payments) {
    try {
      if (String(p.status || '').toLowerCase() === 'deleted') {
        await removeQboPaymentFromUpr(db, String(p.Id), {
          receiptEnabled,
          status: 'deleted',
          eventKey: `cdc:${conn.realm_id}:${p.Id}:${p.MetaData?.LastUpdatedTime || 'deleted'}`,
          realmId: String(conn.realm_id),
          env,
        });
        skipped++;
        continue;
      }
      const r = await syncQboPaymentToUpr(env, db, String(p.Id), { receiptEnabled });
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
      await persistCdcFailure(env, db, String(conn.realm_id), p, err, receiptEnabled);
      failed++;
      if (failures.length < 5) failures.push(`payment ${p.Id}: ${String(err?.message || err).slice(0, 200)}`);
    }
  }

  // Estimate answers sweep — isolated so it can never break payment reconciliation.
  let estimates;
  try {
    estimates = await sweepEstimates(env, db, changedSince);
  } catch (err) {
    console.error('qbo-payments-sync: estimate sweep', err?.message || err);
    estimates = { ok: false, error: String(err?.message || err) };
  }

  let retry;
  try {
    retry = await drainReceiptRetries(env, db, String(conn.realm_id), { receiptEnabled });
  } catch (err) {
    console.error('qbo-payments-sync: receipt retry drain', err?.message || err);
    retry = { processed: 0, failed: 0, error: String(err?.message || err) };
  }

  // Honest status: a sweep that dropped work is never 'completed'. `recorded`
  // counts payments THIS sweep newly wrote; anything the webhook delivered comes
  // back as already-synced/reconciled — so webhook_missed > 0 is the direct
  // signal that the webhook is down.
  const problems = [];
  if (failed) problems.push(`${failed} of ${payments.length} payment syncs failed — ${failures[0]}`);
  if (estimates?.ok === false) problems.push(`estimate sweep: ${estimates.error || 'failed'}`);
  if (retry.error) problems.push(`receipt retry drain: ${retry.error}`);
  else if (retry.failed) problems.push(`${retry.failed} receipt ${retry.failed === 1 ? 'retry' : 'retries'} failed`);

  await recordWorkerRun(db, {
    workerName: 'qbo-payments-sync',
    status: problems.length ? 'error' : 'completed',
    recordsProcessed: recorded + retry.processed,
    errorMessage: problems.length ? problems.join('; ') : null,
    startedAt,
    meta: {
      scanned: payments.length,
      query_window: queryWindow,
      source,
      ...(cdcError ? { cdc_error: cdcError } : {}),
      webhook_missed: recorded,
      failed,
      ...(failures.length ? { failures } : {}),
      estimates,
      reconciliation_count: paymentReconciliation.length + (estimates?.reconciliation_count || 0),
      reconciliation_reasons: [
        ...paymentReconciliation.map((item) => item.reason),
        ...(estimates?.reconciliation_reasons || []),
      ],
      retry,
    },
  });

  return {
    ok: true, scanned: payments.length, recorded, skipped, failed,
    webhook_missed: recorded, source, estimates, retry,
  };
}

// ─── SECTION: Handlers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await authorizeQboRequest(request, env, supabase(env, fetchWithTimeout), undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  return jsonResponse(await reconcile(env), 200, request, env);
}
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authorizeQboRequest(request, env, supabase(env, fetchWithTimeout), undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  return jsonResponse(await reconcile(env), 200, request, env);
}
// Cloudflare cron trigger (if configured in wrangler.toml [triggers] crons).
export async function scheduled(event, env, ctx) {
  void ctx;
  await reconcile(env);
}
