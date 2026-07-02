// POST /api/qbo-payment — push a UPR payment to QuickBooks Online (one-way).
//
// UPR is the system of record: a payment is recorded in UPR first, then this mirrors
// it into QBO as a Payment applied to the invoice (so the QBO invoice shows paid/partial).
//
// Auth: x-webhook-secret (server-side) or a Supabase Bearer (admin).
// Body:
//   { "payment_id": "<uuid>" }                        — create the QBO payment
//   { "payment_id": "<uuid>", "action": "delete" }    — delete it from QBO
//   { "qbo_payment_id": "<id>", "action": "delete" }  — delete by QBO id (row already gone)

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireEmployee } from '../lib/auth.js';
import { getConnection, createPayment, deletePayment } from '../lib/quickbooks.js';

async function isAuthorized(request, env) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) return true;
  const auth = await requireEmployee(request, env);
  return auth.ok;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: 'qbo-payment', status, records_processed: processed,
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

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  // ── Delete path ── (works even if the UPR payment row is already gone, via qbo_payment_id)
  if (body.action === 'delete') {
    const pay = body.payment_id
      ? (await db.select('payments', `id=eq.${body.payment_id}&limit=1`))?.[0]
      : null;
    const qboId = pay?.qbo_payment_id || body.qbo_payment_id;
    if (!qboId) return jsonResponse({ skipped: true, reason: 'no qbo_payment_id' }, 200, request, env);
    try {
      await deletePayment(env, qboId);
      if (pay) await db.update('payments', `id=eq.${pay.id}`, { qbo_payment_id: null, qbo_synced_at: null, qbo_sync_error: null });
      return jsonResponse({ deleted: qboId }, 200, request, env);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500, request, env);
    }
  }

  // ── Create path ──
  const paymentId = body.payment_id;
  if (!paymentId) return jsonResponse({ error: 'Provide payment_id' }, 400, request, env);

  const pay = (await db.select('payments', `id=eq.${paymentId}&limit=1`))?.[0];
  if (!pay) return jsonResponse({ error: 'Payment not found' }, 404, request, env);

  if (pay.qbo_payment_id) {
    return jsonResponse({ skipped: true, reason: 'already synced', qbo_payment_id: pay.qbo_payment_id }, 200, request, env);
  }

  try {
    if (!pay.invoice_id) throw new Error('Payment is not linked to an invoice — cannot apply it in QuickBooks');

    const inv = (await db.select('invoices', `id=eq.${pay.invoice_id}&select=qbo_invoice_id,contact_id,invoice_number&limit=1`))?.[0];
    if (!inv) throw new Error('Invoice not found for payment');
    if (!inv.qbo_invoice_id) throw new Error('Invoice is not in QuickBooks yet — sync the invoice first');

    const contactId = pay.contact_id || inv.contact_id;
    const contact = contactId
      ? (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id&limit=1`))?.[0]
      : null;
    if (!contact?.qbo_customer_id) throw new Error('Customer has no QuickBooks record — sync the client first');

    const amount = Number(pay.amount);
    if (!(amount > 0)) throw new Error('Payment amount must be greater than 0');

    const note = `UPR payment · ${inv.invoice_number || ''}${pay.reference_number ? ' · ref ' + pay.reference_number : ''}`;
    const qboPay = await createPayment(env, {
      customerId: contact.qbo_customer_id,
      qboInvoiceId: inv.qbo_invoice_id,
      amount,
      txnDate: pay.payment_date || null,
      privateNote: note,
    });

    await db.update('payments', `id=eq.${paymentId}`, {
      qbo_payment_id: String(qboPay.Id), qbo_synced_at: new Date().toISOString(), qbo_sync_error: null,
    });
    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, qbo_payment_id: qboPay.Id }, 200, request, env);
  } catch (e) {
    await db.update('payments', `id=eq.${paymentId}`, { qbo_sync_error: (e.message || 'push failed').slice(0, 500) });
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message, intuit_tid: e.intuitTid || null }, 500, request, env);
  }
}
