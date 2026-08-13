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
 *   - A VOIDED payment is not a deleted one — QBO keeps the row at TotalAmt 0 with no
 *     lines — so it is detected here (BOTH signals required) and removed, not rejected.
 * ════════════════════════════════════════════════
 */

import { getConnection, qboFetch } from './quickbooks.js';
import { dispatchEvent } from '../api/notify.js';
import { normalizeQboPaymentMethod } from './qbo-receipt.js';
import { mirrorQboInvoiceEmail } from './qbo-invoice-email-mirror.js';
import { isQboProviderTrafficDisabled } from './qbo-provider-traffic.js';

const MINOR_VERSION = '70';

// Who paid, for what job — the copy is unreadable without them (owner report
// 2026-07-31: two emails, same "QBO Payment #5887", no client, no job). Both
// lookups are best-effort: a miss degrades the copy, never the notification, and
// never the payment path. Shared by the received and voided emitters so a
// retraction names the same customer and job as the alert it retracts.
async function resolvePaymentParties(db, { contactId, jobId }) {
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
  return { customerName, jobNumber };
}

// Invoice Activity evidence (20260804210000_invoice_activity). The table, its
// service-only writer RPC and the reader the invoice page uses are already live;
// until now only qbo-invoice.js wrote to it, so the history showed sends and
// QuickBooks saves but never a payment — the single most useful thing to see on an
// invoice. event_type is free text (1–64 chars), so no migration is needed to add
// these; the labels live in src/components/invoice/InvoiceActivity.jsx.
//
// actor stays null: QuickBooks does not tell us which human recorded or voided the
// payment (MetaData.LastModifiedByRef names the OAuth connection, not the person),
// and the RPC re-checks any claimed actor against the roster anyway. A null actor
// records honestly as 'system' rather than inventing attribution.
//
// safe_metadata must be a JSON object and the table's CHECK constraint rejects the
// keys token/secret/password/authorization/body/message — keep new keys clear of them.
async function recordInvoiceActivity(db, { invoiceId, eventType, metadata = {} }) {
  if (!invoiceId) return;
  try {
    await db.rpc('record_invoice_activity', {
      p_invoice_id: invoiceId,
      p_actor_employee_id: null,
      p_event_type: eventType,
      p_recipient_email: null,
      p_cc_email: null,
      p_safe_metadata: metadata,
    });
  } catch { /* evidence is best-effort; never fail a completed money action */ }
}

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

    const { customerName, jobNumber } = await resolvePaymentParties(db, { contactId, jobId });

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

// ── payment.voided notification hook ──
// The retraction half of payment.received. A QBO payment that is voided or deleted
// minutes after it lands leaves the already-sent "Payment received" bell and push
// in place with nothing behind them: on 2026-08-07 QBO Payment #6059 ($2,797.82,
// A2Z Properties) was created and voided 26 seconds later, and the owner opened an
// invoice with no payment on it wondering what the alert meant. UPR had mirrored
// both actions correctly — the alert simply never retracted.
//
// Fires only when a projection was actually removed, so a re-delivered Void/Delete
// webhook (whose removal is already a no-op) cannot re-announce. Same fire-and-forget
// contract as payment.received: a notify failure never breaks the removal path.
export async function notifyPaymentVoided({
  db,
  env,
  amount,
  invoiceId,
  jobId,
  contactId,
  status,
  reference,
  invoiceNumber,
  paymentEventId,
  dispatchImpl = dispatchEvent,
}) {
  try {
    const amt = Number(amount);
    const money = Number.isFinite(amt) ? `$${amt.toFixed(2)}` : 'A payment';
    // QBO distinguishes a voided payment (kept at zero) from a deleted one; the
    // removal is identical in UPR but the word decides where the owner looks.
    const verb = status === 'deleted' ? 'deleted' : 'voided';

    const { customerName, jobNumber } = await resolvePaymentParties(db, { contactId, jobId });

    const parts = [
      `${money}${customerName ? ` from ${customerName}` : ''}`,
      jobNumber ? `Job #${jobNumber}` : null,
      invoiceNumber ? `Invoice ${invoiceNumber}` : null,
      `${verb} in QuickBooks`,
    ].filter(Boolean);
    const bodyText = `${parts.join(' · ')}${reference ? ` (${reference})` : ''}.`;

    await dispatchImpl({
      db, env,
      typeKey: 'payment.voided',
      body: {
        notification_event_id: paymentEventId || null,
        title: `Payment ${verb}`,
        body: bodyText,
        link: invoiceId ? `/invoices/${invoiceId}` : '/collections',
        entity_type: 'invoice',
        entity_id: invoiceId || null,
        job_id: jobId || null,
        payload: {
          amount: Number.isFinite(amt) ? amt : null,
          status: verb,
          reference: reference || null,
        },
        presentation_context: {
          invoice_number: invoiceNumber || null,
          // renderTemplate refuses to render when a referenced variable is blank
          // (→ null → generic fallback), so these always carry a non-empty string.
          customer_name: customerName || 'Customer',
          job_number: jobNumber || '—',
          payment_status: verb,
        },
        data: { route: invoiceId ? `/invoices/${invoiceId}` : '/collections' },
      },
    });
  } catch { /* fire-and-forget — a notify failure never breaks payment removal */ }
}

// ─── SECTION: Helpers ──────────────

async function fetchPaymentMethodName(env, refValue, expectedRealmId) {
  if (!refValue) return null;
  try {
    const res = await qboFetch(env, `/paymentmethod/${refValue}?minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({}));
    return d?.PaymentMethod?.Name || null;
  } catch (error) {
    if (isQboProviderTrafficDisabled(error) || error?.code === 'qbo-realm-mismatch' || error?.code === 'qbo-connection-changed') throw error;
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

// QuickBooks VOIDS a payment by keeping the row and zeroing it — TotalAmt 0, Line[]
// emptied, PrivateNote 'Voided' — so detection requires BOTH signals. A zero total
// ALONE is never enough: misreading a live payment as voided would delete real money
// rows, so the second condition is what makes this safe rather than merely quiet.
//
// Verified, not assumed: Number(null), Number('') and Number([]) all coerce to 0, so
// exactCents() returns a legitimate-looking 0 for a MISSING total. A malformed total
// must keep failing loudly into the receipt guards, never route to removal — hence the
// raw value has to BE numeric before the zero test, rather than merely coerce to zero.
function isExactZeroAmount(value) {
  const numericInput = typeof value === 'number'
    || (typeof value === 'string' && value.trim() !== '');
  return numericInput && exactCents(value) === 0;
}

function hasInvoiceLinkedLine(lines) {
  return lines.some((line) => (Array.isArray(line?.LinkedTxn) ? line.LinkedTxn : [])
    .some((txn) => txn?.TxnType === 'Invoice'));
}

export function isVoidedQboPayment(payment, lines) {
  return isExactZeroAmount(payment?.TotalAmt) && !hasInvoiceLinkedLine(lines);
}

// ── Realm scoping for the legacy payments cleanup (20260808070000) ──
// QBO Payment ids are small per-company sequential integers, so `qbo_payment_id`
// alone does not identify a payment across QuickBooks companies. `payments` now
// carries `qbo_realm_id` to disambiguate. Rows written before that migration have
// NULL there, but NULL is *not* evidence that they belong to today's connection.
// Terminal events are destructive, so a NULL-realm row stays preserved for explicit
// reconciliation rather than being guessed into the current company and deleted.
//
// An unparseable realm scopes nothing. Intuit realm ids are numeric strings; any
// other shape cannot be safely interpolated into a PostgREST `or=(...)` group (a
// comma or paren would reshape the filter into something that matches rows we
// never meant to touch), and the caller must fail closed rather than emit a
// predicate it cannot reason about.
export function qboRealmScopeFilter(realmId) {
  const realm = String(realmId ?? '').trim();
  // Production Intuit realm ids are numeric, but test and sandbox connections
  // may use a safe opaque identifier. The narrow character set is safe inside
  // PostgREST's `or=(...)` grammar; punctuation is deliberately refused.
  if (!/^[A-Za-z0-9_-]+$/.test(realm)) return '';
  return `&qbo_realm_id=eq.${encodeURIComponent(realm)}`;
}

function paymentRealmBoundaryError(message, code = 'qbo-realm-unavailable') {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

// The legacy projection has no receipt header to protect it, so its company
// boundary must be established before *any* local import/removal work. A NULL
// realm turns qboRealmScopeFilter into an empty string, which is an unscoped
// cross-company predicate — never degrade to that for money data.
async function requireCurrentPaymentRealm(env, expectedRealmId = null) {
  let connection;
  try {
    connection = await getConnection(env);
  } catch {
    throw paymentRealmBoundaryError('QuickBooks payment sync cannot resolve the connected realm');
  }
  const realmId = String(connection?.realm_id || '').trim();
  if (!qboRealmScopeFilter(realmId)) {
    throw paymentRealmBoundaryError('QuickBooks payment sync requires a valid connected realm');
  }
  if (expectedRealmId != null && realmId !== String(expectedRealmId).trim()) {
    throw paymentRealmBoundaryError(
      'QuickBooks connection realm changed during payment sync',
      'qbo-realm-mismatch',
    );
  }
  return realmId;
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
export async function adoptInvoiceFromQboEstimate(env, db, qboInvoiceId, pForce = false, reportBlocked = false, { expectedRealmId } = {}) {
  const blocked = reason => (reportBlocked ? { blocked: reason } : null);
  let qboInv;
  try {
    const r = await qboFetch(env, `/invoice/${qboInvoiceId}?minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
    if (!r.ok) return null;
    qboInv = (await r.json().catch(() => ({})))?.Invoice;
  } catch (error) {
    if (isQboProviderTrafficDisabled(error) || error?.code === 'qbo-realm-mismatch' || error?.code === 'qbo-connection-changed') throw error;
    return null;
  }
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
  // qboInv was already fetched in full above to find its estimate link, so
  // mirroring QuickBooks' email state off it costs no extra provider call. An
  // invoice QuickBooks created and emailed itself is exactly the case UPR was
  // blind to. Observation columns only — never qbo_emailed_at. Self-guarding:
  // a no-op until migration 20260807190000 is applied.
  await mirrorQboInvoiceEmail(db, [invoiceId], qboInv);
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
  expectedRealmId = null,
} = {}) {
  const currentRealmId = await requireCurrentPaymentRealm(env, expectedRealmId);
  const res = await qboFetch(env, `/payment/${qboPaymentId}?minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId: currentRealmId });
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

  const lines = Array.isArray(pmt.Line) ? pmt.Line : [];

  // ── Voided in QuickBooks ──────────
  // A VOID is not a DELETE: the entity still exists, so the CDC sweep re-reads it as an
  // ordinary update and never reaches its `status === 'deleted'` removal branch. Before
  // this check it fell through to the receipt guards below, where `!exactCents(0)` is
  // true and tripped the fractional-cent rejection — so the hourly poller reported
  // 'error' on EVERY run until the payment aged out of the 7-day CDC window (live:
  // payment 6059, 2026-08-07). A permanently red poller is the expensive failure: a
  // genuine break becomes indistinguishable from the standing noise.
  //
  // The webhook already routes operation 'Void' here; doing it in the shared sync gives
  // the CDC sweep, the retry drain and a replayed 'Update' that same terminal outcome.
  // Removal is idempotent — the RPC's event_key replay guard and the source='qbo'
  // delete both no-op once the projections are gone — so re-running costs nothing and
  // cannot re-announce a retraction (the pre-removal snapshot comes back empty).
  if (isVoidedQboPayment(pmt, lines)) {
    await removeQboPaymentFromUpr(db, qboPaymentId, {
      receiptEnabled,
      status: 'voided',
      // Content-derived, never Date.now() (workers-standard §3): the provider version
      // is stable for a voided payment, so the hourly re-read replays instead of
      // writing a fresh event every sweep.
      eventKey: `void:${currentRealmId}:${qboPaymentId}:${pmt.MetaData?.LastUpdatedTime || pmt.SyncToken || 'current'}`,
      realmId: currentRealmId,
      env,
    });
    return { ok: true, results: [{ qboPaymentId, skipped: 'voided' }] };
  }

  const methodName = await fetchPaymentMethodName(env, pmt.PaymentMethodRef?.value, currentRealmId);
  const method = normalizeQboPaymentMethod(methodName);
  const txnDate = pmt.TxnDate || null;
  const reference = pmt.PaymentRefNum || `QBO Payment #${qboPaymentId}`;

  const results = [];

  // New receipt-aware reconciliation is deliberately flag gated: the migration
  // can land first, while the deployed legacy importer remains the safe fallback.
  if (receiptEnabled) {
    const realmId = currentRealmId;
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
      if (!inv) inv = await adoptInvoiceFromQboEstimate(env, db, qboInvoiceId, false, true, { expectedRealmId: currentRealmId });
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
      // Activity is history, not an announcement: it records every payment that is
      // new to UPR, including one UPR originated itself. priorProjection is the
      // "new to us" signal, so a re-reconcile (customer merge, allocation edit)
      // reuses the existing row instead of logging the payment a second time.
      if (!priorProjection) {
        await recordInvoiceActivity(db, {
          invoiceId: allocation.invoice_id,
          eventType: 'payment_recorded',
          metadata: {
            amount: allocation.amount_cents / 100,
            payment_method: methodName || method || null,
            source: source === 'upr' ? 'UPR' : 'QuickBooks',
            reference: reference || `QBO Payment #${qboPaymentId}`,
            qbo_payment_id: String(qboPaymentId),
          },
        });
      }
      if (!existingReceipt && !trustedAttempt && !priorProjection && source === 'qbo') {
        await notifyPaymentReceived({
          db,
          env,
          amount: allocation.amount_cents / 100,
          invoiceId: allocation.invoice_id,
          jobId: allocation.job_id,
          contactId: allocation.contact_id || null,
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

  // The connected realm was validated before the provider read. Legacy rows are
  // always stamped with it; missing/failed connection resolution is retryable and
  // performs no import rather than writing an ambiguous NULL-realm projection.
  const legacyRealmId = currentRealmId;

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
    if (!inv) inv = await adoptInvoiceFromQboEstimate(env, db, qboInvoiceId, false, true, { expectedRealmId: currentRealmId });
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
        qbo_realm_id:    legacyRealmId,
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
    // Both of these fire only in this insert branch, so a re-delivered webhook
    // (which hits the 'already-synced' skip above) never repeats either — the
    // invoice history and the alert are idempotent by construction.
    await recordInvoiceActivity(db, {
      invoiceId: inv.id,
      eventType: 'payment_recorded',
      metadata: {
        amount: applied,
        payment_method: method || null,
        source: 'QuickBooks',
        reference: reference || `QBO Payment #${qboPaymentId}`,
        qbo_payment_id: String(qboPaymentId),
      },
    });
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
  env = null,
} = {}) {
  // Never let a direct caller turn this into an unscoped removal. Webhook and
  // scheduler callers pass the realm they already validated, but we re-check it
  // immediately before deletion so a reconnect cannot leave that earlier value
  // stale. A missing/unsafe environment or realm is a retryable boundary, not
  // permission to delete broadly.
  if (!env) {
    throw paymentRealmBoundaryError('QuickBooks payment removal requires a valid connected realm');
  }
  realmId = await requireCurrentPaymentRealm(env, realmId);
  // Snapshot BEFORE anything is removed. Both removal paths delete the very rows
  // that carry the invoice, job, contact and amount a retraction has to name —
  // reading afterwards finds nothing left to describe. Best-effort: a failed
  // snapshot costs the notification, never the removal.
  //
  // Realm-scoped on the same exact-current-realm terms as the removal below: the
  // snapshot decides which invoices get a 'payment_removed' history row and who
  // gets a payment.voided retraction, so an unscoped read could announce the
  // retraction of another company's payment against one of our invoices —
  // describing a removal that never happened.
  let snapshot = [];
  try {
    snapshot = (await db.select(
      'payments',
      `qbo_payment_id=eq.${encodeURIComponent(String(qboPaymentId))}`
      + qboRealmScopeFilter(realmId)
      + '&select=id,invoice_id,job_id,contact_id,amount,source,reference_number',
    )) || [];
  } catch { snapshot = []; }

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
  // REALM-SCOPED since 20260808070000, and this runs in BOTH modes — outside the
  // receiptEnabled block above — which is why it needed its own scoping rather than
  // inheriting the receipt RPC's. Before the column existed this matched on
  // qbo_payment_id alone, so a stale source='qbo' row from a prior connection
  // (sandbox↔production cutover, company reconnect) whose per-company id numerically
  // collided with a live one was deleted silently.
  //
  // Worse than a stray legacy row: this predicate does not filter on receipt_id, so it
  // reaches receipt PROJECTIONS too (9 of the 88 matching rows in production on
  // 2026-08-07). For a foreign realm the RPC above finds no header and removes nothing,
  // and this query would then delete that realm's projections anyway — leaving a
  // payment_receipts header still marked 'reconciled' with its money rows gone. Scoping
  // here is what closes that, and it only works because both receipt RPCs now stamp
  // qbo_realm_id on the projections they write.
  //
  // Only an exact current-realm match is removable. Historical NULL-realm rows are
  // preserved for reconciliation because their company cannot be established safely.
  const rows = (await db.select(
    'payments',
    `qbo_payment_id=eq.${qboPaymentId}&source=eq.qbo${qboRealmScopeFilter(realmId)}&select=id`,
  )) || [];
  for (const r of rows) await db.delete('payments', `id=eq.${r.id}`);

  // Retract only what was announced, and only when something was actually removed —
  // a re-delivered Void/Delete webhook removes nothing and so cannot re-announce.
  // payment.received fires for money UPR learned about FROM QuickBooks (source
  // 'qbo'); a payment UPR itself recorded was never announced, so voiding it must
  // not send a retraction for an alert nobody received.
  if (removedReceipt || rows.length) {
    // History records every removal, including a payment UPR originated — an
    // invoice that briefly showed as paid should say so and say it stopped.
    try {
      for (const row of snapshot) {
        await recordInvoiceActivity(db, {
          invoiceId: row.invoice_id,
          eventType: 'payment_removed',
          metadata: {
            amount: row.amount ?? null,
            status: status === 'deleted' ? 'deleted' : 'voided',
            source: row.source === 'upr' ? 'UPR' : 'QuickBooks',
            reference: row.reference_number || `QBO Payment #${qboPaymentId}`,
            qbo_payment_id: String(qboPaymentId),
          },
        });
      }
    } catch { /* evidence is best-effort; never fail a completed money action */ }

    try {
      for (const row of snapshot.filter((r) => r?.source === 'qbo')) {
        let invoiceNumber = null;
        if (row.invoice_id) {
          try {
            const inv = (await db.select(
              'invoices', `id=eq.${row.invoice_id}&select=invoice_number,qbo_doc_number`,
            ))?.[0];
            invoiceNumber = inv?.qbo_doc_number || inv?.invoice_number || null;
          } catch { invoiceNumber = null; }
        }
        await notifyPaymentVoided({
          db,
          env,
          amount: row.amount,
          invoiceId: row.invoice_id || null,
          jobId: row.job_id || null,
          contactId: row.contact_id || null,
          status,
          reference: row.reference_number || `QBO Payment #${qboPaymentId}`,
          invoiceNumber,
          paymentEventId: `qbo-void:${qboPaymentId}:${row.invoice_id || row.id}`,
        });
      }
    } catch { /* fire-and-forget — a notify failure never breaks payment removal */ }
  }

  return removedReceipt
    ? { ok: true, removed: 'receipt', legacyRemoved: rows.length }
    : { ok: true, removed: rows.length };
}
