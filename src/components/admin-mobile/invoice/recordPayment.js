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
 *   Data:      reads  → payments (retry probe only — never on the happy path)
 *              writes → payments (insert ONLY the safe column set below);
 *                       QBO mirror via POST /api/qbo-payment (call-only worker)
 *
 * NOTES / GOTCHAS:
 *   - Finding F-1 (money): insert ONLY SAFE_PAYMENT_COLUMNS. NEVER write
 *     amount_paid / insurance_paid / homeowner_paid / status / paid_at — the
 *     trg_payment_update_invoice trigger (update_invoice_paid) recomputes those
 *     on invoices, plus jobs.collected_value, from the payments table.
 *   - Replicates the desktop path (src/pages/InvoiceEditor.jsx recordPayment)
 *     without editing it. No record_payment RPC exists — this IS the path.
 *   - IDEMPOTENCY (AGENTS.md §15). Two layers, because a phone on one bar in a
 *     driveway is the actual threat model:
 *       1. the in-flight latch — a second tap while the first save is running;
 *       2. a STABLE CONTENT-DERIVED KEY (paymentIdempotencyKey) — never
 *          Date.now(). The same payment retried hashes the same; a genuinely
 *          different payment hashes differently. An attempt whose outcome we
 *          never learned (the request left the phone, the answer never came
 *          back) is remembered against that key, and the NEXT attempt PROBES
 *          the server for a matching row before inserting. Land-one-row holds
 *          across a dropped response, not only across a fast double-tap.
 *     There is no unique index behind this — `payments` has no key column — so
 *     this is a client-boundary guarantee, per-screen (the closure dies on
 *     unmount). A database-level constraint would need a migration and is the
 *     durable fix; see the handoff.
 *   - The probe is deliberately fail-CLOSED: if it cannot run we refuse with
 *     'probe_failed' rather than insert, because the alternative to an
 *     unanswered question is a double-posted payment.
 *   - /api/qbo-payment is POSTed ONLY when the invoice has qbo_invoice_id (the
 *     human Save→QBO gate stays sacred — mobile never pushes the invoice).
 *     It is itself idempotent (it skips when the row already has a
 *     qbo_payment_id), so re-running the mirror for an adopted row is safe.
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

/** Columns precise enough to identify a payment on the server, and safe to put
 *  in a PostgREST filter unquoted: a uuid, a number, a date and two fixed
 *  vocabularies. The free-text fields (payer_name, reference_number) are matched
 *  in JS instead — same precision, no filter-encoding hazard. */
const PROBE_COLUMNS = ['invoice_id', 'amount', 'payment_date', 'payer_type', 'payment_method'];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Amount as an integer number of cents, so "250", "250.0" and "250.00" are one
 *  payment and not three. Rounded, never truncated (0.1+0.2 float noise). */
export const amountCents = (n) => Math.round(Number(n || 0) * 100);

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
 * The idempotency key for one payment (AGENTS.md §15: stable, content-derived,
 * NEVER Date.now()). Same payment retried → same key. Genuinely different
 * payment → different key, because every field a human can vary is in it,
 * including the check/reference number that distinguishes two real cheques for
 * the same amount on the same day.
 *
 * Built from the INSERT PAYLOAD, not from the raw form, so the key can never
 * describe something other than the row we would write: the amount is the
 * rounded number we send, in cents, and an omitted date has already become
 * today's date.
 */
export function paymentIdempotencyKey(payload) {
  return [
    payload.invoice_id,
    amountCents(payload.amount),
    payload.payment_date,
    payload.payer_type,
    payload.payment_method,
    payload.payer_name,
    payload.reference_number,
    payload.contact_id,
    payload.job_id,
    payload.recorded_by,
  ].map((v) => (v == null ? '' : String(v))).join('|');
}

/** PostgREST filter that finds candidate rows for `payload` — the five
 *  unambiguous columns only; `paymentMatchesPayload` does the rest. */
export function paymentProbeQuery(payload) {
  const filters = PROBE_COLUMNS.map((col) => {
    const value = payload[col];
    return value == null
      ? `${col}=is.null`
      : `${col}=eq.${encodeURIComponent(String(value))}`;
  });
  return `${filters.join('&')}&order=created_at.desc&limit=10`;
}

/** Does a server row describe exactly the payment `payload` would have written? */
export function paymentMatchesPayload(row, payload) {
  if (!row) return false;
  if (amountCents(row.amount) !== amountCents(payload.amount)) return false;
  return SAFE_PAYMENT_COLUMNS.every((col) => {
    if (col === 'amount') return true;
    const a = row[col] == null ? null : String(row[col]);
    const b = payload[col] == null ? null : String(payload[col]);
    return a === b;
  });
}

/**
 * Create the record-payment function. One recorder per screen: the closure
 * holds the in-flight latch AND the per-key memory that survives a dropped
 * response, which is the part a UI-level guard cannot provide.
 *
 * `db` must expose BOTH insert and select — select is what makes the retry
 * probe possible, so a caller that forgets it fails loudly at construction
 * rather than silently losing the guarantee at 2am in a driveway.
 *
 * record({ invoice, job, employee, form }) resolves to:
 *   { ok:false, reason:'in_flight' | 'invalid_amount' }      — nothing written
 *   { ok:false, reason:'insert_failed', error }               — nothing written
 *   { ok:false, reason:'probe_failed', error }                — UNKNOWN; nothing written now
 *   { ok:true,  row, qboSynced:true }                         — saved + mirrored
 *   { ok:true,  row, qboSynced:false, qboSkipped:true }       — saved; no QBO invoice yet
 *   { ok:true,  row, qboSynced:false, qboError }              — saved; mirror failed (non-fatal)
 * plus `deduped:true` on any ok result served from a previous attempt instead
 * of a second insert.
 */
export function createPaymentRecorder({ db, getAuthHeader, fetchFn = (...a) => fetch(...a) }) {
  if (typeof db?.insert !== 'function' || typeof db?.select !== 'function') {
    throw new Error('createPaymentRecorder needs a db with both insert and select');
  }
  let inFlight = false;
  // key → the row we know landed. Serving a repeat from here is what stops a
  // retry-after-success from posting the money twice.
  const recorded = new Map();
  // key → an attempt whose outcome we never learned. The next attempt for this
  // key must ask the server before it writes.
  const unresolved = new Set();

  async function mirrorToQbo(invoice, row, extra) {
    // Only mirror to QBO when the invoice is already synced (human gate upheld).
    if (!invoice.qbo_invoice_id || !row?.id) {
      return { ok: true, row, qboSynced: false, qboSkipped: true, ...extra };
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
      return { ok: true, row, qboSynced: true, ...extra };
    } catch (e) {
      // NON-FATAL: the UPR payments row already persists; never roll back.
      return { ok: true, row, qboSynced: false, qboError: e.message || String(e), ...extra };
    }
  }

  return async function record({ invoice, job, employee, form }) {
    if (inFlight) return { ok: false, reason: 'in_flight' };
    const amt = Number(form?.amount);
    if (!(amt > 0)) return { ok: false, reason: 'invalid_amount' };
    inFlight = true;
    try {
      const payload = buildPaymentInsert({ invoice, job, employee, form });
      const key = paymentIdempotencyKey(payload);

      // Already landed on a previous attempt — never write it twice. The mirror
      // still re-runs, so "recorded but QuickBooks was down" is retryable.
      if (recorded.has(key)) {
        return await mirrorToQbo(invoice, recorded.get(key), { deduped: true });
      }

      // A previous attempt for this exact payment ended without an answer. Ask
      // the server what actually happened before writing anything.
      if (unresolved.has(key)) {
        let candidates;
        try {
          candidates = await db.select('payments', paymentProbeQuery(payload)) || [];
        } catch (e) {
          // We still do not know. Refusing costs the user another tap; guessing
          // costs them a duplicate payment in UPR and in QuickBooks.
          return { ok: false, reason: 'probe_failed', error: e.message || String(e) };
        }
        const found = candidates.find((r) => paymentMatchesPayload(r, payload));
        if (found) {
          unresolved.delete(key);
          recorded.set(key, found);
          return await mirrorToQbo(invoice, found, { deduped: true });
        }
        unresolved.delete(key); // answered: it never landed, so writing it is safe
      }

      let inserted;
      try {
        inserted = await db.insert('payments', payload);
      } catch (e) {
        // The insert may or may not have reached the database — a 403 writes
        // nothing, a dropped response writes everything. We cannot tell them
        // apart here, so every failure arms the probe and the next attempt asks.
        unresolved.add(key);
        return { ok: false, reason: 'insert_failed', error: e.message || String(e) };
      }
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      if (row?.id) recorded.set(key, row);
      return await mirrorToQbo(invoice, row);
    } finally {
      inFlight = false;
    }
  };
}
