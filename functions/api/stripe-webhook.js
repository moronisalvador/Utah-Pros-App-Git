// POST /api/stripe-webhook — Stripe's payment-confirmation webhook (the ONLY inbound).
//
// Implements the clearing-account fee-automation pattern (UPR is the only writer to QBO):
//   payment_intent.succeeded → record a UPR payment (source 'stripe') for the GROSS,
//     push it to QBO deposited to the "Stripe Clearing" bank account, then book the exact
//     Stripe fee as a Purchase (clearing → Merchant Fees). Clearing now holds the net.
//   payout.paid → post a Transfer (clearing → real QBO bank) for the net, so the
//     clearing account self-zeroes and the bank reconciles to the Stripe payout.
//
// Idempotency: every event id is claimed once (claim_stripe_event); duplicates no-op.
// Charge-level dedup is enforced by payments.payments_stripe_charge_uniq.
//
// Auth: Stripe signature (STRIPE_WEBHOOK_SECRET). Dormant-safe: 503 until keys exist.

import { jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, constructEvent, retrieveCharge } from '../lib/stripe.js';
import { getConnection, createPayment, createPurchase, createTransfer } from '../lib/quickbooks.js';

const ymd = (unixSec) => new Date((unixSec ? unixSec * 1000 : Date.now())).toISOString().slice(0, 10);

async function getConfig(db, keys) {
  const rows = await db.select('integration_config', `key=in.(${keys.join(',')})&select=key,value`).catch(() => []);
  const m = {}; (rows || []).forEach(r => { m[r.key] = r.value; });
  return m;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: 'stripe-webhook', status, records_processed: processed,
      error_message: errorMessage || null, started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  if (!stripeConfigured(env) || !env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Stripe not configured' }, 503, request, env);
  }

  // Raw body is required for signature verification — read it before parsing.
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature');
  let event;
  try {
    event = await constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return jsonResponse({ error: `Webhook signature: ${e.message}` }, 400, request, env);
  }

  const db = supabase(env);

  // Event-level idempotency: claim once; a duplicate delivery no-ops.
  let claimed = true;
  try { claimed = await db.rpc('claim_stripe_event', { p_id: event.id, p_type: event.type }); }
  catch { /* if the ledger call fails, fall through and try to process (charge-unique index still guards) */ }
  if (claimed === false) return jsonResponse({ duplicate: true }, 200, request, env);

  const finalize = async (status, payload, error) => {
    try {
      await db.update('stripe_events', `id=eq.${event.id}`, {
        status, error: error ? String(error).slice(0, 500) : null,
        payload: payload || null, processed_at: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
  };

  try {
    if (event.type === 'payment_intent.succeeded') {
      const result = await handlePaymentIntent(env, db, event.data.object);
      await finalize(result.skipped ? 'skipped' : 'processed', result, result.qbo_error || null);
      await logRun(db, 'completed', result.skipped ? 0 : 1, result.qbo_error || null, startedAt);
      return jsonResponse({ ok: true, ...result }, 200, request, env);
    }

    if (event.type === 'payout.paid') {
      const result = await handlePayout(env, db, event.data.object);
      await finalize(result.skipped ? 'skipped' : 'processed', result, result.error || null);
      await logRun(db, 'completed', result.skipped ? 0 : 1, result.error || null, startedAt);
      return jsonResponse({ ok: true, ...result }, 200, request, env);
    }

    // Not a type we act on (e.g. charge.succeeded — handled via payment_intent.succeeded).
    await finalize('skipped', { reason: 'unhandled type' });
    return jsonResponse({ ok: true, ignored: event.type }, 200, request, env);
  } catch (e) {
    await finalize('error', null, e.message);
    await logRun(db, 'error', 0, e.message, startedAt);
    // 200 so Stripe doesn't retry into the duplicate guard; the error is recorded for support.
    return jsonResponse({ ok: false, error: e.message }, 200, request, env);
  }
}

// payment_intent.succeeded → UPR payment (gross) + QBO payment (to clearing) + fee purchase.
async function handlePaymentIntent(env, db, pi) {
  const invoiceId = pi?.metadata?.invoice_id;
  if (!invoiceId) return { skipped: true, reason: 'no invoice_id in metadata' };

  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  if (!chargeId) return { skipped: true, reason: 'no charge on payment_intent' };

  // Exact gross/fee/net from the charge's balance_transaction.
  const charge = await retrieveCharge(env, chargeId);
  const bt = charge.balance_transaction; // expanded object
  const grossCents = Number(bt?.amount ?? charge.amount ?? 0);
  const feeCents = Number(bt?.fee ?? 0);
  const gross = grossCents / 100;
  const fee = feeCents / 100;
  const txnDate = ymd(charge.created);
  const method = charge.payment_method_details?.type === 'us_bank_account' ? 'eft' : 'credit_card';

  const inv = (await db.select('invoices', `id=eq.${invoiceId}&select=id,invoice_number,job_id,contact_id,qbo_invoice_id&limit=1`))?.[0];
  if (!inv) return { skipped: true, reason: 'invoice not found', invoice_id: invoiceId };

  let contactId = inv.contact_id;
  if (!contactId && inv.job_id) {
    const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=primary_contact_id&limit=1`))?.[0];
    contactId = job?.primary_contact_id || null;
  }

  // Charge-level idempotency: reuse the existing UPR payment if this charge was seen.
  let pay = (await db.select('payments', `stripe_charge_id=eq.${chargeId}&select=*&limit=1`))?.[0];
  if (!pay) {
    const inserted = await db.insert('payments', {
      invoice_id: inv.id, job_id: inv.job_id || null, contact_id: contactId || null,
      amount: gross, payment_date: txnDate, payer_type: 'homeowner', payment_method: method,
      reference_number: chargeId, source: 'stripe',
      stripe_payment_intent_id: pi.id, stripe_charge_id: chargeId, stripe_fee: fee,
    });
    pay = Array.isArray(inserted) ? inserted[0] : inserted;
  }

  // ── Push to QBO (deposit to clearing) + book the fee ──
  let qbo_error = null, qbo_payment_id = pay.qbo_payment_id || null, qbo_fee_purchase_id = pay.stripe_fee_qbo_purchase_id || null;
  try {
    const conn = await getConnection(env);
    if (!conn?.refresh_token) throw new Error('QuickBooks not connected');
    if (!inv.qbo_invoice_id) throw new Error('Invoice not in QuickBooks yet — sync the invoice, then re-push this payment');

    const cfg = await getConfig(db, ['qbo_stripe_clearing_account_id', 'qbo_fee_expense_account_id']);
    const clearingId = cfg.qbo_stripe_clearing_account_id || null;

    const contact = contactId ? (await db.select('contacts', `id=eq.${contactId}&select=qbo_customer_id&limit=1`))?.[0] : null;
    if (!contact?.qbo_customer_id) throw new Error('Customer has no QuickBooks record — sync the client first');

    if (!qbo_payment_id) {
      const qboPay = await createPayment(env, {
        customerId: contact.qbo_customer_id, qboInvoiceId: inv.qbo_invoice_id,
        amount: gross, txnDate, privateNote: `UPR Stripe ${pi.id} · ${inv.invoice_number || ''}`,
        depositAccountId: clearingId,
      });
      qbo_payment_id = String(qboPay.Id);
      await db.update('payments', `id=eq.${pay.id}`, { qbo_payment_id, qbo_synced_at: new Date().toISOString(), qbo_sync_error: null });
    }

    // Book the processing fee (clearing → Merchant Fees) once.
    if (fee > 0 && !qbo_fee_purchase_id && clearingId && cfg.qbo_fee_expense_account_id) {
      const purchase = await createPurchase(env, {
        paidFromAccountId: clearingId, expenseAccountId: cfg.qbo_fee_expense_account_id,
        amount: fee, txnDate, privateNote: `Stripe fee · ${pi.id} · ${inv.invoice_number || ''}`,
      });
      qbo_fee_purchase_id = String(purchase.Id);
      await db.update('payments', `id=eq.${pay.id}`, { stripe_fee_qbo_purchase_id: qbo_fee_purchase_id });
    }
  } catch (e) {
    qbo_error = e.message;
    await db.update('payments', `id=eq.${pay.id}`, { qbo_sync_error: String(e.message).slice(0, 500) }).catch(() => {});
  }

  return { payment_id: pay.id, invoice_id: inv.id, gross, fee, qbo_payment_id, qbo_fee_purchase_id, qbo_error };
}

// payout.paid → Transfer the net (clearing → real QBO bank), zeroing the clearing batch.
async function handlePayout(env, db, payout) {
  const net = Number(payout.amount || 0) / 100;
  if (!(net > 0)) return { skipped: true, reason: 'non-positive payout' };

  const conn = await getConnection(env);
  if (!conn?.refresh_token) return { skipped: true, reason: 'QuickBooks not connected' };

  const cfg = await getConfig(db, ['qbo_stripe_clearing_account_id', 'qbo_bank_account_id']);
  if (!cfg.qbo_stripe_clearing_account_id || !cfg.qbo_bank_account_id) {
    return { skipped: true, reason: 'clearing/bank account not mapped in Payment Settings' };
  }

  const transfer = await createTransfer(env, {
    fromAccountId: cfg.qbo_stripe_clearing_account_id,
    toAccountId: cfg.qbo_bank_account_id,
    amount: net,
    txnDate: ymd(payout.arrival_date || payout.created),
    privateNote: `Stripe payout ${payout.id}`,
  });
  return { payout_id: payout.id, net, qbo_transfer_id: String(transfer.Id) };
}
