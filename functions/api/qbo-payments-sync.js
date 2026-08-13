/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payments-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A safety net for QuickBooks webhooks. On a schedule (and on demand), it
 *   reconciles recent payment changes, retries durable receipt work and
 *   provider-boundary events that could not finish, and mirrors customer
 *   estimate answers missed by their webhook.
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
 *   - The seven-day overlap, durable retry queues, and idempotent estimate sync make re-runs safe.
 *     The provider-boundary queue is intentionally not limited to seven days so
 *     maintenance cannot strand an older webhook event.
 *   - Unmapped QBO invoice allocations become stable reconciliation markers;
 *     every retry drain records that marker before closing its source event.
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
import {
  reconcilePaymentResults,
  recordReconciliation,
  reconciliationItem,
  resolvePaymentReconciliation,
  resolveReconciliation,
} from '../lib/qbo-reconciliation.js';
import {
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  isQboProviderTrafficDisabled,
  requireQboProviderTraffic,
} from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';

const MINOR_VERSION = '70';
const CDC_OVERLAP_DAYS = 7;
const QUERY_MAX_RESULTS = 500;
const RECEIPT_PROCESSING_STALE_MS = 10 * 60 * 1000;
// These errors are raised before a QBO provider request when a credential CAS
// or realm re-check races a reconnect. Keep the durable work retryable: the
// next attempt will either see the intended realm again or safely ignore it as
// foreign. They must be stored by code, never an unstable error sentence.
const TRANSIENT_CONNECTION_BOUNDARY_CODES = new Set([
  'qbo-connection-changed',
  'qbo-realm-mismatch',
  'qbo-realm-unavailable',
]);

function transientQboBoundaryCode(error) {
  if (isQboProviderTrafficDisabled(error)) return QBO_PROVIDER_TRAFFIC_DISABLED_CODE;
  const code = typeof error?.code === 'string' ? error.code : null;
  return code && TRANSIENT_CONNECTION_BOUNDARY_CODES.has(code) ? code : null;
}

function stableIntuitTid(value) {
  const tid = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._-]{1,128}$/.test(tid) ? tid : null;
}

// Provider faults can include customer and accounting details. qbo_events and
// worker_runs are durable, broadly visible operational telemetry, so retain
// only a stable classification plus a bounded Intuit correlation id.
export function stableQboErrorCode(error, { prefix = 'qbo' } = {}) {
  const boundaryCode = transientQboBoundaryCode(error);
  if (boundaryCode) return boundaryCode;
  const faultCode = String(error?.faultCode ?? error?.qboCode ?? '').trim();
  const safeFaultCode = /^\d{1,10}$/.test(faultCode) ? faultCode : null;
  const status = Number(error?.status);
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const base = safeFaultCode
    ? `${prefix}_fault_${safeFaultCode}`
    : safeStatus
      ? `${prefix}_http_${safeStatus}`
      : error?.retryable === true
        ? `${prefix}_retryable_failure`
        : `${prefix}_failure`;
  const tid = stableIntuitTid(error?.intuitTid);
  return tid ? `${base} [intuit_tid:${tid}]` : base;
}

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
        const code = String(err.code || '').trim();
        return /^\d{1,10}$/.test(code) ? `qbo_cdc_fault_${code}` : 'qbo_cdc_fault';
      }
    }
  }
  return null;
}

function reconciliationDelegationError(delegated) {
  if (!delegated?.length) return null;
  const ids = delegated.map((item) => item.id).join(',');
  const reasons = delegated
    .map((item) => `${item.entity}=${item.qboId}:${item.reason}`)
    .join(',');
  return `reconciliation_delegated: ${ids}; ${reasons}`.slice(0, 500);
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
  const reconciliation = [];
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
      let delegated = [];
      const operation = String(event.operation || '');
      if (['Delete', 'Void', 'Merge'].includes(operation)) {
        await removeQboPaymentFromUpr(db, event.qbo_entity_id, {
          receiptEnabled: true,
          status: operation === 'Delete' ? 'deleted' : 'voided',
          eventKey: event.id,
          realmId,
          env,
        });
        await resolvePaymentReconciliation(db, realmId, event.qbo_entity_id);
      } else {
        const outcome = await syncQboPaymentToUpr(env, db, event.qbo_entity_id, {
          receiptEnabled: true,
          expectedRealmId: String(realmId),
        });
        delegated = await reconcilePaymentResults(
          db,
          realmId,
          event.qbo_entity_id,
          outcome?.results,
        );
        reconciliation.push(...delegated);
      }
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: 'processed',
        error: reconciliationDelegationError(delegated),
        processed_at: new Date().toISOString(),
        next_retry_at: null,
        retry_count: Number(event.retry_count || 0) + 1,
      });
      processed++;
    } catch (error) {
      const retryCount = Number(event.retry_count || 0) + 1;
      const boundaryCode = transientQboBoundaryCode(error);
      const transientDatabaseFailure =
        /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(error?.message || ''));
      // A known connection/realm boundary occurs before provider work, so it is
      // safe to keep retrying even after ordinary transient retries are capped.
      const retryable = Boolean(boundaryCode)
        || ((error?.retryable === true || transientDatabaseFailure) && retryCount < 8);
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: retryable ? 'retry' : 'error',
        error: boundaryCode || stableQboErrorCode(error),
        retry_count: retryCount,
        next_retry_at: retryable
          ? new Date(Date.now() + Math.min(6 * 60, 5 * (2 ** retryCount)) * 60 * 1000).toISOString()
          : null,
      });
      failed++;
    }
  }
  const result = { processed, failed };
  if (reconciliation.length) {
    result.reconciliation_count = reconciliation.length;
    result.reconciliation_reasons = reconciliation.map((item) => item.reason);
  }
  return result;
}

async function persistCdcFailure(env, db, realmId, payment, error, receiptEnabled) {
  const eventId = `cdc-retry:${realmId}:${payment.Id}:${payment.MetaData?.LastUpdatedTime || payment.SyncToken || 'current'}`;
  const boundaryCode = transientQboBoundaryCode(error);
  // Receipt-mode failures already have a durable claim RPC. Legacy projection
  // intentionally does not queue ordinary failures, but a maintenance or
  // credential/realm boundary must survive beyond the seven-day CDC window.
  // Insert the complete retry identity atomically so a crash cannot strand a
  // claimed row without the provider entity needed by the independent drain.
  if (!receiptEnabled && !boundaryCode) return;
  const retryable = Boolean(boundaryCode) || error?.retryable === true
    || /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(error?.message || ''));
  // A failed REMOVAL must retry as a removal: drainReceiptRetries routes by the
  // stored operation, and a 'CDC' tag would re-run the sync path, which resolves
  // a deleted payment as benign payment-not-found and never completes the removal.
  const operation = String(payment?.status || '').toLowerCase() === 'deleted' ? 'Delete' : 'CDC';
  try {
    if (!receiptEnabled) {
      await db.insert('qbo_events', {
        id: eventId,
        entity: 'Payment',
        operation,
        status: 'retry',
        error: boundaryCode,
        qbo_realm_id: String(realmId),
        qbo_entity_id: String(payment.Id),
        provider_updated_at: payment.MetaData?.LastUpdatedTime || null,
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      return;
    }
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
      error: boundaryCode || stableQboErrorCode(error),
      next_retry_at: retryable ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
    });
  } catch (queueError) {
    if (/(?:\b409\b|\b23505\b|duplicate key|unique constraint)/i.test(String(queueError?.message || queueError || ''))) {
      return;
    }
    console.error('qbo-payments-sync: could not persist CDC failure', stableQboErrorCode(queueError));
  }
}

// ─── SECTION: Durable provider-boundary retry queue ────
// Maintenance and connection-race webhooks persist their full provider identity
// in qbo_events. This queue is deliberately independent of the receipt rollout
// flag: it replays a Payment through whichever projection mode is active and an
// Estimate through its established sync. Unlike the seven-day provider sweep,
// it has no provider-time window, so a closed gate cannot lose older work.
const PROVIDER_BOUNDARY_RETRY_CODES = [
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  ...TRANSIENT_CONNECTION_BOUNDARY_CODES,
];

export async function drainProviderBoundaryRetries(env, db, realmId, { receiptEnabled = false } = {}) {
  const now = new Date().toISOString();
  const events = await db.select(
    'qbo_events',
    `entity=in.(Payment,Estimate)&status=eq.retry&error=in.(${PROVIDER_BOUNDARY_RETRY_CODES.join(',')})&qbo_realm_id=not.is.null&qbo_entity_id=not.is.null&or=(next_retry_at.is.null,next_retry_at.lte.${encodeURIComponent(now)})&select=id,entity,operation,qbo_realm_id,qbo_entity_id,retry_count&order=created_at.asc&limit=100`,
  );
  let processed = 0;
  let failed = 0;
  const reconciliation = [];
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
      let delegated = [];
      if (event.entity === 'Payment') {
        const operation = String(event.operation || '');
        if (['Delete', 'Void', 'Merge'].includes(operation)) {
          await removeQboPaymentFromUpr(db, event.qbo_entity_id, {
            receiptEnabled,
            status: operation === 'Delete' ? 'deleted' : 'voided',
            eventKey: event.id,
            realmId: String(realmId),
            env,
          });
          await resolvePaymentReconciliation(db, realmId, event.qbo_entity_id);
        } else {
          const outcome = await syncQboPaymentToUpr(env, db, event.qbo_entity_id, {
            receiptEnabled,
            expectedRealmId: String(realmId),
          });
          delegated = await reconcilePaymentResults(
            db,
            realmId,
            event.qbo_entity_id,
            outcome?.results,
          );
        }
      } else {
        const outcome = await syncQboEstimateToUpr(env, db, String(event.qbo_entity_id), {
          expectedRealmId: String(realmId),
        });
        const item = reconciliationItem('Estimate', event.qbo_entity_id, outcome?.result);
        if (item) delegated = [await recordReconciliation(db, item)];
        else await resolveReconciliation(db, 'Estimate', event.qbo_entity_id);
      }
      reconciliation.push(...delegated.filter(Boolean));
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: 'processed',
        error: reconciliationDelegationError(delegated),
        processed_at: new Date().toISOString(),
        next_retry_at: null,
        retry_count: Number(event.retry_count || 0) + 1,
      });
      processed++;
    } catch (error) {
      const retryCount = Number(event.retry_count || 0) + 1;
      const boundaryCode = transientQboBoundaryCode(error);
      const transientDatabaseFailure =
        /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(error?.message || ''));
      const retryable = Boolean(boundaryCode)
        || ((error?.retryable === true || transientDatabaseFailure) && retryCount < 8);
      await db.update('qbo_events', `id=eq.${encodeURIComponent(event.id)}`, {
        status: retryable ? 'retry' : 'error',
        error: boundaryCode || stableQboErrorCode(error),
        retry_count: retryCount,
        next_retry_at: retryable
          ? new Date(Date.now() + Math.min(6 * 60, 5 * (2 ** retryCount)) * 60 * 1000).toISOString()
          : null,
      });
      failed++;
    }
  }
  return {
    processed,
    failed,
    reconciliation_count: reconciliation.length,
      reconciliation_reasons: reconciliation.map((item) => item.reason),
  };
}

// Customer answers worth mirroring; Pending/Closed estimates are noise.
const ESTIMATE_STATUSES_TO_SYNC = new Set(['Accepted', 'Rejected', 'Converted']);

// ─── SECTION: Estimate sweep ──────────────
// Mirror recent QBO estimate answers (accept/decline/convert) into UPR. The
// real-time path is the Estimate webhook; this sweep catches anything missed.
async function sweepEstimates(env, db, since, expectedRealmId) {
  const q = `SELECT Id, TxnStatus FROM Estimate WHERE MetaData.LastUpdatedTime >= '${since}' MAXRESULTS 500`;
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
  if (!res.ok) return { ok: false, error: `qbo_estimate_query_http_${res.status}` };
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
      console.error('qbo-payments-sync: estimate sync failed', stableQboErrorCode(err));
      // Connection and realm boundaries happen before any provider work. If we
      // swallowed them here, the worker would falsely report a green estimate
      // sweep while durable provider work had been skipped.
      if (transientQboBoundaryCode(err)) throw err;
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
  if (!conn || !conn.refresh_token || !conn.realm_id) return { ok: false, error: 'QuickBooks not connected' };
  const expectedRealmId = String(conn.realm_id);

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
    const cdc = await qboFetch(env, `/cdc?entities=Payment&changedSince=${encodeURIComponent(changedSince)}&minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
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
      const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
      if (!res.ok) return failRun(`QBO query ${res.status} (cdc: ${cdcError})`, { source, cdc_error: cdcError });
      payments = (await res.json().catch(() => ({})))?.QueryResponse?.Payment || [];
    }
  } catch (error) {
    return failRun(stableQboErrorCode(error), { source, ...(cdcError ? { cdc_error: cdcError } : {}) });
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
        await resolvePaymentReconciliation(db, expectedRealmId, p.Id);
        skipped++;
        continue;
      }
      const r = await syncQboPaymentToUpr(env, db, String(p.Id), { receiptEnabled, expectedRealmId });
      for (const x of (r.results || [])) {
        if (x.recorded) recorded++; else skipped++;
      }
      paymentReconciliation.push(...await reconcilePaymentResults(
        db,
        expectedRealmId,
        p.Id,
        r.results,
      ));
    } catch (err) {
      console.error('qbo-payments-sync: payment sync failed', stableQboErrorCode(err));
      await persistCdcFailure(env, db, String(conn.realm_id), p, err, receiptEnabled);
      failed++;
      if (failures.length < 5) failures.push(`payment ${p.Id}: ${stableQboErrorCode(err)}`);
    }
  }

  // Estimate answers sweep — isolated so it can never break payment reconciliation.
  let estimates;
  try {
    estimates = await sweepEstimates(env, db, changedSince, expectedRealmId);
  } catch (err) {
    console.error('qbo-payments-sync: estimate sweep failed', stableQboErrorCode(err));
    estimates = { ok: false, error: stableQboErrorCode(err) };
  }

  let retry;
  try {
    retry = await drainReceiptRetries(env, db, expectedRealmId, { receiptEnabled });
  } catch (err) {
    console.error('qbo-payments-sync: receipt retry drain failed', stableQboErrorCode(err));
    retry = { processed: 0, failed: 0, error: stableQboErrorCode(err) };
  }

  let providerBoundaryRetry;
  try {
    providerBoundaryRetry = await drainProviderBoundaryRetries(env, db, expectedRealmId, { receiptEnabled });
  } catch (err) {
    console.error('qbo-payments-sync: provider-boundary retry drain failed', stableQboErrorCode(err));
    providerBoundaryRetry = { processed: 0, failed: 0, error: stableQboErrorCode(err) };
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
  if (providerBoundaryRetry.error) problems.push(`provider-boundary retry drain: ${providerBoundaryRetry.error}`);
  else if (providerBoundaryRetry.failed) problems.push(`${providerBoundaryRetry.failed} provider-boundary ${providerBoundaryRetry.failed === 1 ? 'retry' : 'retries'} failed`);

  await recordWorkerRun(db, {
    workerName: 'qbo-payments-sync',
    status: problems.length ? 'error' : 'completed',
    recordsProcessed: recorded + retry.processed + providerBoundaryRetry.processed,
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
      provider_boundary_retry: providerBoundaryRetry,
      reconciliation_count: paymentReconciliation.length
        + (estimates?.reconciliation_count || 0)
        + (retry?.reconciliation_count || 0)
        + (providerBoundaryRetry?.reconciliation_count || 0),
      reconciliation_reasons: [
        ...paymentReconciliation.map((item) => item.reason),
        ...(estimates?.reconciliation_reasons || []),
        ...(retry?.reconciliation_reasons || []),
        ...(providerBoundaryRetry?.reconciliation_reasons || []),
      ],
      retry,
    },
  });

  return {
    ok: true, scanned: payments.length, recorded, skipped, failed,
    webhook_missed: recorded, source, estimates, retry, provider_boundary_retry: providerBoundaryRetry,
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
  try { await requireQboProviderTraffic(env); } catch (error) {
    if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env);
    throw error;
  }
  return jsonResponse(await reconcile(env), 200, request, env);
}
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await authorizeQboRequest(request, env, supabase(env, fetchWithTimeout), undefined, QBO_ADMIN_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);
  try { await requireQboProviderTraffic(env); } catch (error) {
    if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env);
    throw error;
  }
  return jsonResponse(await reconcile(env), 200, request, env);
}
// Cloudflare cron trigger (if configured in wrangler.toml [triggers] crons).
export async function scheduled(event, env, ctx) {
  void ctx;
  try {
    await requireQboProviderTraffic(env);
  } catch (error) {
    if (isQboProviderTrafficDisabled(error)) {
      try {
        await recordWorkerRun(supabase(env, fetchWithTimeout), {
          workerName: 'qbo-payments-sync',
          status: 'completed',
          recordsProcessed: 0,
          errorMessage: null,
          meta: {
            maintenance_gate: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
            reason: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
          },
        });
      } catch { /* best-effort maintenance telemetry */ }
      return;
    }
    throw error;
  }
  await reconcile(env);
}
