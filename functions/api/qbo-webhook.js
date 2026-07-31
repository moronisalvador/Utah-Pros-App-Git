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
import { recordReconciliation, reconciliationItem, resolveReconciliation } from '../lib/qbo-reconciliation.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

// Entities this endpoint mirrors into UPR; anything else is skipped before claiming.
const SYNCED_ENTITIES = new Set(['Payment', 'Estimate']);

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

  // The realm a notification carries is the company the change happened in. Every QBO read we
  // make is scoped to the realm on our STORED connection (qboFetch builds
  // /v3/company/{conn.realm_id}/...), so an event from any other realm would silently be looked
  // up in the wrong company — and Intuit answers that with a bare 400. Resolve our realm once
  // and refuse any event unless both realms are present and exactly equal. This must fail
  // closed: without a resolved stored realm, qboFetch could read an arbitrary entity from a
  // different company and the subsequent sync could mutate UPR business records.
  let ourRealmId = null;
  try {
    const conn = await getConnection(env);
    ourRealmId = conn?.realm_id ? String(conn.realm_id) : null;
  } catch (err) {
    console.error('qbo-webhook: cannot resolve QBO connection realm', err);
  }

  for (const note of notifications) {
    const realmId = typeof note.realmId === 'string' ? note.realmId.trim() : '';
    const entities = note.dataChangeEvent?.entities || [];
    for (const e of entities) {
      if (!SYNCED_ENTITIES.has(e.name)) continue;

      const key = await sha256hex(`${realmId}:${e.name}:${e.id}:${e.operation}:${e.lastUpdated || ''}`);
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
        console.error('qbo-webhook: event claim failed', err);
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
          error: 'realm_unavailable: connected QBO realm could not be resolved',
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
          outcome = await syncQboEstimateToUpr(env, db, String(e.id));
          const item = reconciliationItem('Estimate', e.id, outcome?.result);
          if (item) reconciliationItems.push(await recordReconciliation(db, item));
          else await resolveReconciliation(db, 'Estimate', e.id);
        } else if (op === 'Delete' || op === 'Void' || op === 'Merge') {
          await removeQboPaymentFromUpr(db, String(e.id), {
            receiptEnabled,
            status: op === 'Delete' ? 'deleted' : 'voided',
            eventKey: key,
            realmId: String(realmId || ourRealmId || ''),
          });
        } else {
          outcome = await syncQboPaymentToUpr(env, db, String(e.id), { receiptEnabled });
          for (const result of (outcome?.results || [])) {
            const entity = result?.qboInvoiceId ? 'Invoice' : 'Payment';
            const qboId = result?.qboInvoiceId || e.id;
            const item = reconciliationItem(entity, qboId, result);
            if (item) reconciliationItems.push(await recordReconciliation(db, item));
            else await resolveReconciliation(db, entity, qboId);
          }
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
        console.error('qbo-webhook process error', e.id, err);
        // We always ack 200 to Intuit (it retries only at 20/30/50 min and then DISABLES the
        // endpoint), so recovery is ours to own. Distinguish "try again" from "never will
        // work" instead of flattening both to 'error' with no way to tell them apart.
        const retryable = err?.retryable === true
          || /Supabase (?:SELECT|UPDATE|RPC|INSERT|DELETE) [^:]+: 5\d\d\b/.test(String(err?.message || ''));
        await db.update('qbo_events', `id=eq.${key}`, {
          status: retryable ? 'retry' : 'error',
          error: String(err?.message || err).slice(0, 500),
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
