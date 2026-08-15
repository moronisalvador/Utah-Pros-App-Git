/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Mirrors one older UPR invoice payment into QuickBooks. The old delete
 *   request is deliberately unavailable until it can use a durable command
 *   boundary that keeps a correction from changing more than intended.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, qbo-auth, supabase, quickbooks
 *   Data:      reads  → payments, invoices, contacts, integration_credentials
 *              writes → payments, worker_runs, QuickBooks Payment
 *
 * NOTES / GOTCHAS:
 *   - This is the legacy single-invoice create route; new grouped receipts use
 *     /api/qbo-receive-payment. Its old delete action is source-disabled for
 *     P4c until a durable correction boundary replaces it.
 *   - Authentication is an approved server capability or an active internal
 *     billing editor (admin, office, or project manager).
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { authorizeQboRequest } from '../lib/qbo-auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { getConnection, createPayment } from '../lib/quickbooks.js';
import { requireQboProviderTraffic, isQboProviderTrafficDisabled } from '../lib/qbo-provider-traffic.js';
import { qboProviderTrafficDisabledRouteResponse } from './qbo-provider-traffic-response.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTUIT_TID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
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

function paymentConnectionBoundaryCode(error) {
  return ['qbo-realm-mismatch', 'qbo-connection-changed'].includes(error?.code)
    ? error.code
    : null;
}

function safeIntuitTid(error) {
  const tid = typeof error?.intuitTid === 'string' ? error.intuitTid.trim() : '';
  return INTUIT_TID_PATTERN.test(tid) ? tid : null;
}

// Provider Fault text can contain customer and accounting details. Persist a stable
// support correlation marker instead; the Intuit trace remains available to admins.
function persistedPaymentFailure(error) {
  const tid = safeIntuitTid(error);
  return tid ? `qbo_payment_push_failed:intuit_tid=${tid}` : 'qbo_payment_push_failed';
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

  // The legacy route could delete a provider payment before it had a durable,
  // replay-safe correction record. Refuse it before configuration, connection,
  // business-row, or provider work; validation remains useful to clients.
  if (body.action === 'delete') {
    if (body.qbo_payment_id != null && !qboPaymentId(body.qbo_payment_id)) {
      return jsonResponse({ error: 'qbo_payment_id is invalid' }, 400, request, env);
    }
    return jsonResponse({
      code: 'qbo_payment_delete_durable_boundary_required',
      reason: 'qbo_payment_delete_durable_boundary_required',
      error: 'Payment deletion is temporarily unavailable while its durable correction boundary is deployed.',
    }, 503, request, env);
  }

  try { await requireQboProviderTraffic(env); } catch (error) { if (isQboProviderTrafficDisabled(error)) return qboProviderTrafficDisabledRouteResponse(request, env); throw error; }

  const conn = await getConnection(env);
  if (!conn || !conn.refresh_token) return jsonResponse({ error: 'QuickBooks not connected' }, 409, request, env);

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
      // Capture the connection once and pin the provider write to that company.
      expectedRealmId: String(conn.realm_id),
    });

    await db.update('payments', `id=${encodedEq(paymentId)}`, {
      // qbo_realm_id travels with qbo_payment_id (20260808070000) — the id is a
      // per-company counter and means nothing without the company it counts in.
      qbo_payment_id: String(qboPay.Id), qbo_realm_id: conn.realm_id ? String(conn.realm_id) : null,
      qbo_synced_at: new Date().toISOString(), qbo_sync_error: null,
    });
    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, qbo_payment_id: qboPay.Id }, 200, request, env);
  } catch (e) {
    // The provider helper rechecks the global stop immediately before its
    // fetch. A close race at that boundary means QBO did not receive this
    // payment request, so do not stamp a misleading sync failure locally.
    if (isQboProviderTrafficDisabled(e)) {
      await logRun(db, 'error', 0, e.message, startedAt);
      return qboProviderTrafficDisabledRouteResponse(request, env);
    }
    const connectionCode = paymentConnectionBoundaryCode(e);
    if (connectionCode) {
      await logRun(db, 'error', 0, connectionCode, startedAt);
      return jsonResponse({
        error: 'QuickBooks connection changed before the payment was sent. Reload the invoice and review its customer and payment details before starting a new submission.',
        code: connectionCode,
        reason: connectionCode,
        retry_same_request: false,
      }, 409, request, env);
    }
    const failure = persistedPaymentFailure(e);
    await db.update('payments', `id=${encodedEq(paymentId)}`, { qbo_sync_error: failure });
    await logRun(db, 'error', 0, failure, startedAt);
    return jsonResponse({
      error: publicPaymentError(e),
      intuit_tid: safeIntuitTid(e),
    }, e.httpStatus || 502, request, env);
  }
}
