/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pulls a payment that happened in QuickBooks (e.g. a customer paid an invoice
 *   online by card or bank transfer) into UPR, so the matching UPR invoice shows
 *   the payment and an updated balance. It matches every linked UPR invoice and
 *   keeps one durable receipt with the invoice-level rows used by existing totals.
 *
 * WHERE IT LIVES:
 *   Used by:  functions/api/qbo-webhook.js (real-time) and
 *             functions/api/qbo-payments-sync.js (hourly safety-net poll)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/quickbooks.js, functions/lib/qbo-receipt.js
 *   Data:      reads  → invoices, payments, payment_receipts,
 *                       payment_receipt_attempts; QBO Payment + PaymentMethod
 *              writes → receipt service RPCs and payment.received notifications
 *
 * NOTES / GOTCHAS:
 *   - DEDUP IS CRITICAL: a UPR-created receipt is recognized by its private request
 *     marker and durable attempt, so its webhook cannot create a second payment.
 *   - We never write invoices.amount_paid directly — inserting into `payments` fires the
 *     existing DB trigger that recomputes the invoice.
 *   - A QBO Payment can apply to several invoices (Line[].LinkedTxn); we record the
 *     per-line applied amount against each matching UPR invoice.
 *   - Receipt mode intentionally supports fully-applied USD invoice payments only.
 *     Unapplied credit and non-invoice links fail closed for operational review.
 * ════════════════════════════════════════════════
 */

import { getConnection, qboFetch } from './quickbooks.js';
import { dispatchEvent } from '../api/notify.js';
import { normalizeQboPaymentMethod } from './qbo-receipt.js';

const MINOR_VERSION = '70';

// ── payment.received notification hook (Notification Center, Session B) ──
// Additive + fire-and-forget: announces a newly-recorded payment to the admins
// via the shared dispatcher. Lives in this LIB (not a worker) so BOTH the QBO
// webhook and the hourly reconciliation cron cover the same event. INERT until
// the catalog type is enabled, and wrapped so a notify failure can NEVER throw
// into the payment-recording path (a lost notification must not lose a payment).
export async function notifyPaymentReceived({
  db,
  env,
  amount,
  invoiceId,
  jobId,
  contactId,
  source,
  reference,
  invoiceNumber,
  paymentEventId,
  dispatchImpl = dispatchEvent,
}) {
  try {
    const amt = Number(amount);
    const money = Number.isFinite(amt) ? `$${amt.toFixed(2)}` : 'A payment';

    // Who paid, for what job — the copy was unreadable without them (owner
    // report 2026-07-31: two emails, same "QBO Payment #5887", no client, no
    // job). Both lookups are best-effort: a miss degrades the copy, never the
    // notification, and never the payment path.
    let customerName = null;
    let jobNumber = null;
    if (contactId) {
      try {
        customerName = (await db.select(
          'contacts', `id=eq.${contactId}&select=name`,
        ))?.[0]?.name || null;
      } catch { customerName = null; }
    }
    if (jobId) {
      try {
        jobNumber = (await db.select(
          'jobs', `id=eq.${jobId}&select=job_number`,
        ))?.[0]?.job_number || null;
      } catch { jobNumber = null; }
    }

    const parts = [
      `${money}${customerName ? ` from ${customerName}` : ''}`,
      jobNumber ? `Job #${jobNumber}` : null,
      invoiceNumber ? `Invoice ${invoiceNumber}` : null,
      source ? `via ${source}` : null,
    ].filter(Boolean);
    const bodyText = `${parts.join(' · ')}${reference ? ` (${reference})` : ''}.`;

    await dispatchImpl({
      db, env,
      typeKey: 'payment.received',
      body: {
        notification_event_id: paymentEventId || null,
        title: 'Payment received',
        body: bodyText,
        link: invoiceId ? `/invoices/${invoiceId}` : '/collections',
        entity_type: 'invoice',
        entity_id: invoiceId || null,
        job_id: jobId || null,
        payload: { amount: Number.isFinite(amt) ? amt : null, source: source || null, reference: reference || null },
        presentation_context: {
          invoice_number: invoiceNumber || null,
          // The template renderer refuses to render when any referenced
          // variable is blank (renderTemplate → null → generic fallback), so
          // these always carry a non-empty string.
          customer_name: customerName || 'Customer',
          job_number: jobNumber || '—',
        },
        data: { route: invoiceId ? `/invoices/${invoiceId}` : '/collections' },
      },
    });
  } catch { /* fire-and-forget — a notify failure never breaks payment recording */ }
}

// ─── SECTION: Helpers ──────────────

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

function exactCents(value) {
  const amount = Number(value);
  const amountCents = Math.round(amount * 100);
  return Number.isFinite(amount) && Math.abs(amount * 100 - amountCents) < 1e-7
    ? amountCents
    : null;
}

function receiptSyncError(message, retryable = false) {
  const error = new Error(message);
  error.name = 'QboReceiptSyncError';
  error.retryable = retryable;
  return error;
}

function uprReceiptRequestId(payment) {
  const match = /^UPR receipt ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
    .exec(String(payment?.PrivateNote || '').trim());
  return match?.[1]?.toLowerCase() || null;
}

function matchesAttemptRequest(attempt, allocations, payment) {
  const payload = attempt?.request_payload;
  const requested = payload?.allocations;
  if (!Array.isArray(requested) || requested.length !== allocations.length) return false;
  const actual = new Map(allocations.map((row) => [String(row.invoice_id), row.amount_cents]));
  return requested.every((row) => actual.get(String(row.invoice_id)) === Number(row.amount_cents))
    && String(payload.payment_date || '') === String(payment.TxnDate || '')
    && String(payload.qbo_payment_method_id || '') === String(payment.PaymentMethodRef?.value || '')
    && String(payload.deposit_account_id || '') === String(payment.DepositToAccountRef?.value || '')
    && String(payload.reference_number || '') === String(payment.PaymentRefNum || '');
}

// Estimate auto-conversion mirror (UPR side of QBO's deposit→invoice behavior).
// When a customer pays a deposit on an estimate via QBO's online pay link, QBO turns
// that estimate into a NEW invoice (Invoice.LinkedTxn → Estimate) and applies the
// payment to it. That QBO invoice has no UPR counterpart, so the payment can't attach.
// This traces the QBO invoice back to its estimate, finds the matching UPR estimate by
// qbo_estimate_id, uses the atomic QBO decision RPC to convert it, and ADOPTS the
// QBO invoice id onto the resulting UPR invoice — so the estimate shows
// converted in UPR and the payment lands on the right invoice. Returns the UPR invoice
// { id, job_id, contact_id } or null when it isn't an estimate conversion we can mirror.
// Both callers keep pForce=false: a populated UPR invoice is a manual-reconciliation
// boundary even when QBO has already accepted a deposit. `reportBlocked` lets the payment
// importer distinguish that boundary from an unrelated missing invoice without changing the
// estimate status-sync caller's established null contract.
export async function adoptInvoiceFromQboEstimate(env, db, qboInvoiceId, pForce = false, reportBlocked = false) {
  const blocked = reason => (reportBlocked ? { blocked: reason } : null);
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

  const estimates = (await db.select('estimates', `qbo_estimate_id=eq.${qboEstimateId}&select=id,job_id,converted_invoice_id&limit=2`)) || [];
  // A QBO estimate can be represented by multiple UPR records for combined billing. There is
  // no owner-approved automatic allocation rule, so never choose whichever row arrived first.
  if (estimates.length > 1) return blocked('combined-estimate-manual-reconciliation');
  const est = estimates[0];
  if (!est) return null;                                      // estimate not tracked in UPR

  // Reuse an existing conversion if present; otherwise ask the atomic decision
  // gate to convert. This never forces a populated invoice: that remains a
  // human-reconciliation boundary for both callers.
  let invoiceId = est.converted_invoice_id;
  if (!invoiceId) {
    if (pForce) return blocked('force-not-supported');
    const rawConv = await db.rpc('apply_qbo_estimate_decision', {
      p_estimate_id: est.id,
      p_action: 'convert',
      p_approved_at: null,
      p_approved_amount: null,
    });
    const conv = Array.isArray(rawConv) ? rawConv[0] : rawConv;
    // These names are intentionally the durable reconciliation vocabulary used
    // by qbo-reconciliation.js.  The webhook and hourly importer persist only
    // recognized reasons, so do not leak an internal RPC outcome such as
    // "needs-confirm" or "already-decided" here.
    if (conv?.action === 'approved-needs-manual-convert') return blocked('needs-manual-reconciliation');
    if (conv?.skipped === 'already-decided' || conv?.skipped === 'already-denied') return blocked('staff-decision-conflict');
    invoiceId = conv?.invoice_id || null;
    if (!invoiceId) return null;
  }

  const inv = (await db.select(
    'invoices',
    `id=eq.${invoiceId}&select=id,job_id,contact_id,qbo_invoice_id,invoice_number,qbo_doc_number&limit=1`,
  ))?.[0];
  if (!inv) return null;
  // An already-linked but different QBO invoice is never adoptable: recording the incoming
  // payment here would put an unrelated QBO payment on this UPR invoice.
  if (inv.qbo_invoice_id && String(inv.qbo_invoice_id) !== String(qboInvoiceId)) {
    return blocked('qbo-invoice-mismatch');
  }
  // Atomically adopt (or verify) the QBO-born invoice id. A concurrent human
  // save/adoption must not win with a last-write-wins PATCH after this read.
  const rawCas = await db.rpc('cas_qbo_invoice_link', {
    p_invoice_id: invoiceId,
    p_expected_qbo_invoice_id: inv.qbo_invoice_id == null ? null : String(inv.qbo_invoice_id),
    p_new_qbo_invoice_id: String(qboInvoiceId),
    p_qbo_doc_number: qboInv.DocNumber != null ? String(qboInv.DocNumber) : null,
  });
  const cas = Array.isArray(rawCas) ? rawCas[0] : rawCas;
  if (!cas?.ok) return blocked(cas?.reason || 'qbo-invoice-mismatch');
  // Keep status/sync timestamps outside the link CAS. They do not determine
  // which external invoice is attached and are safe to update after CAS wins.
  await db.update('invoices', `id=eq.${invoiceId}`, {
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_error: null,
  });
  return cas;
}

// ─── SECTION: Helpers ──────────────

// Intuit reports entity-read failures as HTTP 400 with a Fault body, NOT 404 — including
// "object not found", which per Intuit's own troubleshooting guide also fires when a txn was
// "deleted by one user and accessed by another". Reading only res.status therefore loses the
// one field that says which it was, which is why a real production failure could only be
// recorded as the uninformative "QBO get payment 400". Parse the Fault so the cause is
// recoverable from the stored error.
//
// Shape: { Fault: { type, Error: [{ code, Message, Detail }] } }
export async function readQboFault(res) {
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  const first = body?.Fault?.Error?.[0] || null;
  return {
    status: res.status,
    faultType: body?.Fault?.type || null,
    code: first?.code ? String(first.code) : null,
    message: first?.Message || null,
    detail: first?.Detail || null,
  };
}

// 610 "Object Not Found" is a benign terminal outcome, not a failure to retry: the payment
// either never existed in this company or was deleted before we read it. 6240 is the
// duplicate-name variant of the same "gone/unusable" family.
const QBO_NOT_FOUND_CODES = new Set(['610', '6240']);

export function isQboNotFound(fault) {
  return fault?.status === 400 && QBO_NOT_FOUND_CODES.has(String(fault?.code));
}

// A QBO read failure carrying the parsed Fault, so callers can classify without re-parsing.
export class QboRequestError extends Error {
  constructor(operation, fault) {
    const parts = [`QBO ${operation} ${fault.status}`];
    if (fault.code) parts.push(`code=${fault.code}`);
    if (fault.message) parts.push(fault.message);
    if (fault.detail && fault.detail !== fault.message) parts.push(`(${fault.detail})`);
    super(parts.join(' '));
    this.name = 'QboRequestError';
    this.status = fault.status;
    this.faultCode = fault.code;
    this.faultDetail = fault.detail;
    // 429 and 5xx are worth another attempt; a 400-family Fault is a permanent refusal.
    this.retryable = fault.status === 429 || fault.status >= 500;
  }
}

// ─── SECTION: Exports ──────────────

// Mirror a single QBO Payment into UPR. Idempotent: re-running is a no-op once recorded.
// Returns { ok, results: [{ qboInvoiceId, recorded?|skipped }] }.
export async function syncQboPaymentToUpr(env, db, qboPaymentId, {
  receiptEnabled = env.QBO_RECEIVE_PAYMENT_ENABLED === 'true',
} = {}) {
  const res = await qboFetch(env, `/payment/${qboPaymentId}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) {
    // 404 is kept for defensiveness but Intuit does not use it for entity reads.
    if (res.status === 404) return { ok: true, results: [{ skipped: 'payment-not-found' }] };
    const fault = await readQboFault(res);
    if (isQboNotFound(fault)) return { ok: true, results: [{ skipped: 'payment-not-found' }] };
    throw new QboRequestError('get payment', fault);
  }
  const data = await res.json().catch(() => ({}));
  const pmt = data?.Payment;
  if (!pmt) return { ok: true, results: [{ skipped: 'no-payment' }] };

  const methodName = await fetchPaymentMethodName(env, pmt.PaymentMethodRef?.value);
  const method = normalizeQboPaymentMethod(methodName);
  const txnDate = pmt.TxnDate || null;
  const reference = pmt.PaymentRefNum || `QBO Payment #${qboPaymentId}`;

  const lines = Array.isArray(pmt.Line) ? pmt.Line : [];
  const results = [];

  // New receipt-aware reconciliation is deliberately flag gated: the migration
  // can land first, while the deployed legacy importer remains the safe fallback.
  if (receiptEnabled) {
    const realmId = String((await getConnection(env))?.realm_id || '');
    if (!realmId) throw new Error('QBO receipt reconciliation requires a connected realm');
    const existingReceipt = (await db.select(
      'payment_receipts',
      `qbo_realm_id=eq.${encodeURIComponent(realmId)}&qbo_payment_id=eq.${encodeURIComponent(qboPaymentId)}&select=id,source&limit=1`,
    ))?.[0] || null;
    const providerVersion = pmt.MetaData?.LastUpdatedTime || pmt.SyncToken || 'current';
    const removeExistingReceiptAsConflict = async () => {
      if (existingReceipt) {
        try {
          await db.rpc('remove_qbo_payment_receipt', {
            p_qbo_realm_id: realmId,
            p_qbo_payment_id: String(qboPaymentId),
            p_status: 'conflict',
            p_event_key: `conflict:${realmId}:${qboPaymentId}:${providerVersion}`,
          });
        } catch (error) {
          error.retryable = true;
          throw error;
        }
      }
    };
    const rejectCurrentReceipt = async (message, retryable = false) => {
      await removeExistingReceiptAsConflict();
      throw receiptSyncError(message, retryable);
    };
    const deferCurrentReceiptForReconciliation = async (qboInvoiceId, reason) => {
      // A combined mapping or blocked estimate conversion needs a human decision.
      // Remove any prior projection first, then return the same structured result
      // as legacy mode so the webhook/CDC reconciliation ledger can own recovery.
      await removeExistingReceiptAsConflict();
      return { ok: true, results: [{ qboInvoiceId, skipped: reason }] };
    };
    const totalCents = exactCents(pmt.TotalAmt);
    const unappliedCents = exactCents(pmt.UnappliedAmt || 0);
    if (!totalCents || unappliedCents == null) {
      await rejectCurrentReceipt('QBO receipt contains an invalid or fractional-cent total');
    }
    if ((pmt.CurrencyRef?.value || 'USD') !== 'USD') {
      await rejectCurrentReceipt('QBO receipt reconciliation supports USD payments only');
    }
    if (!pmt.CustomerRef?.value || !txnDate) {
      await rejectCurrentReceipt('QBO receipt is missing its customer or transaction date');
    }
    const allocations = [];
    for (const line of lines) {
      const lineCents = exactCents(line.Amount);
      if (!lineCents) continue;
      const linked = (line.LinkedTxn || []).filter((txn) => txn.TxnType === 'Invoice');
      if (linked.length !== 1) {
        await rejectCurrentReceipt('QBO receipt has a positive line that is not linked to exactly one invoice');
      }
      const qboInvoiceId = String(linked[0].TxnId);
      const matchingInvoices = (await db.select(
        'invoices',
        `qbo_invoice_id=eq.${qboInvoiceId}&select=id,job_id,contact_id,invoice_number,qbo_doc_number&limit=2`,
      )) || [];
      // Combined billing intentionally permits one QBO invoice id on multiple UPR
      // invoices. Never guess which internal invoice owns this allocation.
      if (matchingInvoices.length > 1) {
        return deferCurrentReceiptForReconciliation(
          qboInvoiceId,
          'combined-invoice-manual-reconciliation',
        );
      }
      let inv = matchingInvoices[0];
      if (!inv) inv = await adoptInvoiceFromQboEstimate(env, db, qboInvoiceId, false, true);
      if (inv?.blocked) {
        return deferCurrentReceiptForReconciliation(qboInvoiceId, inv.blocked);
      }
      if (!inv) await rejectCurrentReceipt(`QBO invoice ${qboInvoiceId} has no UPR invoice mapping`, true);
      allocations.push({
        invoice_id: inv.id,
        qbo_invoice_id: qboInvoiceId,
        amount_cents: lineCents,
        payer_type: 'homeowner',
        contact_id: inv.contact_id,
        job_id: inv.job_id,
        invoice_number: inv.qbo_doc_number || inv.invoice_number || null,
      });
    }
    const appliedCents = allocations.reduce((sum, row) => sum + row.amount_cents, 0);
    if (!allocations.length || unappliedCents !== 0 || appliedCents !== totalCents) {
      await rejectCurrentReceipt('QBO receipt is not fully applied to supported UPR invoice lines');
    }
    const clientRequestId = uprReceiptRequestId(pmt);
    let matchedAttempt = null;
    if (clientRequestId) {
      const attempt = (await db.select(
        'payment_receipt_attempts',
        `qbo_realm_id=eq.${encodeURIComponent(realmId)}&client_request_id=eq.${encodeURIComponent(clientRequestId)}&select=id,actor_employee_id,request_payload,qbo_payment_id&limit=1`,
      ))?.[0] || null;
      if (attempt
          && (!attempt.qbo_payment_id || String(attempt.qbo_payment_id) === String(qboPaymentId))
          && String(attempt.request_payload?.contact_id || '') === String(allocations[0]?.contact_id || '')
          && matchesAttemptRequest(attempt, allocations, pmt)) {
        matchedAttempt = attempt;
      }
    }
    // Once a receipt is linked to a UPR attempt, that durable relationship is
    // stronger than the editable QBO PrivateNote. Preserve the human payer and
    // actor even if someone later changes the note or allocations in QBO.
    let linkedAttempt = null;
    if (!matchedAttempt && existingReceipt?.source === 'upr') {
      linkedAttempt = (await db.select(
        'payment_receipt_attempts',
        `receipt_id=eq.${encodeURIComponent(existingReceipt.id)}&select=id,actor_employee_id,request_payload,qbo_payment_id&order=created_at.asc&limit=1`,
      ))?.[0] || null;
      if (linkedAttempt?.qbo_payment_id
          && String(linkedAttempt.qbo_payment_id) !== String(qboPaymentId)) {
        linkedAttempt = null;
      }
    }
    const trustedAttempt = matchedAttempt || linkedAttempt;
    const source = existingReceipt?.source === 'upr' || trustedAttempt ? 'upr' : 'qbo';
    const payerType = trustedAttempt?.request_payload?.payer_type || 'homeowner';
    // "Payment received" means money UPR did not know about. A payments row for
    // this QBO id — manual, backfilled, or legacy-synced — means the team already
    // knows; upgrading it into the receipt projection (or re-reconciling after a
    // customer merge / allocation edit) must never re-announce. Read BEFORE the
    // reconcile RPC: it deletes and re-inserts projections, so afterwards a row
    // always exists. (The 2026-08-06 04:17 first working sweep announced 14
    // already-recorded payments to every admin because only existingReceipt was
    // checked, and no receipts could exist before the role-check repair.)
    const priorProjection = (await db.select(
      'payments',
      `qbo_payment_id=eq.${encodeURIComponent(String(qboPaymentId))}&select=id&limit=1`,
    ))?.[0] || null;
    const reconcileResult = await db.rpc('reconcile_qbo_payment_receipt', {
      p_receipt: {
        qbo_realm_id: realmId, qbo_payment_id: String(qboPaymentId), qbo_customer_id: pmt.CustomerRef?.value ? String(pmt.CustomerRef.value) : null,
        txn_date: txnDate, payment_method: method, qbo_payment_method_id: pmt.PaymentMethodRef?.value ? String(pmt.PaymentMethodRef.value) : null,
        qbo_payment_method_name: methodName, reference_number: reference,
        deposit_account_id: pmt.DepositToAccountRef?.value ? String(pmt.DepositToAccountRef.value) : null,
        deposit_account_name: pmt.DepositToAccountRef?.name || null,
        total_cents: totalCents, applied_cents: appliedCents, unapplied_cents: unappliedCents,
        source, actor_employee_id: trustedAttempt?.actor_employee_id || null, attempt_id: trustedAttempt?.id || null,
        qbo_sync_token: pmt.SyncToken || null, qbo_updated_at: pmt.MetaData?.LastUpdatedTime || null, normalized_snapshot: pmt,
      },
      p_allocations: allocations.map((row) => ({
        invoice_id: row.invoice_id,
        qbo_invoice_id: row.qbo_invoice_id,
        amount_cents: row.amount_cents,
        payer_type: payerType,
      })),
      p_event_type: 'reconciled',
      p_event_key: `payment:${realmId}:${qboPaymentId}:${pmt.MetaData?.LastUpdatedTime || pmt.SyncToken || 'current'}`,
    });
    const normalizedResult = Array.isArray(reconcileResult) ? reconcileResult[0] : reconcileResult;
    if (normalizedResult?.ignored_terminal) {
      return { ok: true, results: [{ qboPaymentId, skipped: 'terminal-receipt' }] };
    }
    if (normalizedResult?.ignored_stale) {
      return { ok: true, results: [{ qboPaymentId, skipped: 'stale-receipt' }] };
    }
    for (const allocation of allocations) {
      if (!existingReceipt && !trustedAttempt && !priorProjection && source === 'qbo') {
        await notifyPaymentReceived({
          db,
          env,
          amount: allocation.amount_cents / 100,
          invoiceId: allocation.invoice_id,
          jobId: allocation.job_id,
          source: 'QuickBooks',
          reference,
          invoiceNumber: allocation.invoice_number,
          paymentEventId: `qbo:${realmId}:${qboPaymentId}:${allocation.invoice_id}`,
        });
      }
      results.push({
        qboInvoiceId: allocation.qbo_invoice_id,
        invoice_id: allocation.invoice_id,
        amount: allocation.amount_cents / 100,
        ...(existingReceipt ? { reconciled: true } : { recorded: true }),
      });
    }
    return { ok: true, results };
  }

  for (const line of lines) {
    const linked = (line.LinkedTxn || []).find(l => l.TxnType === 'Invoice');
    if (!linked) continue;
    const qboInvoiceId = String(linked.TxnId);
    const applied = Number(line.Amount || 0);
    if (!(applied > 0)) { results.push({ qboInvoiceId, skipped: 'zero-amount' }); continue; }

    const matchingInvoices = (await db.select(
      'invoices',
      `qbo_invoice_id=eq.${qboInvoiceId}&select=id,job_id,contact_id,invoice_number,qbo_doc_number&limit=2`,
    )) || [];
    // qbo_invoice_id is intentionally non-unique for combined billing. A payment line cannot
    // be safely allocated across those UPR invoices without an explicit reconciliation rule.
    if (matchingInvoices.length > 1) {
      results.push({ qboInvoiceId, skipped: 'combined-invoice-manual-reconciliation' });
      continue;
    }
    let inv = matchingInvoices[0];
    // No UPR invoice for this QBO invoice yet — it may be a QBO-side auto-conversion of an
    // estimate (customer paid a deposit on the estimate's online pay link). Mirror it.
    if (!inv) inv = await adoptInvoiceFromQboEstimate(env, db, qboInvoiceId, false, true);
    if (!inv?.id) {
      results.push({ qboInvoiceId, skipped: inv?.blocked || 'no-upr-invoice' });
      continue;
    }

    // Dedup: skip if a UPR payment already carries this qbo_payment_id for this invoice
    // (covers both UPR-originated payments and a re-delivered webhook).
    const existing = (await db.select('payments', `qbo_payment_id=eq.${qboPaymentId}&invoice_id=eq.${inv.id}&select=id&limit=1`))?.[0];
    if (existing) { results.push({ qboInvoiceId, skipped: 'already-synced' }); continue; }

    try {
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
    } catch (error) {
      // The webhook and hourly sweep may race after both pass the first read.
      // The live partial unique index is the money guard; re-read after any
      // failed insert and treat an observed winner as the same idempotent no-op.
      // If no winner exists, preserve the real database failure.
      const raced = (await db.select(
        'payments',
        `qbo_payment_id=eq.${qboPaymentId}&invoice_id=eq.${inv.id}&select=id&limit=1`,
      ))?.[0];
      if (raced) {
        results.push({ qboInvoiceId, skipped: 'already-synced' });
        continue;
      }
      throw error;
    }
    // Notify admins of the newly-recorded payment. Fires only in this insert
    // branch, so a re-delivered webhook (which hits the 'already-synced' skip
    // above) never re-fires — idempotent by construction.
    await notifyPaymentReceived({
      db, env, amount: applied, invoiceId: inv.id, jobId: inv.job_id,
      contactId: inv.contact_id || null,
      source: 'QuickBooks', reference,
      invoiceNumber: inv.qbo_doc_number || inv.invoice_number || null,
      paymentEventId: `qbo:${qboPaymentId}:${inv.id}`,
    });
    results.push({ qboInvoiceId, invoice_id: inv.id, amount: applied, recorded: true });
  }

  return { ok: true, results };
}

// A terminal QBO event removes every active projection for a durable receipt while
// retaining its header/events as audit evidence. The legacy fallback remains limited
// to source='qbo' rows because it has no receipt-level audit record.
export async function removeQboPaymentFromUpr(db, qboPaymentId, {
  receiptEnabled = false,
  status = 'voided',
  eventKey = null,
  realmId = null,
} = {}) {
  // The receipt RPC removes all active allocation projections together and retains
  // the accounting audit record. The idempotent legacy cleanup always follows:
  // if a prior attempt wrote the tombstone but failed while deleting a pre-receipt
  // projection, an RPC replay must still finish that cleanup.
  let removedReceipt = false;
  if (receiptEnabled && db?.rpc) {
    if (!realmId) throw new Error('QBO receipt removal requires a realm id');
    const removeResult = await db.rpc('remove_qbo_payment_receipt', {
      p_qbo_realm_id: String(realmId),
      p_qbo_payment_id: String(qboPaymentId),
      p_status: status,
      p_event_key: eventKey || `remove:${realmId}:${qboPaymentId}`,
    });
    const normalizedResult = Array.isArray(removeResult) ? removeResult[0] : removeResult;
    removedReceipt = !normalizedResult?.missing;
  }
  const rows = (await db.select('payments', `qbo_payment_id=eq.${qboPaymentId}&source=eq.qbo&select=id`)) || [];
  for (const r of rows) await db.delete('payments', `id=eq.${r.id}`);
  return removedReceipt
    ? { ok: true, removed: 'receipt', legacyRemoved: rows.length }
    : { ok: true, removed: rows.length };
}
