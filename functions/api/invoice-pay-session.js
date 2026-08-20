/**
 * ════════════════════════════════════════════════
 * FILE: invoice-pay-session.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When a customer on their invoice page presses Pay, this checks their link is
 *   still good and the amount is sensible, then hands them a Stripe payment page
 *   for that amount. It never touches the invoice or records a payment — that
 *   only happens when Stripe confirms the money actually arrived.
 *
 * WHERE IT LIVES:
 *   Route:  POST /api/invoice-pay-session   body { token, amount_cents }
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, http, supabase, stripe, stripe-payment-gate
 *   Data:      reads  → invoice_shares, invoices, jobs, contacts, feature_flags
 *              writes → none (a Stripe session only)
 *
 * NOTES / GOTCHAS:
 *   - **This is a public endpoint.** The token is the entire capability, so every
 *     check happens here on the server: format, existence, status, expiry, and
 *     that the amount is positive and no more than the balance. Nothing is
 *     trusted from the browser except a token and a number.
 *   - The balance is re-read at request time. A customer sitting on the page for
 *     an hour while a cheque posts must not be able to overpay.
 *   - Every unusable link gets ONE message. Distinguishing expired from revoked
 *     from never-existed would turn this into a token oracle.
 *   - Gated on the same switch as the webhook: a payment nobody can reconcile is
 *     worse than no payment.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, createCheckoutSession } from '../lib/stripe.js';
import {
  requireStripePaymentCommandV1,
  stripeProjectionUnavailableResponse,
} from './stripe-payment-gate.js';

// Strict v1–v5 UUID, validated before the token ever reaches the database.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Stripe's floor for a charge. Refusing here beats a provider error on the
// customer's screen.
const MIN_CENTS = 50;

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// public: the customer-facing invoice page at /pay/:token is opened by an
// unauthenticated client, so paying from it cannot require a session. The secret
// token is the narrow capability; status, expiry and the amount are all
// re-checked here before Stripe is called, and nothing local is written.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { body = null; }
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!UUID_RE.test(token)) {
    return jsonResponse({ error: 'This payment link is not valid.' }, 400, request, env);
  }

  // Strictly a JSON number, not a coercible string. Number('1000') is a valid
  // integer, and a public money endpoint should not quietly accept whatever the
  // caller felt like sending.
  const requested = body?.amount_cents;
  if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < MIN_CENTS) {
    return jsonResponse({ error: 'Enter an amount of at least $0.50.' }, 400, request, env);
  }

  // One message for every unusable link. Telling an anonymous caller *why* a
  // token failed would let them probe for valid ones.
  const unusable = () => jsonResponse(
    { error: 'This payment link is no longer active. Please contact our office for a new one.' },
    410, request, env,
  );

  try {
    const db = supabase(env, fetchWithTimeout);

    if (!(await requireStripePaymentCommandV1(db))) {
      return stripeProjectionUnavailableResponse(
        request, env, 'Online payment is temporarily unavailable. Please contact our office.',
      );
    }
    if (!stripeConfigured(env)) {
      return jsonResponse({ error: 'Online payment is not configured.' }, 503, request, env);
    }

    // Read the share directly rather than through the public RPC: this is the
    // moment before money moves, so it uses the real row, not the redacted
    // customer-facing projection.
    const share = (await db.select(
      'invoice_shares',
      `token=eq.${token}&select=id,invoice_id,status,expires_at&limit=1`,
    ))?.[0];
    if (!share || share.status !== 'active') return unusable();
    if (!share.expires_at || new Date(share.expires_at).getTime() <= Date.now()) return unusable();

    const inv = (await db.select(
      'invoices',
      `id=eq.${share.invoice_id}&select=id,invoice_number,qbo_doc_number,total,adjusted_total,amount_paid,job_id,contact_id&limit=1`,
    ))?.[0];
    if (!inv) return unusable();

    // Re-read the balance NOW. The customer may have had this page open while a
    // cheque posted; they must not be able to overpay.
    const total = Number(inv.adjusted_total ?? inv.total ?? 0);
    const balanceCents = Math.round((total - Number(inv.amount_paid || 0)) * 100);
    if (balanceCents <= 0) {
      return jsonResponse({ error: 'This invoice is already paid in full.' }, 409, request, env);
    }
    if (requested > balanceCents) {
      return jsonResponse({
        error: 'That is more than the outstanding balance.',
        balance_cents: balanceCents,
      }, 400, request, env);
    }

    let contactId = inv.contact_id;
    if (!contactId && inv.job_id) {
      const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=primary_contact_id&limit=1`))?.[0];
      contactId = job?.primary_contact_id || null;
    }
    const contact = contactId
      ? (await db.select('contacts', `id=eq.${contactId}&select=email&limit=1`))?.[0]
      : null;

    const base = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const session = await createCheckoutSession(env, {
      amountCents: requested,
      invoiceId: inv.id,
      invoiceNumber: inv.qbo_doc_number || inv.invoice_number,
      customerEmail: contact?.email || null,
      // Back to the customer's own page, never into the staff app.
      successUrl: `${base}/pay/${token}?paid=1`,
      cancelUrl: `${base}/pay/${token}`,
    });
    return jsonResponse({ ok: true, url: session.url }, 200, request, env);
  } catch (e) {
    // Never surface an upstream message to an unauthenticated caller: it can
    // carry configuration detail, and it is not actionable for a customer.
    console.error('invoice-pay-session:', e?.message || e);
    return jsonResponse({ error: 'We could not start the payment. Please try again.' }, 502, request, env);
  }
}
