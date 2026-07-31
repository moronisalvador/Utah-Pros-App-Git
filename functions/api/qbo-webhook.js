/**
 * ════════════════════════════════════════════════
 * FILE: qbo-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Listens for messages from QuickBooks about things a customer did. When a
 *   customer pays a QuickBooks invoice online (card / bank), we record that
 *   payment in UPR so the invoice's balance is up to date. When a customer
 *   accepts or declines a QuickBooks estimate online, we mark the UPR estimate
 *   accordingly — an acceptance also converts it into a draft UPR invoice and
 *   notifies the admins — automatically, with no manual entry.
 *
 * WHERE IT LIVES:
 *   Route:   POST /api/qbo-webhook   (set this URL in the Intuit Developer dashboard → Webhooks)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  lib/supabase.js, lib/cors.js, lib/intuit.js, lib/qbo-payment-sync.js,
 *              lib/qbo-estimate-sync.js, lib/quickbooks.js (getConnection)
 *   Data:      reads/writes via claim_qbo_event RPC + qbo_events; records into `payments`
 *              (through qbo-payment-sync), which the update_invoice_paid trigger rolls up;
 *              updates `estimates` (through qbo-estimate-sync), whose status trigger
 *              sends the estimate.accepted notification.
 *
 * NOTES / GOTCHAS:
 *   - Requires QBO_WEBHOOK_VERIFIER_TOKEN (Intuit Developer → Webhooks → Verifier Token).
 *     Distinct from QBO_WEBHOOK_SECRET (internal DB-trigger auth). If unset, we ack 200
 *     and ignore — inert until configured, so deploying this is safe.
 *   - We handle Payment and Estimate entities. The Intuit Developer dashboard must
 *     subscribe BOTH entity types to this endpoint, or the events never arrive
 *     (the hourly qbo-payments-sync sweep is the safety net either way). Each event
 *     is claimed once (idempotent) so duplicate Intuit deliveries no-op.
 *   - Always returns 200 quickly after claiming so Intuit doesn't hammer retries;
 *     per-event failures are recorded on qbo_events.error for later inspection.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { verifyIntuitSignature, sha256hex } from '../lib/intuit.js';
import { syncQboPaymentToUpr, removeQboPaymentFromUpr } from '../lib/qbo-payment-sync.js';
import { syncQboEstimateToUpr } from '../lib/qbo-estimate-sync.js';
import { getConnection } from '../lib/quickbooks.js';

// Entities this endpoint mirrors into UPR; anything else is skipped before claiming.
const SYNCED_ENTITIES = new Set(['Payment', 'Estimate']);

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ─── SECTION: Handler ──────────────
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

  const db = supabase(env);
  const notifications = Array.isArray(body.eventNotifications) ? body.eventNotifications : [];

  // The realm a notification carries is the company the change happened in. Every QBO read we
  // make is scoped to the realm on our STORED connection (qboFetch builds
  // /v3/company/{conn.realm_id}/...), so an event from any other realm would silently be looked
  // up in the wrong company — and Intuit answers that with a bare 400. Resolve our realm once
  // and refuse mismatches explicitly instead of issuing a cross-company read.
  let ourRealmId = null;
  try {
    const conn = await getConnection(env);
    ourRealmId = conn?.realm_id ? String(conn.realm_id) : null;
  } catch (err) {
    console.error('qbo-webhook: cannot resolve QBO connection realm', err);
  }

  for (const note of notifications) {
    const realmId = note.realmId || '';
    const entities = note.dataChangeEvent?.entities || [];
    for (const e of entities) {
      if (!SYNCED_ENTITIES.has(e.name)) continue;

      const key = await sha256hex(`${realmId}:${e.name}:${e.id}:${e.operation}:${e.lastUpdated || ''}`);
      let claimed = false;
      try {
        claimed = await db.rpc('claim_qbo_event', { p_id: key, p_entity: e.name, p_operation: e.operation });
      } catch (err) {
        console.error('qbo-webhook: claim_qbo_event failed', err);
        continue; // can't claim → skip rather than risk double-processing
      }
      if (!claimed) continue; // duplicate delivery

      // Cross-realm event: never read it out of the wrong company. Terminal by nature — a
      // different company's record will never become ours, so this is not retry-eligible.
      if (ourRealmId && realmId && realmId !== ourRealmId) {
        console.warn('qbo-webhook: ignoring event from another realm', realmId);
        await db.update('qbo_events', `id=eq.${key}`, {
          status: 'ignored',
          error: `realm_mismatch: event realm ${realmId} is not the connected realm`,
          processed_at: new Date().toISOString(),
        });
        continue;
      }

      try {
        const op = String(e.operation || '');
        if (e.name === 'Estimate') {
          if (op === 'Delete' || op === 'Void' || op === 'Merge') {
            // UPR owns estimate deletion (qbo-estimate.js action:'delete' clears the
            // link itself); a QBO-side delete is not mirrored automatically.
            await db.update('qbo_events', `id=eq.${key}`, {
              status: 'ignored',
              error: `estimate ${op.toLowerCase()} is not mirrored`,
              processed_at: new Date().toISOString(),
            });
            continue;
          }
          await syncQboEstimateToUpr(env, db, String(e.id));
        } else if (op === 'Delete' || op === 'Void' || op === 'Merge') {
          await removeQboPaymentFromUpr(db, String(e.id));
        } else {
          await syncQboPaymentToUpr(env, db, String(e.id));
        }
        await db.update('qbo_events', `id=eq.${key}`, { status: 'processed', processed_at: new Date().toISOString() });
      } catch (err) {
        console.error('qbo-webhook process error', e.id, err);
        // We always ack 200 to Intuit (it retries only at 20/30/50 min and then DISABLES the
        // endpoint), so recovery is ours to own. Distinguish "try again" from "never will
        // work" instead of flattening both to 'error' with no way to tell them apart.
        const retryable = err?.retryable === true;
        await db.update('qbo_events', `id=eq.${key}`, {
          status: retryable ? 'retry' : 'error',
          error: String(err?.message || err).slice(0, 500),
        });
      }
    }
  }

  return jsonResponse({ ok: true }, 200, request, env);
}
