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
import {
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  requireQboProviderTraffic,
  isQboProviderTrafficDisabled,
} from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-document-command-gate.js';

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
        await syncQboPaymentToUpr(env, db, event.qbo_entity_id, { receiptEnabled: true, expectedRealmId: String(realmId) });
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
      const retryable = (error?.retryable === true
        || error?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE
        || transientDatabaseFailure) && retryCount < 8;
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: retryable ? 'retry' : 'error',
        error: String(error?.message || error).slice(0, 500),
        retry_count: retryCount,
        next_retry_at: retryable
          ? new Date(Date.now() + Math.min(6 * 60, 5 * (2 ** retryCount)) * 60 * 1000).toISOString()
          : null,
      });
      failed++;
      if (error?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE) {
        return { processed, failed, maintenanceClosed: true };
      }
    }
  }
  return { processed, failed };
}

// Provider-maintenance webhook rows are inserted directly as retryable work (rather
// than claimed then patched) so both legacy Estimate and receipt Payment rows retain
// their realm/entity identity. Drain only this exact error class after the global
// provider gate has reopened; other retry ownership stays with its existing worker.
export async function drainMaintenanceRetries(env, db, realmId, { receiptEnabled = false } = {}) {
  const now = new Date().toISOString();
  const events = await db.select(
    'qbo_events',
    `entity=in.(Payment,Estimate)&status=eq.retry&error=eq.${QBO_PROVIDER_TRAFFIC_DISABLED_CODE}&qbo_realm_id=not.is.null&qbo_entity_id=not.is.null&or=(next_retry_at.is.null,next_retry_at.lte.${encodeURIComponent(now)})&select=id,entity,operation,qbo_realm_id,qbo_entity_id,retry_count&order=created_at.asc&limit=100`,
  );
  let processed = 0;
  let failed = 0;
  for (const event of events || []) {
    if (String(event.qbo_realm_id) !== String(realmId)) {
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: 'ignored',
        error: 'realm_mismatch',
        processed_at: new Date().toISOString(),
        next_retry_at: null,
      });
      continue;
    }
    try {
      const operation = String(event.operation || '');
      if (event.entity === 'Estimate') {
        if (['Delete', 'Void', 'Merge'].includes(operation)) {
          await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
            status: 'ignored',
            error: `estimate ${operation.toLowerCase()} is not mirrored`,
            processed_at: new Date().toISOString(),
            next_retry_at: null,
            retry_count: Number(event.retry_count || 0) + 1,
          });
          processed++;
          continue;
        }
        await syncQboEstimateToUpr(env, db, event.qbo_entity_id, { expectedRealmId: String(realmId) });
      } else if (['Delete', 'Void', 'Merge'].includes(operation)) {
        await removeQboPaymentFromUpr(db, event.qbo_entity_id, {
          receiptEnabled,
          status: operation === 'Delete' ? 'deleted' : 'voided',
          eventKey: event.id,
          realmId,
          env,
        });
      } else {
        await syncQboPaymentToUpr(env, db, event.qbo_entity_id, { receiptEnabled, expectedRealmId: String(realmId) });
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
      const retryable = (error?.retryable === true
        || error?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE
        || transientDatabaseFailure) && retryCount < 8;
      if (retryable) console.error('qbo-payments-sync: maintenance retry remains queued', event.id, error?.message || error);
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: retryable ? 'retry' : 'error',
        // This queue's selection contract is the stable maintenance marker.
        // Keep provider/DB detail in the worker log rather than orphaning a
        // retry row by overwriting the only field that selects it next run.
        error: retryable ? QBO_PROVIDER_TRAFFIC_DISABLED_CODE : String(error?.message || error).slice(0, 500),
        retry_count: retryCount,
        next_retry_at: retryable
          ? new Date(Date.now() + Math.min(6 * 60, 5 * (2 ** retryCount)) * 60 * 1000).toISOString()
          : null,
      });
      failed++;
      if (error?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE) {
        return { processed, failed, maintenanceClosed: true };
      }
    }
  }
  return { processed, failed };
}

async function persistCdcFailure(env, db, realmId, payment, error, receiptEnabled) {
  if (!receiptEnabled) return;
  const eventId = `cdc-retry:${realmId}:${payment.Id}:${payment.MetaData?.LastUpdatedTime || payment.SyncToken || 'current'}`;
  const retryable = error?.retryable === true
    || error?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE
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
async function sweepEstimates(env, db, since, expectedRealmId) {
  const q = `SELECT Id, TxnStatus FROM Estimate WHERE MetaData.LastUpdatedTime >= '${since}' MAXRESULTS 500`;
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
  if (!res.ok) return { ok: false, error: `QBO estimate query ${res.status}` };
  const data = await res.json().catch(() => ({}));
  const all = data?.QueryResponse?.Estimate || [];
  const candidates = all.filter((e) => ESTIMATE_STATUSES_TO_SYNC.has(String(e.TxnStatus || '')));

  let acted = 0, skipped = 0;
  const reconciliation = [];
  for (const e of candidates) {
    try {
      const r = await syncQboEstimateToUpr(env, db, String(e.Id), { expectedRealmId });
      if (r?.result?.action) acted++; else skipped++;
      const item = reconciliationItem('Estimate', e.Id, r?.result);
      if (item) reconciliation.push(await recordReconciliation(db, item));
      else await resolveReconciliation(db, 'Estimate', e.Id);
    } catch (err) {
      if (isQboProviderTrafficDisabled(err)) throw err;
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
  const db = supabase(env, fetchWithTimeout);
  const changedSince = qboDateTime(Date.now() - CDC_OVERLAP_DAYS * 86400000);
  const queryWindow = { changed_since: changedSince, days: CDC_OVERLAP_DAYS };
  // A run that could not even build its payment feed leaves an honest error row —
  // an invisible run is indistinguishable from a green one (the 2026-08 outage
  // failure mode: 'completed' every hour while nothing was ever swept).
  const failRun = async (message, meta = {}, { maintenance = false } = {}) => {
    await recordWorkerRun(db, {
      workerName: 'qbo-payments-sync', status: 'error', errorMessage: message,
      startedAt, meta: { scanned: 0, query_window: queryWindow, ...meta },
    });
    return maintenance
      ? {
          ok: false,
          error: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
          code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
          reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
          status: 503,
        }
      : { ok: false, error: message };
  };

  let conn;
  try {
    conn = await getConnection(env);
  } catch (error) {
    if (isQboProviderTrafficDisabled(error)) {
      return failRun(QBO_PROVIDER_TRAFFIC_DISABLED_CODE, {
        maintenance_gate: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
      }, { maintenance: true });
    }
    throw error;
  }
  if (!conn || !conn.refresh_token) return { ok: false, error: 'QuickBooks not connected' };

  let receiptEnabled;
  let payments;
  let source = 'cdc';
  let cdcError = null;
  try {
    // Same gate resolution as qbo-webhook.js, passed through to the same sync/remove functions.
    receiptEnabled = await isReceivePaymentsGateOpen(env, db);
    const cdc = await qboFetch(env, `/cdc?entities=Payment&changedSince=${encodeURIComponent(changedSince)}&minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId: String(conn.realm_id) });
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
      const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId: String(conn.realm_id) });
      if (!res.ok) return failRun(`QBO query ${res.status} (cdc: ${cdcError})`, { source, cdc_error: cdcError });
      payments = (await res.json().catch(() => ({})))?.QueryResponse?.Payment || [];
    }
  } catch (error) {
    if (isQboProviderTrafficDisabled(error)) {
      return failRun(QBO_PROVIDER_TRAFFIC_DISABLED_CODE, {
        source,
        ...(cdcError ? { cdc_error: cdcError } : {}),
        maintenance_gate: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
      }, { maintenance: true });
    }
    return failRun(String(error?.message || error), { source, ...(cdcError ? { cdc_error: cdcError } : {}) });
  }

  let recorded = 0, skipped = 0, failed = 0;
  const failures = [];
  const paymentReconciliation = [];
  let maintenanceClosed = false;
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
      const r = await syncQboPaymentToUpr(env, db, String(p.Id), { receiptEnabled, expectedRealmId: String(conn.realm_id) });
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
      if (isQboProviderTrafficDisabled(err)) {
        maintenanceClosed = true;
        break;
      }
    }
  }

  // Estimate answers sweep — isolated so it can never break payment reconciliation.
  let estimates;
  try {
    if (maintenanceClosed) throw Object.assign(new Error(QBO_PROVIDER_TRAFFIC_DISABLED_CODE), {
      code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
      reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
      status: 503,
    });
    estimates = await sweepEstimates(env, db, changedSince, String(conn.realm_id));
  } catch (err) {
    if (isQboProviderTrafficDisabled(err)) {
      maintenanceClosed = true;
      estimates = { ok: false, error: QBO_PROVIDER_TRAFFIC_DISABLED_CODE };
    } else {
      console.error('qbo-payments-sync: estimate sweep', err?.message || err);
      estimates = { ok: false, error: String(err?.message || err) };
    }
  }

  let retry;
  try {
    retry = maintenanceClosed
      ? { processed: 0, failed: 0, skipped: QBO_PROVIDER_TRAFFIC_DISABLED_CODE }
      : await drainReceiptRetries(env, db, String(conn.realm_id), { receiptEnabled });
    if (retry.maintenanceClosed) maintenanceClosed = true;
  } catch (err) {
    console.error('qbo-payments-sync: receipt retry drain', err?.message || err);
    retry = { processed: 0, failed: 0, error: String(err?.message || err) };
  }

  let maintenanceRetry;
  try {
    maintenanceRetry = maintenanceClosed
      ? { processed: 0, failed: 0, skipped: QBO_PROVIDER_TRAFFIC_DISABLED_CODE }
      : await drainMaintenanceRetries(env, db, String(conn.realm_id), { receiptEnabled });
    if (maintenanceRetry.maintenanceClosed) maintenanceClosed = true;
  } catch (err) {
    console.error('qbo-payments-sync: maintenance retry drain', err?.message || err);
    maintenanceRetry = { processed: 0, failed: 0, error: String(err?.message || err) };
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
  if (maintenanceRetry.error) problems.push(`maintenance retry drain: ${maintenanceRetry.error}`);
  else if (maintenanceRetry.failed) problems.push(`${maintenanceRetry.failed} maintenance ${maintenanceRetry.failed === 1 ? 'retry' : 'retries'} failed`);
  if (maintenanceClosed) problems.push(QBO_PROVIDER_TRAFFIC_DISABLED_CODE);

  await recordWorkerRun(db, {
    workerName: 'qbo-payments-sync',
    status: problems.length ? 'error' : 'completed',
    recordsProcessed: recorded + retry.processed + maintenanceRetry.processed,
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
      maintenance_retry: maintenanceRetry,
      ...(maintenanceClosed ? { maintenance_gate: QBO_PROVIDER_TRAFFIC_DISABLED_CODE } : {}),
    },
  });

  return maintenanceClosed ? {
    ok: false,
    error: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    code: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
    status: 503,
  } : {
    ok: true, scanned: payments.length, recorded, skipped, failed,
    webhook_missed: recorded, source, estimates, retry, maintenanceRetry,
  };
}

// ─── SECTION: Handlers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboRequest(request, env, db, undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }
  const result = await reconcile(env);
  if (result?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE) return qboProviderTrafficDisabledRouteResponse(request, env);
  return jsonResponse(result, 200, request, env);
}
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboRequest(request, env, db, undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }
  const result = await reconcile(env);
  if (result?.code === QBO_PROVIDER_TRAFFIC_DISABLED_CODE) return qboProviderTrafficDisabledRouteResponse(request, env);
  return jsonResponse(result, 200, request, env);
}
// Cloudflare cron trigger (if configured in wrangler.toml [triggers] crons).
export async function scheduled(event, env, ctx) {
  void ctx;
  try { await requireQboProviderTraffic(env); } catch (error) {
    if (isQboProviderTrafficDisabled(error)) {
      // The global gate deliberately suppresses all QBO reads and projections,
      // but the scheduler must leave a stable, provider-free operational trace.
      // Recording it is best effort: a failed ledger write must not turn a
      // maintenance closure into an unbounded scheduler failure.
      try {
        await recordWorkerRun(supabase(env, fetchWithTimeout), {
          workerName: 'qbo-payments-sync',
          status: 'completed',
          recordsProcessed: 0,
          errorMessage: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
          meta: { maintenance_gate: QBO_PROVIDER_TRAFFIC_DISABLED_CODE },
        });
      } catch (recordError) {
        console.error('qbo-payments-sync: could not record closed maintenance gate', recordError);
      }
      return;
    }
    throw error;
  }
  await reconcile(env);
}
