/**
 * ════════════════════════════════════════════════
 * FILE: qbo-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Listens for QuickBooks Payment and Estimate changes. Payment notices are
 *   durably claimed, acknowledged, and reconciled (or removed) as complete
 *   receipts; estimate answers are mirrored into their existing UPR workflow.
 *
 * WHERE IT LIVES:
 *   Route:   POST /api/qbo-webhook   (set this URL in the Intuit Developer dashboard → Webhooks)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  lib/supabase.js, lib/cors.js, lib/intuit.js, lib/qbo-payment-sync.js,
 *              lib/qbo-estimate-sync.js, lib/quickbooks.js (getConnection)
 *   Data:      reads/writes → qbo_events and receipt service RPCs; payment projections
 *              feed the existing invoice balance trigger; estimate updates run through
 *              qbo-estimate-sync and its existing notification path.
 *
 * NOTES / GOTCHAS:
 *   - Requires QBO_WEBHOOK_VERIFIER_TOKEN (Intuit Developer → Webhooks → Verifier Token).
 *     Distinct from QBO_WEBHOOK_SECRET (internal DB-trigger auth). If unset, we ack 200
 *     and ignore — inert until configured, so deploying this is safe.
 *   - We handle Payment and Estimate entities. The Intuit Developer dashboard must
 *     subscribe BOTH entity types to this endpoint, or the events never arrive
 *     (the hourly qbo-payments-sync sweep is the safety net either way). Payment
 *     claims use the receipt-aware RPC only while its rollout gate is enabled;
 *     Estimate claims retain the established event contract. Each event is claimed
 *     once (idempotent) so duplicate Intuit deliveries no-op.
 *   - Always returns 200 quickly after claiming so Intuit doesn't hammer retries;
 *     retryable provider failures stay on the claimed event; manual decisions are
 *     delegated to deterministic `reconcile:*` rows so the provider event itself
 *     can finish terminally instead of becoming a second stale to-do item.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { verifyIntuitSignature, sha256hex } from '../lib/intuit.js';
import { syncQboPaymentToUpr, removeQboPaymentFromUpr } from '../lib/qbo-payment-sync.js';
import { syncQboEstimateToUpr } from '../lib/qbo-estimate-sync.js';
import { isReceivePaymentsGateOpen } from '../lib/qbo-receipt.js';
import { getConnection } from '../lib/quickbooks.js';
import {
  reconcilePaymentResults,
  recordReconciliation,
  reconciliationItem,
  resolvePaymentReconciliation,
  resolveReconciliation,
} from '../lib/qbo-reconciliation.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import {
  QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
  requireQboProviderTraffic,
  isQboProviderTrafficDisabled,
} from '../lib/qbo-provider-traffic.js';

// Entities this endpoint mirrors into UPR; anything else is skipped before claiming.
const SYNCED_ENTITIES = new Set(['Payment', 'Estimate']);
// A credential CAS loss or a realm re-check failure happens before the provider
// request. It is safe to retry the durable event: a later attempt either finds
// the intended realm again or classifies the now-foreign event as ignored.
const TRANSIENT_CONNECTION_BOUNDARY_CODES = new Set([
  'qbo-connection-changed',
  'qbo-realm-mismatch',
  'qbo-realm-unavailable',
]);

function transientConnectionBoundaryCode(error) {
  const code = typeof error?.code === 'string' ? error.code : null;
  return code && TRANSIENT_CONNECTION_BOUNDARY_CODES.has(code) ? code : null;
}

function stableIntuitTid(value) {
  const tid = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._-]{1,128}$/.test(tid) ? tid : null;
}

// qbo_events is durable operational telemetry. Never preserve an upstream
// message or Fault Detail there; those often carry customer/accounting data.
function stableWebhookErrorCode(error) {
  if (isQboProviderTrafficDisabled(error)) return QBO_PROVIDER_TRAFFIC_DISABLED_CODE;
  const boundaryCode = transientConnectionBoundaryCode(error);
  if (boundaryCode) return boundaryCode;
  const faultCode = String(error?.faultCode ?? error?.qboCode ?? '').trim();
  const safeFaultCode = /^\d{1,10}$/.test(faultCode) ? faultCode : null;
  const status = Number(error?.status);
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const base = safeFaultCode
    ? `qbo_fault_${safeFaultCode}`
    : safeStatus
      ? `qbo_http_${safeStatus}`
      : error?.retryable === true
        ? 'qbo_retryable_failure'
        : 'qbo_failure';
  const tid = stableIntuitTid(error?.intuitTid);
  return tid ? `${base} [intuit_tid:${tid}]` : base;
}

function isDuplicateEventInsert(error) {
  const message = String(error?.message || error || '');
  return /(?:\b409\b|\b23505\b|duplicate key|unique constraint)/i.test(message);
}

// Maintenance must not first claim a legacy Estimate and then PATCH it to retry:
// if that second write fails, the durable row is stuck in processing without the
// entity metadata that lets the sweep recover it. Insert the complete retry row in
// one statement instead. A duplicate is deliberately a no-op so terminal rows are
// never reopened by an Intuit redelivery while provider traffic is closed.
async function persistMaintenanceRetry(db, event) {
  try {
    await db.insert('qbo_events', {
      id: event.id,
      entity: event.entity,
      operation: event.operation,
      status: 'retry',
      error: QBO_PROVIDER_TRAFFIC_DISABLED_CODE,
      qbo_realm_id: event.realmId,
      qbo_entity_id: event.entityId,
      provider_updated_at: event.providerUpdatedAt,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    return true;
  } catch (error) {
    if (isDuplicateEventInsert(error)) return false;
    // Intuit must still receive a 200. If the ledger is unavailable, the
    // provider's CDC/estimate sweeps are the safe recovery backstop.
    console.error('qbo-webhook: maintenance event persistence failed', stableWebhookErrorCode(error));
    return false;
  }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ─── SECTION: Handler ──────────────
// public: Intuit-signed QuickBooks Payment webhook notifications.
export async function onRequestPost(context) {
  const { request, env } = context;
  const raw = await request.text();

  // Inert until configured — ack so Intuit doesn't retry forever.
  if (!env.QBO_WEBHOOK_VERIFIER_TOKEN) {
    console.warn('qbo-webhook: QBO_WEBHOOK_VERIFIER_TOKEN not set — ignoring event');
    return jsonResponse({ ok: true, ignored: 'not configured' }, 200, request, env);
  }

  const sig = request.headers.get('intuit-signature');
  const valid = await verifyIntuitSignature(raw, sig, env.QBO_WEBHOOK_VERIFIER_TOKEN);
  if (!valid) return jsonResponse({ error: 'invalid signature' }, 401, request, env);

  let body = {};
  try { body = JSON.parse(raw); } catch { return jsonResponse({ ok: true, ignored: 'bad json' }, 200, request, env); }

  const db = supabase(env, fetchWithTimeout);
  const receiptEnabled = await isReceivePaymentsGateOpen(env, db);
  const notifications = Array.isArray(body.eventNotifications) ? body.eventNotifications : [];
  const pending = [];
  let trafficDisabled = false;
  try { await requireQboProviderTraffic(env); } catch (error) {
    if (isQboProviderTrafficDisabled(error)) trafficDisabled = true;
    else throw error;
  }

  // The realm a notification carries is the company the change happened in. Every QBO read we
  // make is scoped to the realm on our STORED connection (qboFetch builds
  // /v3/company/{conn.realm_id}/...), so an event from any other realm would silently be looked
  // up in the wrong company — and Intuit answers that with a bare 400. Resolve our realm once
  // and refuse any event unless both realms are present and exactly equal. This must fail
  // closed: without a resolved stored realm, qboFetch could read an arbitrary entity from a
  // different company and the subsequent sync could mutate UPR business records.
  let ourRealmId = null;
  if (!trafficDisabled) {
    try {
      const conn = await getConnection(env);
      ourRealmId = conn?.realm_id ? String(conn.realm_id) : null;
    } catch (err) {
      console.error('qbo-webhook: cannot resolve QBO connection realm', stableWebhookErrorCode(err));
    }
  }

  for (const note of notifications) {
    const realmId = typeof note.realmId === 'string' ? note.realmId.trim() : '';
    const entities = note.dataChangeEvent?.entities || [];
    for (const e of entities) {
      if (!SYNCED_ENTITIES.has(e.name)) continue;

      const key = await sha256hex(`${realmId}:${e.name}:${e.id}:${e.operation}:${e.lastUpdated || ''}`);
      // During a provider maintenance window, atomically persist the full retry
      // identity before any connection lookup. This is intentionally separate
      // from the historical claim RPC: that RPC's legacy Estimate signature has
      // no realm/entity metadata and cannot be safely patched after a failure.
      if (trafficDisabled) {
        await persistMaintenanceRetry(db, {
          id: key,
          entity: e.name,
          operation: String(e.operation || ''),
          realmId: String(realmId || ''),
          entityId: String(e.id || ''),
          providerUpdatedAt: e.lastUpdated || null,
        });
        continue;
      }

      let claimed = false;
      try {
        claimed = e.name === 'Payment' && receiptEnabled
          ? await db.rpc('claim_qbo_receipt_event', {
              p_id: key,
              p_entity: e.name,
              p_operation: e.operation,
              p_realm_id: String(realmId || ''),
              p_entity_id: String(e.id),
              p_provider_updated_at: e.lastUpdated || null,
            })
          : await db.rpc('claim_qbo_event', {
              p_id: key,
              p_entity: e.name,
              p_operation: e.operation,
            });
      } catch (err) {
        console.error('qbo-webhook: event claim failed', stableWebhookErrorCode(err));
        continue; // can't claim → skip rather than risk double-processing
      }
      if (!claimed) continue; // duplicate delivery

      // A missing stored realm may be transient, so preserve it for the recovery path without
      // reading QBO or mutating UPR business data. We still claim it first, keeping duplicate
      // delivery protection and the 200 acknowledgement contract intact.
      if (!ourRealmId) {
        console.warn('qbo-webhook: ignoring event until the connected realm can be resolved');
        await db.update('qbo_events', `id=eq.${key}`, {
          status: 'retry',
          error: 'qbo-realm-unavailable',
          // The retry drain must retain the provider identity even for legacy
          // claims, whose original RPC signature has no metadata columns.
          qbo_realm_id: String(realmId || ''),
          qbo_entity_id: String(e.id || ''),
          provider_updated_at: e.lastUpdated || null,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        continue;
      }

      // A notification without a realm is malformed and cannot safely be scoped. Terminal by
      // nature — it cannot become attributable to this connected company later.
      if (!realmId) {
        console.warn('qbo-webhook: ignoring event without a realm');
        await db.update('qbo_events', `id=eq.${key}`, {
          status: 'ignored',
          error: 'realm_missing: event realm is blank',
          processed_at: new Date().toISOString(),
        });
        continue;
      }

      // Cross-realm event: never read it out of the wrong company. Terminal by nature — a
      // different company's record will never become ours, so this is not retry-eligible.
      if (realmId !== ourRealmId) {
        console.warn('qbo-webhook: ignoring event from another realm', realmId);
        await db.update('qbo_events', `id=eq.${key}`, {
          status: 'ignored',
          error: `realm_mismatch: event realm ${realmId} is not the connected realm`,
          processed_at: new Date().toISOString(),
        });
        continue;
      }

      const processClaimed = async () => {
       try {
        const op = String(e.operation || '');
        let outcome;
        let reconciliationItems = [];
        if (e.name === 'Estimate') {
          if (op === 'Delete' || op === 'Void' || op === 'Merge') {
            // UPR owns estimate deletion (qbo-estimate.js action:'delete' clears the
            // link itself); a QBO-side delete is not mirrored automatically.
            await db.update('qbo_events', `id=eq.${key}`, {
              status: 'ignored',
              error: `estimate ${op.toLowerCase()} is not mirrored`,
              processed_at: new Date().toISOString(),
            });
            return;
          }
          outcome = await syncQboEstimateToUpr(env, db, String(e.id), { expectedRealmId: realmId });
          const item = reconciliationItem('Estimate', e.id, outcome?.result);
          if (item) reconciliationItems.push(await recordReconciliation(db, item));
          else await resolveReconciliation(db, 'Estimate', e.id);
        } else if (op === 'Delete' || op === 'Void' || op === 'Merge') {
          await removeQboPaymentFromUpr(db, String(e.id), {
            receiptEnabled,
            status: op === 'Delete' ? 'deleted' : 'voided',
            eventKey: key,
            realmId: String(realmId || ourRealmId || ''),
            env,
          });
          await resolvePaymentReconciliation(db, realmId, e.id);
        } else {
          outcome = await syncQboPaymentToUpr(env, db, String(e.id), { receiptEnabled, expectedRealmId: realmId });
          reconciliationItems = await reconcilePaymentResults(
            db,
            realmId,
            e.id,
            outcome?.results,
          );
        }
        if (reconciliationItems.length) {
          const reasons = reconciliationItems.map((item) => `${item.entity}=${item.qboId}:${item.reason}`).join(', ');
          const delegatedIds = reconciliationItems.map((item) => item.id).join(', ');
          await db.update('qbo_events', `id=eq.${key}`, {
            status: 'processed',
            error: `reconciliation_delegated: ${delegatedIds}; ${reasons}`.slice(0, 500),
            processed_at: new Date().toISOString(),
          });
          await recordWorkerRun(db, {
            workerName: 'qbo-webhook', status: 'error', recordsProcessed: 0,
            errorMessage: `needs_reconciliation: ${reasons}`,
            meta: { reconciliation_count: reconciliationItems.length, reconciliation_reasons: reconciliationItems.map((item) => item.reason) },
          });
        } else {
          await db.update('qbo_events', `id=eq.${key}`, { status: 'processed', processed_at: new Date().toISOString() });
        }
      } catch (err) {
        console.error('qbo-webhook: event processing failed', stableWebhookErrorCode(err));
        // We always ack 200 to Intuit (it retries only at 20/30/50 min and then DISABLES the
        // endpoint), so recovery is ours to own. Distinguish "try again" from "never will
        // work" instead of flattening both to 'error' with no way to tell them apart.
        const maintenanceClosed = isQboProviderTrafficDisabled(err);
        const connectionBoundary = transientConnectionBoundaryCode(err);
        const retryable = maintenanceClosed || Boolean(connectionBoundary) || err?.retryable === true
          || /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(err?.message || ''));
        await db.update('qbo_events', `id=eq.${key}`, {
          status: retryable ? 'retry' : 'error',
          error: maintenanceClosed
            ? QBO_PROVIDER_TRAFFIC_DISABLED_CODE
            : connectionBoundary
              ? connectionBoundary
            : stableWebhookErrorCode(err),
          // The legacy Estimate claim RPC stores no provider identity. Add it
          // on a mid-run maintenance flip so the exact-marker recovery drain
          // can safely resume this already-claimed event after reopening.
          ...(maintenanceClosed || connectionBoundary ? {
            qbo_realm_id: String(realmId || ''),
            qbo_entity_id: String(e.id || ''),
            provider_updated_at: e.lastUpdated || null,
          } : {}),
          ...(retryable ? { next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() } : {}),
        });
      }
      };
      pending.push(processClaimed);
    }
  }

  // Intuit requires a quick acknowledgement and warns that notifications may be
  // out of order. The durable claims above are the queue; one background runner
  // processes this envelope linearly while receipt RPCs serialize across envelopes.
  const runPending = async () => {
    for (const task of pending) await task();
  };
  if (typeof context.waitUntil === 'function') context.waitUntil(runPending());
  else await runPending();

  return jsonResponse({ ok: true }, 200, request, env);
}
