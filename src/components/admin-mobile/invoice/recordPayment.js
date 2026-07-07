/**
 * ════════════════════════════════════════════════
 * FILE: recordPayment.js  (Admin Mobile — record-payment money path, finding F-1)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place the mobile invoice screen turns "the customer paid us" into a
 *   database row. It saves the payment, and if the invoice already lives in
 *   QuickBooks it mirrors the payment there too. If QuickBooks can't be reached,
 *   the payment still counts here — we just tell the user the mirror failed.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (the caller injects db / getAuthHeader / fetch)
 *   Data:      reads  → none
 *              writes → payments (insert ONLY the safe column set below);
 *                       QBO mirror via POST /api/qbo-payment (call-only worker)
 *
 * NOTES / GOTCHAS:
 *   - Finding F-1 (money): insert ONLY SAFE_PAYMENT_COLUMNS. NEVER write
 *     amount_paid / insurance_paid / homeowner_paid / status / paid_at — a DB
 *     trigger recomputes those on invoices from the payments table.
 *   - Replicates the desktop path (src/pages/InvoiceEditor.jsx recordPayment)
 *     without editing it. No record_payment RPC exists — this IS the path.
 *   - Double-submit guard lives HERE (an in-flight latch), not only in the UI:
 *     there is no insert-level idempotency key, so a second call while one is
 *     running must be refused, never inserted twice.
 *   - /api/qbo-payment is POSTed ONLY when the invoice has qbo_invoice_id (the
 *     human Save→QBO gate stays sacred — mobile never pushes the invoice).
 *     A failed QBO sync is NON-FATAL: the UPR row is already recorded and the
 *     worker stores qbo_sync_error on it; we surface the error, never roll back.
 * ════════════════════════════════════════════════
 */

/** The ONLY columns the mobile record-payment insert may write (finding F-1). */
export const SAFE_PAYMENT_COLUMNS = [
  'invoice_id', 'job_id', 'contact_id', 'amount', 'payment_date',
  'payer_type', 'payer_name', 'payment_method', 'reference_number', 'recorded_by',
];

/** Trigger-owned columns that must NEVER appear in the insert (finding F-1). */
export const TRIGGER_OWNED_COLUMNS = [
  'amount_paid', 'insurance_paid', 'homeowner_paid', 'status', 'paid_at',
];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Build the payments insert payload — exactly the safe column set, nothing else.
 * Mirrors the desktop insert (InvoiceEditor recordPayment) plus the optional
 * payer_name the mobile form collects.
 */
export function buildPaymentInsert({ invoice, job, employee, form }) {
  return {
    invoice_id: invoice.id,
    job_id: job?.id || null,
    contact_id: invoice.contact_id || null,
    amount: round2(Number(form.amount)),
    payment_date: form.date || todayISO(),
    payer_type: form.payer_type || 'insurance',
    payer_name: (form.payer_name || '').trim() || null,
    payment_method: form.method || null,
    reference_number: (form.reference || '').trim() || null,
    recorded_by: employee?.id || null,
  };
}

/**
 * Create the record-payment function. One recorder per screen: the closure
 * holds the in-flight latch that makes double-submits a no-op.
 *
 * record({ invoice, job, employee, form }) resolves to:
 *   { ok:false, reason:'in_flight' | 'invalid_amount' }      — nothing written
 *   { ok:false, reason:'insert_failed', error }               — nothing written
 *   { ok:true,  row, qboSynced:true }                         — saved + mirrored
 *   { ok:true,  row, qboSynced:false, qboSkipped:true }       — saved; no QBO invoice yet
 *   { ok:true,  row, qboSynced:false, qboError }              — saved; mirror failed (non-fatal)
 */
export function createPaymentRecorder({ db, getAuthHeader, fetchFn = (...a) => fetch(...a) }) {
  let inFlight = false;
  return async function record({ invoice, job, employee, form }) {
    if (inFlight) return { ok: false, reason: 'in_flight' };
    const amt = Number(form?.amount);
    if (!(amt > 0)) return { ok: false, reason: 'invalid_amount' };
    inFlight = true;
    try {
      let inserted;
      try {
        inserted = await db.insert('payments', buildPaymentInsert({ invoice, job, employee, form }));
      } catch (e) {
        return { ok: false, reason: 'insert_failed', error: e.message || String(e) };
      }
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      // Only mirror to QBO when the invoice is already synced (human gate upheld).
      if (!invoice.qbo_invoice_id || !row?.id) {
        return { ok: true, row, qboSynced: false, qboSkipped: true };
      }
      try {
        const auth = await getAuthHeader();
        const res = await fetchFn('/api/qbo-payment', {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_id: row.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return { ok: true, row, qboSynced: true };
      } catch (e) {
        // NON-FATAL: the UPR payments row already persists; never roll back.
        return { ok: true, row, qboSynced: false, qboError: e.message || String(e) };
      }
    } finally {
      inFlight = false;
    }
  };
}
