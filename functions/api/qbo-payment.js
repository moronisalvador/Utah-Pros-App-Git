/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Mirrors one older UPR invoice payment into QuickBooks or removes that one
 *   matching payment. Grouped receipts and provider-recorded rows are refused
 *   here because changing one row could alter several invoices.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, qbo-auth, supabase, quickbooks
 *   Data:      reads  → payments, invoices, contacts, integration_credentials
 *              writes → payments, worker_runs, QuickBooks Payment
 *
 * NOTES / GOTCHAS:
 *   - This is the legacy single-invoice route; new grouped receipts use
 *     /api/qbo-receive-payment.
 *   - Authentication is an approved server capability or active internal admin.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboRequest } from '../lib/qbo-auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, createPayment, deletePayment } from '../lib/quickbooks.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QBO_PAYMENT_ID_LENGTH = 255;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function strictEncodeURIComponent(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodedEq(value) {
  return `eq.${strictEncodeURIComponent(value)}`;
}

function qboPaymentId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  const hasControlCharacter = [...id].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (!id || id.length > MAX_QBO_PAYMENT_ID_LENGTH || hasControlCharacter) return null;
  return id;
}

function userError(message, httpStatus = 400) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.safeToExpose = true;
  return error;
}

function publicPaymentError(error) {
  return error?.safeToExpose === true
    ? String(error.message)
    : 'Unable to update the payment in QuickBooks. Use the reference ID when asking an administrator to investigate.';
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

  const db = supabase(env, fetchWithTimeout);
  const auth = await authorizeQboRequest(request, env, db, fetchWithTimeout);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  if (body.payment_id && !isUuid(body.payment_id)) {
    return jsonResponse({ error: 'payment_id must be a UUID' }, 400, request, env);
  }

  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);

  // ── Delete path ── (works even if the UPR payment row is already gone, via qbo_payment_id)
  if (body.action === 'delete') {
    const pay = body.payment_id
      ? (await db.select('payments', `id=${encodedEq(body.payment_id)}&limit=1`))?.[0]
      : null;
    const rawQboId = pay?.qbo_payment_id || body.qbo_payment_id;
    if (rawQboId != null && !qboPaymentId(rawQboId)) {
      return jsonResponse({ error: 'qbo_payment_id is invalid' }, 400, request, env);
    }
    const qboId = qboPaymentId(rawQboId);
    if (!qboId) return jsonResponse({ skipped: true, reason: 'no qbo_payment_id' }, 200, request, env);
    // A receipt groups several UPR allocation rows under one QBO Payment. Deleting
    // one allocation would delete the whole QBO Payment, so corrections must be
    // done in QBO and reconciled as a group.
    const linkedRows = await db.select(
      'payments',
      `qbo_payment_id=${encodedEq(qboId)}&limit=3`,
    );
    // The flag row is created with the receipt migration. Its presence is a
    // schema marker, separate from whether receipt creation is enabled. Once
    // present, a receipt-header read must succeed before the legacy route can
    // delete a QBO payment; otherwise a removed projection could erase a
    // durable grouped receipt. Before the migration, no marker preserves the
    // deploy-first legacy path.
    let receiptHeader = null;
    try {
      const receiptMarker = (await db.select(
        'feature_flags',
        'key=eq.feature%3Aqbo_receive_payment&select=key&limit=1',
      ))?.[0];
      if (receiptMarker?.key === 'feature:qbo_receive_payment') {
        receiptHeader = (await db.select(
          'payment_receipts',
          `qbo_realm_id=not.is.null&qbo_payment_id=${encodedEq(qboId)}&select=id&limit=1`,
        ))?.[0];
      }
    } catch {
      return jsonResponse({ error: 'Unable to verify receipt safety; do not delete this payment.' }, 503, request, env);
    }
    if (receiptHeader || pay?.receipt_id || linkedRows.some((row) => row.receipt_id) || linkedRows.length > 1) {
      return jsonResponse({ error: 'This payment is part of a grouped receipt. Correct it in QuickBooks and reconcile the receipt.' }, 409, request, env);
    }
    if (pay?.source === 'qbo' || pay?.source === 'stripe' || linkedRows.some((row) => ['qbo', 'stripe'].includes(row.source))) {
      return jsonResponse({ error: 'Provider-recorded payments must be corrected in QuickBooks.' }, 409, request, env);
    }
    try {
      await deletePayment(env, qboId);
      // Clear the realm with the id: a realm without a payment id labels nothing.
      if (pay) await db.update('payments', `id=${encodedEq(pay.id)}`, { qbo_payment_id: null, qbo_realm_id: null, qbo_synced_at: null, qbo_sync_error: null });
      return jsonResponse({ deleted: qboId }, 200, request, env);
    } catch (e) {
      return jsonResponse({
        error: publicPaymentError(e),
        intuit_tid: e.intuitTid || null,
      }, 502, request, env);
    }
  }

  // ── Create path ──
  const paymentId = body.payment_id;
  if (!paymentId) return jsonResponse({ error: 'Provide payment_id' }, 400, request, env);

  const pay = (await db.select('payments', `id=${encodedEq(paymentId)}&limit=1`))?.[0];
  if (!pay) return jsonResponse({ error: 'Payment not found' }, 404, request, env);

  if (pay.qbo_payment_id) {
    return jsonResponse({ skipped: true, reason: 'already synced', qbo_payment_id: pay.qbo_payment_id }, 200, request, env);
  }

  try {
    if (!pay.invoice_id) throw userError('Payment is not linked to an invoice — cannot apply it in QuickBooks');

    const inv = (await db.select('invoices', `id=${encodedEq(pay.invoice_id)}&select=qbo_invoice_id,contact_id,invoice_number&limit=1`))?.[0];
    if (!inv) throw userError('Invoice not found for payment');
    if (!inv.qbo_invoice_id) throw userError('Invoice is not in QuickBooks yet — sync the invoice first');

    const contactId = pay.contact_id || inv.contact_id;
    const contact = contactId
      ? (await db.select('contacts', `id=${encodedEq(contactId)}&select=qbo_customer_id&limit=1`))?.[0]
      : null;
    if (!contact?.qbo_customer_id) throw userError('Customer has no QuickBooks record — sync the client first');

    const amount = Number(pay.amount);
    if (!(amount > 0)) throw userError('Payment amount must be greater than 0');

    const note = `UPR payment · ${inv.invoice_number || ''}${pay.reference_number ? ' · ref ' + pay.reference_number : ''}`;
    const qboPay = await createPayment(env, {
      customerId: contact.qbo_customer_id,
      qboInvoiceId: inv.qbo_invoice_id,
      amount,
      txnDate: pay.payment_date || null,
      privateNote: note,
      requestId: `uprp-${String(paymentId).toLowerCase()}`,
    });

    await db.update('payments', `id=${encodedEq(paymentId)}`, {
      // qbo_realm_id travels with qbo_payment_id (20260807210000) — the id is a
      // per-company counter and means nothing without the company it counts in.
      qbo_payment_id: String(qboPay.Id), qbo_realm_id: conn.realm_id ? String(conn.realm_id) : null,
      qbo_synced_at: new Date().toISOString(), qbo_sync_error: null,
    });
    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, qbo_payment_id: qboPay.Id }, 200, request, env);
  } catch (e) {
    await db.update('payments', `id=${encodedEq(paymentId)}`, { qbo_sync_error: (e.message || 'push failed').slice(0, 500) });
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({
      error: publicPaymentError(e),
      intuit_tid: e.intuitTid || null,
    }, e.httpStatus || 502, request, env);
  }
}
