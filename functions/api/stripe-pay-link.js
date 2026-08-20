/**
 * ════════════════════════════════════════════════
 * FILE: stripe-pay-link.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Creates a Stripe payment page for one invoice's outstanding balance and
 *   returns its link, so staff can send a customer somewhere to pay by card or
 *   bank transfer.
 *
 * WHERE IT LIVES:
 *   Route:  POST /api/stripe-pay-link   body { invoice_id }
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  cors, auth, http, supabase, stripe, stripe-payment-gate
 *   Data:      reads  → invoices, jobs, contacts, feature_flags
 *              writes → invoices (link columns), integration_config
 *
 * NOTES / GOTCHAS:
 *   - This is the STAFF path: an employee creates a link and sends it. The
 *     customer-facing page that lets someone pay a self-chosen amount is a
 *     separate, token-gated surface and does not go through this worker.
 *   - The amount is the balance at the moment the link is minted. If a payment
 *     lands afterwards the link can overcharge, so links are short-lived by
 *     convention and the balance is re-read on every mint.
 *   - Gated on feature:stripe_payment_command_v1 — the same switch as the
 *     webhook. A link nobody can reconcile is worse than no link, so the two
 *     open together or not at all.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, createCheckoutSession } from '../lib/stripe.js';
import {
  requireStripePaymentCommandV1,
  stripeProjectionUnavailableResponse,
  STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED,
} from './stripe-payment-gate.js';

// Re-exported for compatibility with the containment-era import site.
export { STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED };

// The billing-edit list, mirroring src/lib/claimUtils.js BILLING_EDIT_ROLES and
// functions/lib/qbo-auth.js QBO_BROWSER_ROLES. It read ['admin', 'manager'] until
// 2026-08-19: 'manager' is not an employee_role, so the gate was admin-only by
// accident while office and project_manager could already do every other part of
// invoicing. Pinned by tests/qa/unit/billing-role-surface-parity.test.js.
const BILLING_ROLES = ['admin', 'office', 'project_manager'];

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env, fetchWithTimeout);

  // Authorization first: an unauthenticated or wrong-role caller learns nothing
  // about whether the feature exists, let alone about the invoice.
  const auth = await requireRole(request, env, db, BILLING_ROLES, fetchWithTimeout);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env); }
  if (!body || typeof body.invoice_id !== 'string' || !body.invoice_id.trim()) {
    return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);
  }

  if (!(await requireStripePaymentCommandV1(db))) {
    return stripeProjectionUnavailableResponse(
      request, env,
      'Stripe payment links are unavailable until their durable projection boundary is enabled',
    );
  }
  if (!stripeConfigured(env)) {
    return jsonResponse({ error: 'Stripe not configured' }, 503, request, env);
  }

  try {
    const inv = (await db.select(
      'invoices',
      `id=eq.${body.invoice_id}&select=id,invoice_number,qbo_doc_number,total,adjusted_total,amount_paid,job_id,contact_id&limit=1`,
    ))?.[0];
    if (!inv) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);

    // Read the balance now rather than trusting anything the caller sent.
    const total = Number(inv.adjusted_total ?? inv.total ?? 0);
    const balance = Math.round((total - Number(inv.amount_paid || 0)) * 100);
    if (!(balance > 0)) {
      return jsonResponse({ error: 'Invoice has no outstanding balance' }, 400, request, env);
    }

    // Prefill the Checkout email: invoice contact, else the job's primary contact.
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
      amountCents: balance,
      invoiceId: inv.id,
      invoiceNumber: inv.qbo_doc_number || inv.invoice_number,
      customerEmail: contact?.email || null,
      successUrl: `${base}/invoices/${inv.id}?paid=1`,
      cancelUrl: `${base}/invoices/${inv.id}?canceled=1`,
    });

    await db.update('invoices', `id=eq.${inv.id}`, {
      stripe_payment_link_url: session.url,
      stripe_checkout_session_id: session.id,
      stripe_payment_link_created_at: new Date().toISOString(),
    });
    // First successful key use flips the "connected" flag, which activates the
    // live selectors on the Payment Settings page.
    await db.upsert('integration_config', {
      key: 'stripe_connected', value: 'true', updated_at: new Date().toISOString(),
    });

    return jsonResponse({ ok: true, url: session.url, session_id: session.id }, 200, request, env);
  } catch (e) {
    // Never leak the upstream body; the Stripe request id is enough for support.
    return jsonResponse({ error: e.message, request_id: e.requestId || null }, 500, request, env);
  }
}
