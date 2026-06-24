/**
 * ════════════════════════════════════════════════
 * FILE: qbo-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Listens for messages from QuickBooks that say "a payment happened." When a
 *   customer pays a QuickBooks invoice online (card / bank), QuickBooks notifies
 *   this endpoint, and we record that payment in UPR so the invoice's balance is
 *   up to date — automatically, with no manual entry.
 *
 * WHERE IT LIVES:
 *   Route:   POST /api/qbo-webhook   (set this URL in the Intuit Developer dashboard → Webhooks)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  lib/supabase.js, lib/cors.js, lib/intuit.js, lib/qbo-payment-sync.js
 *   Data:      reads/writes via claim_qbo_event RPC + qbo_events; records into `payments`
 *              (through qbo-payment-sync), which the update_invoice_paid trigger rolls up.
 *
 * NOTES / GOTCHAS:
 *   - Requires QBO_WEBHOOK_VERIFIER_TOKEN (Intuit Developer → Webhooks → Verifier Token).
 *     Distinct from QBO_WEBHOOK_SECRET (internal DB-trigger auth). If unset, we ack 200
 *     and ignore — inert until configured, so deploying this is safe.
 *   - We only handle Payment entities for now. Each event is claimed once (idempotent)
 *     so duplicate Intuit deliveries no-op.
 *   - Always returns 200 quickly after claiming so Intuit doesn't hammer retries;
 *     per-event failures are recorded on qbo_events.error for later inspection.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { verifyIntuitSignature, sha256hex } from '../lib/intuit.js';
import { syncQboPaymentToUpr, removeQboPaymentFromUpr } from '../lib/qbo-payment-sync.js';

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

  for (const note of notifications) {
    const realmId = note.realmId || '';
    const entities = note.dataChangeEvent?.entities || [];
    for (const e of entities) {
      if (e.name !== 'Payment') continue;  // only payments for now

      const key = await sha256hex(`${realmId}:${e.name}:${e.id}:${e.operation}:${e.lastUpdated || ''}`);
      let claimed = false;
      try {
        claimed = await db.rpc('claim_qbo_event', { p_id: key, p_entity: e.name, p_operation: e.operation });
      } catch (err) {
        console.error('claim_qbo_event failed', err);
        continue; // can't claim → skip rather than risk double-processing
      }
      if (!claimed) continue; // duplicate delivery

      try {
        const op = String(e.operation || '');
        if (op === 'Delete' || op === 'Void' || op === 'Merge') {
          await removeQboPaymentFromUpr(db, String(e.id));
        } else {
          await syncQboPaymentToUpr(env, db, String(e.id));
        }
        await db.update('qbo_events', `id=eq.${key}`, { status: 'processed', processed_at: new Date().toISOString() });
      } catch (err) {
        console.error('qbo-webhook process error', e.id, err);
        await db.update('qbo_events', `id=eq.${key}`, { status: 'error', error: String(err?.message || err).slice(0, 500) });
      }
    }
  }

  return jsonResponse({ ok: true }, 200, request, env);
}
