// POST /api/stripe-payout — same-day deposit (Stripe Instant Payout) to the configured
// debit card. Exposed as the "Pay out now" button in Payment Settings.
//
// Auth: Supabase Bearer, enforced server-side to admin/manager (BILLING_ROLES) —
// the UI hides this button, but that is not a security boundary. Dormant-safe: 503 until keys exist.
// Body (optional): { "amount": <dollars> } — defaults to the full instant-available balance.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { requireRole, BILLING_ROLES } from '../lib/auth.js';
import { stripeConfigured, getInstantAvailable, createPayout } from '../lib/stripe.js';

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

  const db = supabase(env);
  try {
    const cfg = (await db.select('integration_config', `key=eq.stripe_instant_card_id&select=value&limit=1`))?.[0];
    const destination = cfg?.value || null;

    let amountCents = body.amount != null ? Math.round(Number(body.amount) * 100) : await getInstantAvailable(env);
    if (!(amountCents > 0)) return jsonResponse({ error: 'No instant balance available to pay out' }, 400, request, env);

    const payout = await createPayout(env, { amountCents, destination, method: 'instant', idempotencyKey: `payout_${Date.now()}` });
    return jsonResponse({ ok: true, payout_id: payout.id, amount: amountCents / 100, status: payout.status, arrival_date: payout.arrival_date }, 200, request, env);
  } catch (e) {
    return jsonResponse({ error: e.message, request_id: e.requestId || null }, 500, request, env);
  }
}
