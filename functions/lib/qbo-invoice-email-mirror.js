/**
 * ════════════════════════════════════════════════
 * FILE: qbo-invoice-email-mirror.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Copies two facts off a QuickBooks invoice into UPR: whether QuickBooks has
 *   emailed it, and which address QuickBooks emails it to. Before this, UPR only
 *   knew about emails IT sent, so an invoice emailed from inside QuickBooks
 *   looked like it had never been emailed at all — and nobody could see when
 *   QuickBooks was mailing a different address than the customer we have on file.
 *
 *   It never asks QuickBooks for anything. Every caller already has a QuickBooks
 *   invoice in hand for its own reasons; this just reads two more fields off it.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  callers pass their own functions/lib/supabase.js client
 *   Data:      writes → invoices.qbo_email_status, .qbo_bill_email,
 *                       .qbo_email_checked_at  (and NOTHING else)
 *
 * NOTES / GOTCHAS:
 *   - NEVER widen the written column set. qbo_emailed_at is UPR-send truth and is
 *     watched by trg_invoice_qbo_lifecycle_status (derives invoice status) and
 *     crm_invoice_lead_value_sync (derives CRM lead value); status/amount_paid/
 *     paid_at are trigger-owned (AGENTS.md §15). Writing any of them from an
 *     observation would let a QuickBooks read move UPR money and CRM reporting.
 *   - The three written columns are watched by no trigger. `trg_invoices_sync_job_ar`
 *     fires on any invoices UPDATE, but it only recomputes job A/R from the
 *     invoices themselves — idempotent, and unaffected by these columns.
 *   - A projection that did not select EmailStatus is NOT an observation. Reading
 *     absence as "not emailed" would erase a known status, so an entity with no
 *     EmailStatus key yields null and the caller writes nothing. Callers doing a
 *     field-projected query MUST select both EmailStatus and BillEmail.
 *   - Writes are skipped when nothing changed, so a repeated sweep does not churn
 *     rows (or re-fire the job A/R recompute) for invoices whose email state is
 *     unchanged. A row that has never been observed is always written once, so
 *     qbo_email_checked_at gets stamped even when the values happen to match.
 *   - THE COLUMNS MAY NOT EXIST YET. Migration 20260807190000 is authored but
 *     applying it to the shared project is a separate owner-authorized step, while
 *     this code deploys to dev on merge. PostgREST answers 400 for an unknown
 *     column and the db client THROWS on any non-OK, so a caller that named these
 *     columns in its own select would break outright before the apply. That is why
 *     the read lives HERE and is guarded: with no columns, readEmailObservations
 *     returns null and the whole mirror becomes a silent no-op. Never move that
 *     select back into a caller.
 *   - Best-effort by contract: every caller sits on a completed money action, so a
 *     failure here is swallowed exactly like invoice-activity evidence. Losing an
 *     observation must never lose an invoice save, send, or payment.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Helpers ──────────────

const text = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

/**
 * Read the email observation off a QuickBooks Invoice entity.
 *
 * Returns null when the entity carries no EmailStatus — that means the caller's
 * projection did not include the email fields, which is "we did not look", not
 * "QuickBooks says no". Writing null in that case would erase a real status.
 *
 * @param {object} qboInvoice a QBO Invoice entity (full read, or a query that
 *   explicitly selected BOTH EmailStatus and BillEmail)
 * @returns {{qbo_email_status: string, qbo_bill_email: string|null}|null}
 */
export function qboInvoiceEmailObservation(qboInvoice) {
  if (!qboInvoice || typeof qboInvoice !== 'object' || Array.isArray(qboInvoice)) return null;
  const status = text(qboInvoice.EmailStatus);
  if (!status) return null;
  // BillEmail is omitted entirely by QuickBooks when the invoice has no billing
  // email, so its absence here IS an observation: nobody is on the envelope.
  return { qbo_email_status: status, qbo_bill_email: text(qboInvoice.BillEmail?.Address) };
}

/**
 * Would writing `observation` change anything we have stored?
 *
 * A row UPR has never observed (no qbo_email_checked_at) always counts as changed
 * so the first observation is always stamped, even if the values coincide with
 * what an older UPR-triggered send already wrote into qbo_email_status.
 */
export function emailObservationChanged(storedInvoice, observation) {
  if (!observation) return false;
  const stored = storedInvoice || {};
  if (!stored.qbo_email_checked_at) return true;
  return text(stored.qbo_email_status) !== observation.qbo_email_status
    || text(stored.qbo_bill_email) !== observation.qbo_bill_email;
}

// ─── SECTION: Exports ──────────────

/** The only columns this module ever reads or writes. */
export const EMAIL_MIRROR_COLUMNS = 'qbo_email_status,qbo_bill_email,qbo_email_checked_at';

const idList = (invoiceIds) => [...new Set(
  (Array.isArray(invoiceIds) ? invoiceIds : [invoiceIds])
    .filter((id) => id != null && id !== '')
    .map(String),
)];

// A UUID costs ~37 characters inside `id=in.(...)`, so the whole invoice book in
// one filter would build a multi-kilobyte URL and eventually be truncated or
// rejected. 100 keeps each request well under any gateway limit while still
// costing only a handful of round trips for the entire book.
const READ_CHUNK = 100;

/**
 * Read the stored observation for these invoices.
 *
 * Returns a Map(id → row), or **null when the columns are not available** — which
 * is the pre-apply state of migration 20260807190000 and must be treated as "do
 * nothing", never as "everything is unobserved" (that would make every caller
 * attempt a write that 400s on every invoice save, forever, until the apply).
 *
 * Batch-friendly on purpose: the drift sweep has hundreds of invoices and cannot
 * afford a round trip each. Any failed chunk fails the whole read, because a
 * partial map would look like "these rows were never observed" and rewrite them.
 *
 * @returns {Promise<Map<string, object>|null>}
 */
export async function readEmailObservations(db, invoiceIds) {
  const ids = idList(invoiceIds);
  if (!ids.length) return new Map();
  const found = new Map();
  try {
    for (let i = 0; i < ids.length; i += READ_CHUNK) {
      const batch = ids.slice(i, i + READ_CHUNK);
      const rows = await db.select('invoices', `id=in.(${batch.join(',')})&select=id,${EMAIL_MIRROR_COLUMNS}`);
      for (const row of rows || []) found.set(String(row.id), row);
    }
  } catch {
    // Unknown column (migration not applied yet), or a transient read failure.
    // Both mean the same thing here: skip, quietly.
    return null;
  }
  return found;
}

/**
 * Mirror one QuickBooks invoice's email state onto the UPR invoices that carry it.
 * Best-effort: returns how many rows it wrote and never throws.
 *
 * A combined QuickBooks bill can back several UPR invoices, which is why this
 * takes a list of ids. Pass `stored` (from a single batched `readEmailObservations`)
 * when mirroring many invoices in one pass; otherwise it reads its own.
 *
 * @returns {Promise<{written: number, skipped: number, unavailable?: boolean}>}
 */
export async function mirrorQboInvoiceEmail(db, invoiceIds, qboInvoice, { stored } = {}) {
  const ids = idList(invoiceIds);
  const observation = qboInvoiceEmailObservation(qboInvoice);
  if (!observation || !ids.length) return { written: 0, skipped: ids.length };

  const current = stored !== undefined ? stored : await readEmailObservations(db, ids);
  if (current == null) return { written: 0, skipped: ids.length, unavailable: true };

  // An id with no row read back is genuinely unobserved, so it writes.
  const stale = ids.filter((id) => emailObservationChanged(current.get(id), observation));
  if (!stale.length) return { written: 0, skipped: ids.length };

  const patch = { ...observation, qbo_email_checked_at: new Date().toISOString() };
  let written = 0;
  for (const id of stale) {
    try {
      await db.update('invoices', `id=eq.${encodeURIComponent(id)}`, patch);
      written += 1;
    } catch {
      // Evidence is best-effort; never fail a completed money action over it.
    }
  }
  return { written, skipped: ids.length - written };
}
