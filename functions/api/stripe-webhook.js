/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Listens for Stripe telling us a customer paid, and records it in UPR and in
 *   QuickBooks. A card payment is money straight away. A bank payment (ACH) is
 *   not — it can be accepted and then bounce days later — so this deliberately
 *   waits for Stripe to confirm the money actually arrived before recording
 *   anything as paid.
 *
 * WHERE IT LIVES:
 *   Route:  POST /api/stripe-webhook  (Stripe calls this; no person does)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, http, supabase, worker-runs, stripe, quickbooks,
 *              qbo-payment-sync, stripe-payment-commands, stripe-payment-gate
 *   Data:      reads  → invoices, contacts, jobs, integration_config, feature_flags
 *              writes → payments, stripe_events, stripe_payment_commands,
 *                       worker_runs, and QuickBooks Payment/Purchase/Transfer
 *
 * NOTES / GOTCHAS:
 *   - **An in-flight ACH must never create a `payments` row.** That table has no
 *     status column, and `update_invoice_paid()` fires on INSERT — it would
 *     reduce balance_due and flip the invoice to paid immediately, days before
 *     the money settles. Pending ACH waits in `stripe_payment_commands`.
 *   - **A late ACH failure arrives as `charge.dispute.created`**, not
 *     `payment_intent.payment_failed`. Stripe wraps a post-settlement bank
 *     return in a dispute whose `reason` is `insufficient_funds`,
 *     `incorrect_account_details` or `bank_cannot_process`. Handling only the
 *     failure events would leave a bounced payment marked paid forever.
 *   - Never write `invoices.amount_paid` / `status` / `paid_at` /
 *     `insurance_paid` / `homeowner_paid`. The trigger owns them. Insert a
 *     `payments` row and stop.
 *   - `payer_type` is the ONLY input to the insurance/homeowner split, so it is
 *     derived from the invoice rather than assumed.
 * ════════════════════════════════════════════════
 */

import { jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { stripeConfigured, constructEvent, retrieveCharge } from '../lib/stripe.js';
import {
  getConnection, createPayment, createPurchase, createTransfer, deletePayment, deleteEntity,
} from '../lib/quickbooks.js';
import { notifyPaymentReceived } from '../lib/qbo-payment-sync.js';
import {
  reserveStripePaymentCommand,
  startStripePaymentCommand,
  finalizeStripePaymentCommand,
  classifyProviderFailure,
} from '../lib/stripe-payment-commands.js';
import {
  requireStripePaymentCommandV1,
  stripeProjectionUnavailableResponse,
  STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
} from './stripe-payment-gate.js';

// Re-exported for compatibility: the containment stub exported this and other
// modules/tests may still import it from here.
export { STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED };

const ymd = (unixSec) => new Date(unixSec ? unixSec * 1000 : Date.now()).toISOString().slice(0, 10);

/**
 * A post-settlement bank return, dressed as a dispute.
 *
 * Stripe: "In rare situations, Stripe might receive an ACH failure from the bank
 * after a PaymentIntent has transitioned to succeeded. If this happens, Stripe
 * creates a dispute." These reasons mean the money left; they are not a customer
 * disagreeing with a charge, and treating them as one loses real revenue.
 */
const ACH_RETURN_REASONS = new Set([
  'insufficient_funds',
  'incorrect_account_details',
  'bank_cannot_process',
]);

/**
 * Who actually paid.
 *
 * This is the ONLY input `update_invoice_paid()` uses to split insurance_paid
 * from homeowner_paid, so guessing corrupts the split. The pre-containment
 * version hardcoded 'homeowner', which booked every carrier payment as homeowner
 * money on an invoice billed to insurance.
 *
 * ⚠️ 'property_manager' and 'mortgage_co' are legal on `payments` but fall into
 * NEITHER bucket in that trigger — they land in amount_paid and nowhere else, so
 * insurance_paid + homeowner_paid will not equal amount_paid for them. That is a
 * pre-existing trigger gap. It is deliberately NOT papered over here by
 * misattributing the money to a bucket it does not belong in; an honest gap is
 * better than a wrong number.
 */
function payerTypeForInvoice(inv) {
  switch (inv?.billed_to) {
    case 'insurance': return 'insurance';
    case 'homeowner': return 'homeowner';
    case 'property_manager': return 'property_manager';
    default: return 'other';
  }
}

async function getConfig(db, keys) {
  const rows = await db.select('integration_config', `key=in.(${keys.join(',')})&select=key,value`).catch(() => []);
  const m = {};
  (rows || []).forEach((r) => { m[r.key] = r.value; });
  return m;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  await recordWorkerRun(db, {
    workerName: 'stripe-webhook', status, recordsProcessed: processed, errorMessage, startedAt,
  }).catch(() => {});
}

/** Resolve the UPR invoice a Stripe object refers to, plus the contact to bill. */
async function resolveInvoice(db, invoiceId) {
  const inv = (await db.select(
    'invoices',
    `id=eq.${invoiceId}&select=id,invoice_number,qbo_doc_number,job_id,contact_id,qbo_invoice_id,billed_to&limit=1`,
  ))?.[0];
  if (!inv) return { inv: null, contactId: null };

  let contactId = inv.contact_id;
  if (!contactId && inv.job_id) {
    const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=primary_contact_id&limit=1`))?.[0];
    contactId = job?.primary_contact_id || null;
  }
  return { inv, contactId };
}

function chargeIdOf(pi) {
  return typeof pi?.latest_charge === 'string' ? pi.latest_charge : pi?.latest_charge?.id;
}

/**
 * ACH submitted to the network. NOT money yet.
 *
 * Recorded in the command ledger only. Creating a `payments` row here would fire
 * the trigger and mark the invoice paid up to four business days before the funds
 * settle — and an ACH debit that later bounces would leave it that way.
 */
async function handleAchProcessing(env, db, pi, eventId) {
  const invoiceId = pi?.metadata?.invoice_id;
  if (!invoiceId) return { skipped: true, reason: 'no invoice_id in metadata' };

  const chargeId = chargeIdOf(pi);
  if (!chargeId) return { skipped: true, reason: 'no charge on payment_intent' };

  const conn = await getConnection(env).catch(() => null);
  const realmId = conn?.realm_id ? String(conn.realm_id) : 'unknown';

  const cmd = await reserveStripePaymentCommand(db, {
    stripeObjectId: chargeId,
    stripeEventId: eventId,
    action: 'record_payment',
    realmId,
    invoiceId,
    intent: {
      action: 'record_payment',
      amount_cents: Number(pi.amount ?? 0),
      invoice_id: String(invoiceId),
      payment_intent_id: String(pi.id),
    },
  });

  // Only move a FRESH reservation into pending. Never walk back a command that
  // already succeeded — events can arrive out of order.
  if (cmd?.id && cmd.status === 'prepared') {
    await finalizeStripePaymentCommand(db, cmd.id, { status: 'pending_settlement' });
  }
  return {
    pending: true, charge: chargeId, invoice_id: invoiceId, command_id: cmd?.id || null,
  };
}

/**
 * payment_intent.succeeded → the money is real.
 *
 * UPR payment at GROSS, QBO Payment deposited to Stripe Clearing, then the exact
 * Stripe fee booked out of clearing to Stripe Fees. Clearing then holds the net,
 * which payout.paid transfers to the real bank so it self-zeroes. If it does not
 * zero, something booked wrong — that is the design's built-in check.
 */
async function handlePaymentIntent(env, db, pi, eventId) {
  const invoiceId = pi?.metadata?.invoice_id;
  if (!invoiceId) return { skipped: true, reason: 'no invoice_id in metadata' };

  const chargeId = chargeIdOf(pi);
  if (!chargeId) return { skipped: true, reason: 'no charge on payment_intent' };

  // Exact gross/fee/net from the charge's balance_transaction — never estimated,
  // so a varying Stripe rate cannot drift the books.
  const charge = await retrieveCharge(env, chargeId);
  const bt = charge.balance_transaction;
  const gross = Number(bt?.amount ?? charge.amount ?? 0) / 100;
  const fee = Number(bt?.fee ?? 0) / 100;
  const txnDate = ymd(charge.created);
  const method = charge.payment_method_details?.type === 'us_bank_account' ? 'ach' : 'credit_card';

  const { inv, contactId } = await resolveInvoice(db, invoiceId);
  if (!inv) return { skipped: true, reason: 'invoice not found', invoice_id: invoiceId };

  // Charge-level idempotency: a re-seen charge reuses the existing payment row.
  let pay = (await db.select('payments', `stripe_charge_id=eq.${chargeId}&select=*&limit=1`))?.[0];
  let wasNewPayment = false;
  if (!pay) {
    const inserted = await db.insert('payments', {
      invoice_id: inv.id,
      job_id: inv.job_id || null,
      contact_id: contactId || null,
      amount: gross,
      payment_date: txnDate,
      payer_type: payerTypeForInvoice(inv),
      payment_method: method,
      reference_number: chargeId,
      source: 'stripe',
      stripe_payment_intent_id: pi.id,
      stripe_charge_id: chargeId,
      stripe_fee: fee,
    });
    pay = Array.isArray(inserted) ? inserted[0] : inserted;
    wasNewPayment = true;
  }

  // Fire-and-forget, and only on a fresh insert so a redelivered event never
  // re-notifies. A notification failure must not affect the QBO push below.
  if (wasNewPayment) {
    await notifyPaymentReceived({
      db,
      env,
      amount: gross,
      invoiceId: inv.id,
      jobId: inv.job_id || null,
      contactId: contactId || inv.contact_id || null,
      source: 'Stripe',
      reference: chargeId,
      invoiceNumber: inv.qbo_doc_number || inv.invoice_number || null,
      paymentEventId: pay?.id || `stripe:${chargeId}`,
    }).catch(() => {});
  }

  const result = {
    payment_id: pay.id,
    invoice_id: inv.id,
    gross,
    fee,
    qbo_payment_id: pay.qbo_payment_id || null,
    qbo_fee_purchase_id: pay.stripe_fee_qbo_purchase_id || null,
    qbo_error: null,
  };

  try {
    const conn = await getConnection(env);
    if (!conn?.refresh_token) throw new Error('QuickBooks not connected');
    if (!inv.qbo_invoice_id) {
      throw new Error('Invoice not in QuickBooks yet — sync the invoice, then re-push this payment');
    }
    const realmId = conn.realm_id ? String(conn.realm_id) : 'unknown';

    const cfg = await getConfig(db, ['qbo_stripe_clearing_account_id', 'qbo_fee_expense_account_id']);
    const clearingId = cfg.qbo_stripe_clearing_account_id || null;

    const contact = contactId
      ? (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id&limit=1`))?.[0]
      : null;
    if (!contact?.qbo_customer_id) {
      throw new Error('Customer has no QuickBooks record — sync the client first');
    }

    // ── QBO Payment, behind the durable ledger ──
    // The amount is whatever Stripe collected, which may be less than the invoice
    // total: createPayment applies a partial amount against the invoice via
    // LinkedTxn and QuickBooks leaves the balance open for the remainder.
    if (!result.qbo_payment_id) {
      const cmd = await reserveStripePaymentCommand(db, {
        stripeObjectId: chargeId,
        stripeEventId: eventId,
        action: 'record_payment',
        realmId,
        invoiceId: inv.id,
        paymentId: pay.id,
        intent: {
          action: 'record_payment',
          amount_cents: Math.round(gross * 100),
          invoice_id: String(inv.id),
          qbo_invoice_id: String(inv.qbo_invoice_id),
          payment_intent_id: String(pi.id),
        },
      });

      if (cmd?.status === 'succeeded' && cmd.provider_target_id) {
        // Already pushed — a redelivery. Adopt the id rather than pushing again.
        result.qbo_payment_id = cmd.provider_target_id;
      } else if (cmd?.id) {
        await startStripePaymentCommand(db, cmd.id);
        try {
          const qboPay = await createPayment(env, {
            customerId: contact.qbo_customer_id,
            qboInvoiceId: inv.qbo_invoice_id,
            amount: gross,
            txnDate,
            privateNote: `UPR Stripe ${pi.id} · ${inv.invoice_number || ''}`,
            depositAccountId: clearingId,
            requestId: cmd.provider_request_id,
          });
          result.qbo_payment_id = String(qboPay.Id);
          await finalizeStripePaymentCommand(db, cmd.id, {
            status: 'succeeded',
            providerTargetId: result.qbo_payment_id,
            paymentId: pay.id,
          });
        } catch (e) {
          // An ambiguous failure keeps the frozen request id so the retry is
          // recognised by Intuit instead of creating a second Payment.
          await finalizeStripePaymentCommand(db, cmd.id, {
            status: classifyProviderFailure(e),
            error: e.message,
            intuitRequestId: e.intuitTid || null,
          });
          throw e;
        }
      }

      if (result.qbo_payment_id) {
        // Stamp the realm with the id. Without this a Stripe-mirrored row keeps
        // qbo_realm_id NULL forever, so it stays matchable by the cleanup's
        // NULL-tolerant arm — turning a shrinking historical population into an
        // ongoing one, the opposite of what 20260808070000 is for.
        await db.update('payments', `id=eq.${pay.id}`, {
          qbo_payment_id: result.qbo_payment_id,
          qbo_realm_id: realmId === 'unknown' ? null : realmId,
          qbo_synced_at: new Date().toISOString(),
          qbo_sync_error: null,
        });
      }
    }

    // ── The processing fee, also behind the ledger ──
    if (fee > 0 && !result.qbo_fee_purchase_id && clearingId && cfg.qbo_fee_expense_account_id) {
      const feeCmd = await reserveStripePaymentCommand(db, {
        stripeObjectId: chargeId,
        stripeEventId: eventId,
        action: 'book_fee',
        realmId,
        invoiceId: inv.id,
        paymentId: pay.id,
        intent: {
          action: 'book_fee',
          fee_cents: Math.round(fee * 100),
          expense_account_id: String(cfg.qbo_fee_expense_account_id),
          paid_from_account_id: String(clearingId),
        },
      });

      if (feeCmd?.status === 'succeeded' && feeCmd.provider_target_id) {
        result.qbo_fee_purchase_id = feeCmd.provider_target_id;
      } else if (feeCmd?.id) {
        await startStripePaymentCommand(db, feeCmd.id);
        try {
          const purchase = await createPurchase(env, {
            paidFromAccountId: clearingId,
            expenseAccountId: cfg.qbo_fee_expense_account_id,
            amount: fee,
            txnDate,
            privateNote: `Stripe fee · ${pi.id} · ${inv.invoice_number || ''}`,
            requestId: feeCmd.provider_request_id,
          });
          result.qbo_fee_purchase_id = String(purchase.Id);
          await finalizeStripePaymentCommand(db, feeCmd.id, {
            status: 'succeeded',
            providerTargetId: result.qbo_fee_purchase_id,
          });
          await db.update('payments', `id=eq.${pay.id}`, {
            stripe_fee_qbo_purchase_id: result.qbo_fee_purchase_id,
          });
        } catch (e) {
          await finalizeStripePaymentCommand(db, feeCmd.id, {
            status: classifyProviderFailure(e),
            error: e.message,
            intuitRequestId: e.intuitTid || null,
          });
          throw e;
        }
      }
    }
  } catch (e) {
    result.qbo_error = e.message;
    await db.update('payments', `id=eq.${pay.id}`, {
      qbo_sync_error: String(e.message).slice(0, 500),
    }).catch(() => {});
  }

  return result;
}

/** payout.paid → Transfer the net (clearing → real bank), zeroing the clearing batch. */
async function handlePayout(env, db, payout, eventId) {
  const net = Number(payout.amount || 0) / 100;
  if (!(net > 0)) return { skipped: true, reason: 'non-positive payout' };

  const conn = await getConnection(env);
  if (!conn?.refresh_token) return { skipped: true, reason: 'QuickBooks not connected' };
  const realmId = conn.realm_id ? String(conn.realm_id) : 'unknown';

  const cfg = await getConfig(db, ['qbo_stripe_clearing_account_id', 'qbo_bank_account_id']);
  if (!cfg.qbo_stripe_clearing_account_id || !cfg.qbo_bank_account_id) {
    return { skipped: true, reason: 'clearing/bank account not mapped in Payment Settings' };
  }

  const cmd = await reserveStripePaymentCommand(db, {
    stripeObjectId: payout.id,
    stripeEventId: eventId,
    action: 'transfer_payout',
    realmId,
    intent: {
      action: 'transfer_payout',
      net_cents: Math.round(net * 100),
      from_account_id: String(cfg.qbo_stripe_clearing_account_id),
      to_account_id: String(cfg.qbo_bank_account_id),
    },
  });

  if (cmd?.status === 'succeeded' && cmd.provider_target_id) {
    return { payout_id: payout.id, net, qbo_transfer_id: cmd.provider_target_id, replayed: true };
  }
  if (!cmd?.id) return { skipped: true, reason: 'could not reserve payout command' };

  await startStripePaymentCommand(db, cmd.id);
  try {
    const transfer = await createTransfer(env, {
      fromAccountId: cfg.qbo_stripe_clearing_account_id,
      toAccountId: cfg.qbo_bank_account_id,
      amount: net,
      txnDate: ymd(payout.arrival_date || payout.created),
      privateNote: `Stripe payout ${payout.id}`,
      requestId: cmd.provider_request_id,
    });
    await finalizeStripePaymentCommand(db, cmd.id, {
      status: 'succeeded', providerTargetId: String(transfer.Id),
    });
    return { payout_id: payout.id, net, qbo_transfer_id: String(transfer.Id) };
  } catch (e) {
    await finalizeStripePaymentCommand(db, cmd.id, {
      status: classifyProviderFailure(e), error: e.message, intuitRequestId: e.intuitTid || null,
    });
    return { payout_id: payout.id, net, error: e.message };
  }
}

/**
 * Reverse a payment whose money has left us.
 *
 * The trigger reopens A/R from `refunded_amount`; there is no negative payment
 * row (the table forbids amount <= 0) and a payment is never deleted to undo it,
 * because deleting would erase the record that it ever happened.
 */
async function reversePaymentInQbo(env, db, pay, { full, note }) {
  if (!full) {
    // Deliberately not auto-editing the QBO payment on a partial: mis-stating
    // cash is worse than asking a human to reduce it.
    await db.update('payments', `id=eq.${pay.id}`, { qbo_sync_error: note });
    return 'partial-flagged';
  }
  if (pay.qbo_payment_id) await deletePayment(env, pay.qbo_payment_id);
  if (pay.stripe_fee_qbo_purchase_id) await deleteEntity(env, 'purchase', pay.stripe_fee_qbo_purchase_id);
  // The realm is cleared with the id (20260808070000) — it labels a QBO payment
  // number, so it means nothing once that number is gone.
  await db.update('payments', `id=eq.${pay.id}`, {
    qbo_payment_id: null,
    qbo_realm_id: null,
    stripe_fee_qbo_purchase_id: null,
    qbo_synced_at: null,
    qbo_sync_error: null,
  });
  return 'full';
}

/** charge.refunded → net the refund out of collected; a FULL refund reverses QBO. */
async function handleRefund(env, db, charge) {
  const pay = (await db.select('payments', `stripe_charge_id=eq.${charge.id}&select=*&limit=1`))?.[0];
  if (!pay) return { skipped: true, reason: 'no matching payment', charge: charge.id };

  const refundedCents = Number(charge.amount_refunded || 0);
  const refunded = refundedCents / 100;
  const full = charge.refunded === true || refundedCents >= Number(charge.amount || 0);

  await db.update('payments', `id=eq.${pay.id}`, {
    refunded_amount: refunded, refunded_at: new Date().toISOString(),
  });

  let qbo_error = null;
  let reversed = null;
  try {
    const conn = await getConnection(env);
    if (!conn?.refresh_token) throw new Error('QuickBooks not connected');
    reversed = await reversePaymentInQbo(env, db, pay, {
      full,
      note: `Partial refund $${refunded.toFixed(2)} — reduce the QuickBooks payment manually`,
    });
  } catch (e) {
    qbo_error = e.message;
    await db.update('payments', `id=eq.${pay.id}`, {
      qbo_sync_error: String(e.message).slice(0, 500),
    }).catch(() => {});
  }
  return { payment_id: pay.id, refunded, full, reversed, qbo_error };
}

/**
 * charge.dispute.created — TWO different events wearing one name.
 *
 * With an ACH-return reason this is not a dispute at all: it is the bank taking
 * the money back after Stripe already reported success. Either way the funds are
 * gone, so both paths net the amount and reverse the QuickBooks payment. They
 * differ in what they record, so a human can tell "the bank returned this" from
 * "the customer is contesting this" without going to Stripe to find out.
 */
async function handleDispute(env, db, dispute) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return { skipped: true, reason: 'no charge on dispute' };
  const pay = (await db.select('payments', `stripe_charge_id=eq.${chargeId}&select=*&limit=1`))?.[0];
  if (!pay) return { skipped: true, reason: 'no matching payment', charge: chargeId };

  const isAchReturn = ACH_RETURN_REASONS.has(dispute.reason);
  const withheld = Math.min(Number(dispute.amount || 0) / 100, Number(pay.amount || 0));
  const full = withheld >= Number(pay.amount || 0);

  await db.update('payments', `id=eq.${pay.id}`, {
    dispute_status: isAchReturn ? `ach_return:${dispute.reason}` : (dispute.status || 'created'),
    refunded_amount: withheld,
    refunded_at: new Date().toISOString(),
  });

  let qbo_error = null;
  let reversed = null;
  try {
    const conn = await getConnection(env);
    if (!conn?.refresh_token) throw new Error('QuickBooks not connected');
    reversed = await reversePaymentInQbo(env, db, pay, {
      full,
      note: isAchReturn
        ? `Bank returned this ACH payment (${dispute.reason}) — reduce the QuickBooks payment manually`
        : `Disputed $${withheld.toFixed(2)} — reduce the QuickBooks payment manually`,
    });
  } catch (e) {
    qbo_error = e.message;
    await db.update('payments', `id=eq.${pay.id}`, {
      qbo_sync_error: String(e.message).slice(0, 500),
    }).catch(() => {});
  }
  return {
    payment_id: pay.id,
    ach_return: isAchReturn,
    reason: dispute.reason || null,
    withheld,
    reversed,
    qbo_error,
  };
}

// public: Stripe cannot present a Supabase session; the configured webhook
// signature authenticates the exact raw body before any local or provider work.
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!stripeConfigured(env) || !env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Stripe not configured' }, 503, request, env);
  }

  // The raw body is required for signature verification — read it before parsing.
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature');
  let event;
  try {
    event = await constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return jsonResponse({
      error: 'Stripe webhook signature or payload is invalid.',
      code: 'stripe_webhook_invalid',
    }, 400, request, env);
  }

  const db = supabase(env, fetchWithTimeout);

  // The containment gate. While this is off the worker behaves exactly as the
  // 2026-08-11 stub did — a stable retryable refusal — except that reading the
  // flag is itself one Supabase call. Nothing is claimed and no business read,
  // write or provider call happens before this passes.
  if (!(await requireStripePaymentCommandV1(db))) {
    return stripeProjectionUnavailableResponse(request, env);
  }

  const startedAt = new Date().toISOString();

  // Event-level idempotency: claim once; a duplicate delivery no-ops.
  let claimed = true;
  try {
    claimed = await db.rpc('claim_stripe_event', { p_id: event.id, p_type: event.type });
  } catch {
    // If the ledger call fails, fall through — the charge-unique index and the
    // command ledger both still guard against doing the work twice.
  }
  if (claimed === false) return jsonResponse({ duplicate: true }, 200, request, env);

  const finalize = async (status, payload, error) => {
    await db.update('stripe_events', `id=eq.${event.id}`, {
      status,
      error: error ? String(error).slice(0, 500) : null,
      payload: payload || null,
      processed_at: new Date().toISOString(),
    }).catch(() => {});
  };

  try {
    let result;
    switch (event.type) {
      case 'payment_intent.processing':
        result = await handleAchProcessing(env, db, event.data.object, event.id);
        break;
      case 'payment_intent.succeeded':
        result = await handlePaymentIntent(env, db, event.data.object, event.id);
        break;
      case 'payout.paid':
        result = await handlePayout(env, db, event.data.object, event.id);
        break;
      case 'charge.refunded':
        result = await handleRefund(env, db, event.data.object);
        break;
      case 'charge.dispute.created':
        result = await handleDispute(env, db, event.data.object);
        break;
      default:
        // e.g. charge.succeeded — handled via payment_intent.succeeded.
        await finalize('skipped', { reason: 'unhandled type' });
        return jsonResponse({ ok: true, ignored: event.type }, 200, request, env);
    }

    const err = result.qbo_error || result.error || null;
    await finalize(result.skipped ? 'skipped' : 'processed', result, err);
    await logRun(db, 'completed', result.skipped ? 0 : 1, err, startedAt);
    return jsonResponse({ ok: true, ...result }, 200, request, env);
  } catch (e) {
    await finalize('error', null, e.message);
    await logRun(db, 'error', 0, e.message, startedAt);
    // 200 so Stripe does not retry into the duplicate guard; the error is
    // recorded on the event row for support.
    return jsonResponse({ ok: false, error: e.message }, 200, request, env);
  }
}
