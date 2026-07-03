/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pulls a payment that happened in QuickBooks (e.g. a customer paid an invoice
 *   online by card or bank transfer) into UPR, so the matching UPR invoice shows
 *   the payment and an updated balance. It figures out which UPR invoice the QBO
 *   payment was applied to, and records it — but skips any payment that UPR itself
 *   created (so a payment is never counted twice).
 *
 * WHERE IT LIVES:
 *   Used by:  functions/api/qbo-webhook.js (real-time) and
 *             functions/api/qbo-payments-sync.js (hourly safety-net poll)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/quickbooks.js (qboFetch)
 *   Data:      reads  → invoices, payments (Supabase); QBO Payment + PaymentMethod (Intuit)
 *              writes → payments (insert). The update_invoice_paid trigger then
 *                       rolls the new payment up into invoices.amount_paid / status.
 *
 * NOTES / GOTCHAS:
 *   - DEDUP IS CRITICAL: when UPR pushes a payment to QBO, QBO emits a webhook for that
 *     same payment. We skip any QBO payment whose qbo_payment_id already exists on a UPR
 *     payment row, so only payments made *directly in QBO* (online pay-now) get imported.
 *   - We never write invoices.amount_paid directly — inserting into `payments` fires the
 *     existing DB trigger that recomputes the invoice.
 *   - A QBO Payment can apply to several invoices (Line[].LinkedTxn); we record the
 *     per-line applied amount against each matching UPR invoice.
 *   - payment_method is constrained in UPR; we map QBO's method name to credit_card / ach,
 *     else 'other'.
 * ════════════════════════════════════════════════
 */

import { qboFetch } from './quickbooks.js';
import { dispatchEvent } from '../api/notify.js';

const MINOR_VERSION = '70';

// ── payment.received notification hook (Notification Center, Session B) ──
// Additive + fire-and-forget: announces a newly-recorded payment to the admins
// via the shared dispatcher. Lives in this LIB (not a worker) so BOTH the QBO
// webhook and the hourly reconciliation cron cover the same event. INERT until
// the catalog type is enabled, and wrapped so a notify failure can NEVER throw
// into the payment-recording path (a lost notification must not lose a payment).
export async function notifyPaymentReceived({ db, env, amount, invoiceId, jobId, source, reference, dispatchImpl = dispatchEvent }) {
  try {
    const amt = Number(amount);
    const money = Number.isFinite(amt) ? `$${amt.toFixed(2)}` : 'A payment';
    await dispatchImpl({
      db, env,
      typeKey: 'payment.received',
      body: {
        title: 'Payment received',
        body: `${money} recorded${source ? ` via ${source}` : ''}${reference ? ` · ${reference}` : ''}.`,
        link: invoiceId ? `/invoices/${invoiceId}` : '/collections',
        entity_type: 'invoice',
        entity_id: invoiceId || null,
        job_id: jobId || null,
        payload: { amount: Number.isFinite(amt) ? amt : null, source: source || null, reference: reference || null },
        data: { route: invoiceId ? `/invoices/${invoiceId}` : '/collections' },
      },
    });
  } catch { /* fire-and-forget — a notify failure never breaks payment recording */ }
}

// ─── SECTION: Helpers ──────────────

// Map a QBO PaymentMethod name to UPR's allowed payment_method enum
// (check, ach, credit_card, wire, cash, insurance_direct, other).
function mapMethod(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('ach') || n.includes('bank') || n.includes('echeck') || n.includes('e-check')) return 'ach';
  if (n.includes('card') || n.includes('credit') || n.includes('visa') || n.includes('master') || n.includes('amex') || n.includes('discover')) return 'credit_card';
  return 'other';
}

async function fetchPaymentMethodName(env, refValue) {
  if (!refValue) return null;
  try {
    const res = await qboFetch(env, `/paymentmethod/${refValue}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({}));
    return d?.PaymentMethod?.Name || null;
  } catch {
    return null;
  }
}

// Estimate auto-conversion mirror (UPR side of QBO's deposit→invoice behavior).
// When a customer pays a deposit on an estimate via QBO's online pay link, QBO turns
// that estimate into a NEW invoice (Invoice.LinkedTxn → Estimate) and applies the
// payment to it. That QBO invoice has no UPR counterpart, so the payment can't attach.
// This traces the QBO invoice back to its estimate, finds the matching UPR estimate by
// qbo_estimate_id, runs the SAME convert the UPR button uses (convert_estimate_to_invoice),
// and ADOPTS the QBO invoice id onto the resulting UPR invoice — so the estimate shows
// converted in UPR and the payment lands on the right invoice. Returns the UPR invoice
// { id, job_id, contact_id } or null when it isn't an estimate conversion we can mirror.
async function adoptInvoiceFromQboEstimate(env, db, qboInvoiceId) {
  let qboInv;
  try {
    const r = await qboFetch(env, `/invoice/${qboInvoiceId}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
    if (!r.ok) return null;
    qboInv = (await r.json().catch(() => ({})))?.Invoice;
  } catch { return null; }
  if (!qboInv) return null;

  const estLink = (qboInv.LinkedTxn || []).find(l => l.TxnType === 'Estimate');
  if (!estLink) return null;                                  // not created from an estimate
  const qboEstimateId = String(estLink.TxnId);

  const est = (await db.select('estimates', `qbo_estimate_id=eq.${qboEstimateId}&select=id,job_id,converted_invoice_id&limit=1`))?.[0];
  if (!est) return null;                                      // estimate not tracked in UPR

  // Reuse an existing conversion if present; otherwise convert now (force — automatic).
  let invoiceId = est.converted_invoice_id;
  if (!invoiceId) {
    const conv = await db.rpc('convert_estimate_to_invoice', { p_estimate_id: est.id, p_force: true });
    invoiceId = conv?.invoice_id || (Array.isArray(conv) ? conv[0]?.invoice_id : null);
    if (!invoiceId) return null;
  }

  const inv = (await db.select('invoices', `id=eq.${invoiceId}&select=id,job_id,contact_id,qbo_invoice_id&limit=1`))?.[0];
  if (!inv) return null;
  // Adopt the QBO-born invoice id so the payment matches + future webhooks dedup. Never
  // clobber a qbo_invoice_id the UPR invoice already has (it was pushed separately).
  if (!inv.qbo_invoice_id) {
    await db.update('invoices', `id=eq.${invoiceId}`, {
      qbo_invoice_id: qboInvoiceId,
      qbo_synced_at:  new Date().toISOString(),
      qbo_doc_number: qboInv.DocNumber != null ? String(qboInv.DocNumber) : null,
      qbo_sync_error: null,
    });
  }
  return { id: inv.id, job_id: inv.job_id, contact_id: inv.contact_id };
}

// ─── SECTION: Exports ──────────────

// Mirror a single QBO Payment into UPR. Idempotent: re-running is a no-op once recorded.
// Returns { ok, results: [{ qboInvoiceId, recorded?|skipped }] }.
export async function syncQboPaymentToUpr(env, db, qboPaymentId) {
  const res = await qboFetch(env, `/payment/${qboPaymentId}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) {
    if (res.status === 404) return { ok: true, results: [{ skipped: 'payment-not-found' }] };
    throw new Error(`QBO get payment ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  const pmt = data?.Payment;
  if (!pmt) return { ok: true, results: [{ skipped: 'no-payment' }] };

  const methodName = await fetchPaymentMethodName(env, pmt.PaymentMethodRef?.value);
  const method = mapMethod(methodName);
  const txnDate = pmt.TxnDate || null;

  const lines = Array.isArray(pmt.Line) ? pmt.Line : [];
  const results = [];

  for (const line of lines) {
    const linked = (line.LinkedTxn || []).find(l => l.TxnType === 'Invoice');
    if (!linked) continue;
    const qboInvoiceId = String(linked.TxnId);
    const applied = Number(line.Amount || 0);
    if (!(applied > 0)) { results.push({ qboInvoiceId, skipped: 'zero-amount' }); continue; }

    let inv = (await db.select('invoices', `qbo_invoice_id=eq.${qboInvoiceId}&select=id,job_id,contact_id&limit=1`))?.[0];
    // No UPR invoice for this QBO invoice yet — it may be a QBO-side auto-conversion of an
    // estimate (customer paid a deposit on the estimate's online pay link). Mirror it.
    if (!inv) inv = await adoptInvoiceFromQboEstimate(env, db, qboInvoiceId);
    if (!inv) { results.push({ qboInvoiceId, skipped: 'no-upr-invoice' }); continue; }

    // Dedup: skip if a UPR payment already carries this qbo_payment_id for this invoice
    // (covers both UPR-originated payments and a re-delivered webhook).
    const existing = (await db.select('payments', `qbo_payment_id=eq.${qboPaymentId}&invoice_id=eq.${inv.id}&select=id&limit=1`))?.[0];
    if (existing) { results.push({ qboInvoiceId, skipped: 'already-synced' }); continue; }

    await db.insert('payments', {
      invoice_id:      inv.id,
      job_id:          inv.job_id,
      contact_id:      inv.contact_id,
      amount:          applied,
      payment_date:    txnDate,
      payment_method:  method,
      payer_type:      'homeowner',
      source:          'qbo',
      reference_number: `QBO Payment #${qboPaymentId}`,
      qbo_payment_id:  String(qboPaymentId),
      qbo_synced_at:   new Date().toISOString(),
    });
    // Notify admins of the newly-recorded payment. Fires only in this insert
    // branch, so a re-delivered webhook (which hits the 'already-synced' skip
    // above) never re-fires — idempotent by construction.
    await notifyPaymentReceived({
      db, env, amount: applied, invoiceId: inv.id, jobId: inv.job_id,
      source: 'QuickBooks', reference: `QBO Payment #${qboPaymentId}`,
    });
    results.push({ qboInvoiceId, invoice_id: inv.id, amount: applied, recorded: true });
  }

  return { ok: true, results };
}

// Remove UPR payments that were imported from a now-deleted/voided QBO payment. The
// invoice trigger reopens the invoice automatically. Only touches source='qbo' rows so
// it never deletes a UPR-originated payment.
export async function removeQboPaymentFromUpr(db, qboPaymentId) {
  const rows = (await db.select('payments', `qbo_payment_id=eq.${qboPaymentId}&source=eq.qbo&select=id`)) || [];
  for (const r of rows) await db.delete('payments', `id=eq.${r.id}`);
  return { ok: true, removed: rows.length };
}
