// POST /api/qbo-charge — key a card on an invoice and charge it via QuickBooks Payments.
//
// Auth: x-webhook-secret (server-side) or a Supabase Bearer (admin).
// Body: { invoice_id: "<uuid>", token: "<intuit-card-token>", amount: <number> }
//
// `token` is the opaque value-token minted CLIENT-SIDE by Intuit's tokenizer — the raw card
// number never reaches this worker (PCI: card data goes browser → Intuit, not through us).
//
// Flow (reconciles in both QBO and UPR without double-counting against the qbo-webhook):
//   1. createCharge() — charge the tokenized card (money movement).
//   2. insert a UPR `payments` row (source='qbo', method='credit_card') — no qbo_payment_id yet.
//   3. createPayment() — a QBO Payment applied to the invoice (LinkedTxn→Invoice), then stamp
//      its id onto the UPR row so the inbound webhook dedups it (it checks qbo_payment_id).
//   The update_invoice_paid trigger rolls the payment into the invoice/job balance.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireEmployee } from '../lib/auth.js';
import { getConnection, createCharge, createPayment } from '../lib/quickbooks.js';

async function isAuthorized(request, env) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) return true;
  const auth = await requireEmployee(request, env);
  return auth.ok;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: 'qbo-charge', status, records_processed: processed,
      error_message: errorMessage || null, started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const db = supabase(env);
  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);
  // The Payments API needs the payment scope; if we know the granted scopes and it's missing,
  // tell the user to reconnect rather than letting the charge fail with a cryptic 401.
  if (conn.granted_scopes && !conn.granted_scopes.includes('com.intuit.quickbooks.payment')) {
    return jsonResponse({ error: 'QuickBooks Payments isn’t authorized yet — reconnect QuickBooks (it will ask for payment permission) to enable card charging.' }, 409, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const { invoice_id: invoiceId, token } = body;
  const amount = Number(body.amount);
  if (!invoiceId) return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);
  if (!token) return jsonResponse({ error: 'Provide a card token' }, 400, request, env);
  if (!(amount > 0)) return jsonResponse({ error: 'Provide a positive amount' }, 400, request, env);

  try {
    const inv = (await db.select('invoices', `id=eq.${invoiceId}&limit=1`))?.[0];
    if (!inv) throw new Error('Invoice not found');
    if (!inv.qbo_invoice_id) throw new Error('Save the invoice to QuickBooks before charging a card.');
    // Server-side ceiling: never charge more than the invoice's outstanding balance.
    // The client-supplied amount is not trusted (prevents over-charge / tampering).
    const balanceCents = Math.round((Number(inv.adjusted_total ?? inv.total ?? 0) - Number(inv.amount_paid || 0)) * 100);
    if (Math.round(amount * 100) > balanceCents) {
      throw new Error(`Amount $${amount.toFixed(2)} exceeds the invoice balance of $${(balanceCents / 100).toFixed(2)}.`);
    }
    const contact = inv.contact_id
      ? (await db.select('contacts', `id=eq.${inv.contact_id}&select=qbo_customer_id&limit=1`))?.[0]
      : null;
    if (!contact?.qbo_customer_id) throw new Error('Invoice contact has no QuickBooks customer — sync the client first.');

    // 1. Charge the tokenized card.
    const charge = await createCharge(env, { amount, token });
    if (charge.status && !/captured|succeeded/i.test(String(charge.status))) {
      throw new Error(`Card not charged (status: ${charge.status})`);
    }

    // 2. Record the UPR payment (no qbo_payment_id yet).
    const today = new Date().toISOString().slice(0, 10);
    const inserted = await db.insert('payments', {
      invoice_id: inv.id, job_id: inv.job_id || null, contact_id: inv.contact_id || null,
      amount, payment_date: today,
      payment_method: 'credit_card', payer_type: 'homeowner', source: 'qbo',
      reference_number: `Card charge #${charge.id}`,
    });
    const payRow = Array.isArray(inserted) ? inserted[0] : inserted;

    // 3. Mirror to a QBO Payment applied to the invoice; stamp the id so the webhook dedups.
    let qboPaymentId = null, syncError = null;
    try {
      const depositAccountId = (await db.select('integration_config', 'key=eq.qbo_bank_account_id&select=value'))?.[0]?.value || null;
      const qboPay = await createPayment(env, {
        customerId: contact.qbo_customer_id, qboInvoiceId: inv.qbo_invoice_id,
        amount, txnDate: today, privateNote: `Keyed card · Charge #${charge.id}`,
        depositAccountId,
      });
      qboPaymentId = String(qboPay.Id);
      await db.update('payments', `id=eq.${payRow.id}`, { qbo_payment_id: qboPaymentId, qbo_synced_at: new Date().toISOString() });
    } catch (e) {
      // Charge succeeded but the QBO Payment didn't record — keep the UPR payment, flag the sync.
      syncError = (e.message || 'QBO payment sync failed').slice(0, 500);
      await db.update('payments', `id=eq.${payRow.id}`, { qbo_sync_error: syncError });
    }

    await logRun(db, 'completed', 1, syncError, startedAt);
    return jsonResponse({ ok: true, charge_id: charge.id, payment_id: payRow.id, qbo_payment_id: qboPaymentId, qbo_sync_error: syncError }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message, declined: !!e.declined, intuit_tid: e.intuitTid || null }, e.declined ? 402 : 500, request, env);
  }
}
