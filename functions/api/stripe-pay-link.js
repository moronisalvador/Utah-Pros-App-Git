// POST /api/stripe-pay-link — create (or return) a Stripe Checkout pay-link for an
// invoice's outstanding balance, so the client can pay by card/ACH. The link/session
// is stored on the invoice; payment is captured by /api/stripe-webhook.
//
// Auth: Supabase Bearer, enforced server-side to admin/manager (BILLING_ROLES).
// Dormant-safe: returns 503 until STRIPE_SECRET_KEY is set in Cloudflare.
//
// Body: { "invoice_id": "<uuid>" }

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireRole, BILLING_ROLES } from '../lib/auth.js';
import { stripeConfigured, createCheckoutSession } from '../lib/stripe.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!stripeConfigured(env)) return jsonResponse({ error: 'Stripe not configured' }, 503, request, env);
  const auth = await requireRole(request, env, BILLING_ROLES);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  if (!body.invoice_id) return jsonResponse({ error: 'Provide invoice_id' }, 400, request, env);

  const db = supabase(env);
  try {
    const inv = (await db.select('invoices', `id=eq.${body.invoice_id}&select=id,invoice_number,qbo_doc_number,total,adjusted_total,amount_paid,job_id,contact_id&limit=1`))?.[0];
    if (!inv) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);

    const total = Number(inv.adjusted_total ?? inv.total ?? 0);
    const balance = Math.round((total - Number(inv.amount_paid || 0)) * 100); // cents
    if (!(balance > 0)) return jsonResponse({ error: 'Invoice has no outstanding balance' }, 400, request, env);

    // Client email (for the Checkout prefill) — invoice contact, else job's primary contact.
    let contactId = inv.contact_id;
    if (!contactId && inv.job_id) {
      const job = (await db.select('jobs', `id=eq.${inv.job_id}&select=primary_contact_id&limit=1`))?.[0];
      contactId = job?.primary_contact_id || null;
    }
    const contact = contactId ? (await db.select('contacts', `id=eq.${contactId}&select=email&limit=1`))?.[0] : null;

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
    // First successful key use flips the "connected" flag (activates the settings UI).
    await db.upsert('integration_config', { key: 'stripe_connected', value: 'true', updated_at: new Date().toISOString() });

    return jsonResponse({ ok: true, url: session.url, session_id: session.id }, 200, request, env);
  } catch (e) {
    return jsonResponse({ error: e.message, request_id: e.requestId || null }, 500, request, env);
  }
}
