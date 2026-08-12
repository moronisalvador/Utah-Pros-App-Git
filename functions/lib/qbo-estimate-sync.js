/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-sync.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When a customer responds to a QuickBooks estimate (accepts or declines it
 *   online), this pulls that answer into UPR. An accepted estimate is marked
 *   approved and converted into a draft UPR invoice — the same thing the staff
 *   "Convert to invoice" button does — so the team is notified and the invoice
 *   is ready to review. Nothing is pushed back to QuickBooks automatically.
 *
 * WHERE IT LIVES:
 *   Used by:  functions/api/qbo-webhook.js (real-time Estimate events) and
 *             functions/api/qbo-payments-sync.js (hourly safety-net sweep)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/quickbooks.js (qboFetch),
 *              functions/lib/qbo-payment-sync.js (QBO fault helpers + the
 *              estimate→invoice adoption used by the deposit path)
 *   Data:      reads  → estimates (Supabase); QBO Estimate (Intuit)
 *              writes → estimates, invoices and line items through the locked
 *                       apply_qbo_estimate_decision / conversion RPCs
 *
 * NOTES / GOTCHAS:
 *   - The status flip to 'approved' fires the existing trg_estimate_accepted_notify
 *     DB trigger, which sends the "Estimate accepted" admin notification. Do NOT
 *     add a second notify dispatch here — it would double-notify.
 *   - The human Save-to-QuickBooks gate stays sacred: this NEVER calls
 *     /api/qbo-invoice. The converted UPR invoice waits for a human to push it.
 *   - Only pre-decision estimates (draft/submitted/under_review/revised) are
 *     auto-advanced. A UPR estimate already approved, denied or paid is left
 *     alone — a QBO answer that contradicts a staff decision is a conversation,
 *     not an automatic overwrite.
 *   - Idempotent: re-delivered webhooks and hourly sweeps hit the status guards
 *     and no-op. UPR's own conversions echo back from QBO as TxnStatus
 *     'Converted' with converted_invoice_id already set — also a no-op.
 * ════════════════════════════════════════════════
 */

import { qboFetch } from './quickbooks.js';
import {
  adoptInvoiceFromQboEstimate,
  readQboFault,
  isQboNotFound,
  QboRequestError,
} from './qbo-payment-sync.js';

const MINOR_VERSION = '70';

// UPR estimate statuses this sync may advance. Anything else (approved, denied,
// paid) is a decision already made in UPR and is never overwritten automatically.
const ACTIONABLE_STATUSES = new Set(['draft', 'submitted', 'under_review', 'revised']);

// QBO's AcceptedDate is date-only (e.g. "2026-07-31"). Anchor it to noon UTC —
// the DST-immune convention notify.js and google-calendar.js already use for
// date-only strings — so approved_at lands on the day the customer actually
// accepted (in any US zone) even when the hourly sweep catches up late.
export function acceptedDateToIso(acceptedDate) {
  if (!acceptedDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(acceptedDate))) return null;
  const d = new Date(`${acceptedDate}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function unwrapRpc(result) {
  return Array.isArray(result) ? result[0] : result;
}

// The RPC makes the authoritative, locked decision. This only labels a returned
// no-op for the durable reconciliation ledger; it never makes a worker-side
// state decision or write.
function withDecisionConflict(result, providerAction) {
  if (result?.skipped !== 'already-decided') return result;
  const status = String(result.status || '');
  const conflict = providerAction === 'accept' ? status !== 'approved' : status !== 'denied';
  return conflict ? { ...result, manual_reconciliation: 'staff-decision-conflict' } : result;
}

// Mirror one QBO Estimate's customer answer into UPR. Idempotent; safe to call
// for any estimate id (untracked ids and no-op statuses are skipped).
// Returns { ok, result: { action?, skipped?, ... } }.
export async function syncQboEstimateToUpr(env, db, qboEstimateId, { expectedRealmId } = {}) {
  const res = await qboFetch(env, `/estimate/${qboEstimateId}?minorversion=${MINOR_VERSION}`, { method: 'GET', expectedRealmId });
  if (!res.ok) {
    // Intuit reports entity reads that fail as HTTP 400 Faults, not 404 (see
    // qbo-payment-sync.js). A deleted/never-existed estimate is benign-terminal.
    if (res.status === 404) return { ok: true, result: { skipped: 'estimate-not-found' } };
    const fault = await readQboFault(res);
    if (isQboNotFound(fault)) return { ok: true, result: { skipped: 'estimate-not-found' } };
    throw new QboRequestError('get estimate', fault);
  }
  const data = await res.json().catch(() => ({}));
  const qboEst = data?.Estimate;
  if (!qboEst) return { ok: true, result: { skipped: 'no-estimate' } };

  const estimates = (await db.select(
    'estimates',
    `qbo_estimate_id=eq.${qboEstimateId}&select=id,status,amount,approved_at,approved_amount,converted_invoice_id,estimate_number&limit=2`,
  )) || [];
  // Combined billing can legitimately map one QBO document to multiple UPR rows.
  // There is no owner-approved automatic allocation rule for an estimate answer,
  // so never choose whichever row PostgREST happens to return first.
  if (estimates.length > 1) {
    return { ok: true, result: { skipped: 'combined-estimate-manual-reconciliation' } };
  }
  const est = estimates[0];
  if (!est) return { ok: true, result: { skipped: 'not-tracked' } };

  const txnStatus = String(qboEst.TxnStatus || '');

  if (txnStatus === 'Accepted') {
    // All status guards and writes are owned by the locked RPC. Never split
    // acceptance metadata and status into worker-side updates.
    const result = unwrapRpc(await db.rpc('apply_qbo_estimate_decision', {
      p_estimate_id: est.id,
      p_action: 'accept',
      p_approved_at: acceptedDateToIso(qboEst.AcceptedDate),
      p_approved_amount: Number.isFinite(Number(qboEst.TotalAmt)) && Number(qboEst.TotalAmt) > 0 ? Number(qboEst.TotalAmt) : null,
    }));
    return { ok: true, result: withDecisionConflict(result, 'accept') };
  }

  if (txnStatus === 'Rejected') {
    const result = unwrapRpc(await db.rpc('apply_qbo_estimate_decision', {
      p_estimate_id: est.id,
      p_action: 'reject',
      p_approved_at: null,
      p_approved_amount: null,
    }));
    return { ok: true, result: withDecisionConflict(result, 'reject') };
  }

  if (txnStatus === 'Converted') {
    // Echo of a UPR-side conversion (we created the QBO invoice with a LinkedTxn,
    // QBO flipped the estimate) — everything is already recorded.
    if (est.converted_invoice_id) return { ok: true, result: { skipped: 'already-converted' } };

    // QBO-side conversion (someone converted it inside QuickBooks): adopt the
    // QBO invoice only if conversion can preserve the no-append guard. A decided
    // estimate is never overturned here — a staff denial (or legacy 'paid') stays
    // put; only pre-decision estimates and an 'approved, awaiting manual convert'
    // one may adopt. Unlike the deposit-payment path, this does not force lines
    // onto an invoice that already has some.
    const link = (qboEst.LinkedTxn || []).find((l) => l.TxnType === 'Invoice');
    if (link) {
      if (est.status !== 'approved' && !ACTIONABLE_STATUSES.has(est.status)) {
        return { ok: true, result: { skipped: 'already-decided', status: est.status, manual_reconciliation: 'staff-decision-conflict' } };
      }
      const adopted = await adoptInvoiceFromQboEstimate(env, db, String(link.TxnId), false, true, { expectedRealmId });
      if (adopted?.blocked) return { ok: true, result: { skipped: adopted.blocked } };
      if (adopted) return { ok: true, result: { action: 'adopted-qbo-conversion', invoice_id: adopted.id } };
    }
    // No readable linked invoice — record the acceptance so staff are told,
    // and leave the conversion to a human.
    if (!ACTIONABLE_STATUSES.has(est.status)) {
      return { ok: true, result: { skipped: 'already-decided', status: est.status, manual_reconciliation: 'staff-decision-conflict' } };
    }
    return { ok: true, result: unwrapRpc(await db.rpc('apply_qbo_estimate_decision', {
      p_estimate_id: est.id,
      p_action: 'approve_only',
      p_approved_at: acceptedDateToIso(qboEst.AcceptedDate),
      p_approved_amount: Number.isFinite(Number(qboEst.TotalAmt)) && Number(qboEst.TotalAmt) > 0 ? Number(qboEst.TotalAmt) : null,
    })) };
  }

  // Pending / Closed / anything new Intuit invents: nothing to mirror.
  return { ok: true, result: { skipped: 'status-not-synced', txn_status: txnStatus || null } };
}
