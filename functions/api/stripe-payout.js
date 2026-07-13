// POST /api/stripe-payout — same-day deposit (Stripe Instant Payout) to the configured
// debit card. Exposed as the "Pay out now" button in Payment Settings.
//
// Auth: Supabase Bearer (UI gates to admins/managers). Dormant-safe: 503 until keys exist.
// Body (optional): { "amount": <dollars> } — defaults to the full instant-available balance.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, getInstantAvailable, createPayout } from '../lib/stripe.js';

// Instant payout moves real money OUT to a debit card — gate it to the same
// roles the UI requires for billing edits (src/lib/claimUtils BILLING_EDIT_ROLES).
// Verifying the token server-side is not enough: any employee session would pass.
// F-B consolidates this into functions/lib/auth.js (requireRole).
const BILLING_EDIT_ROLES = ['admin', 'manager'];

async function requireBillingRole(request, env, db) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  const user = await userRes.json().catch(() => null);
  const email = user?.email;
  if (!email) return { error: 'Invalid token', status: 401 };
  const [emp] = await db.select('employees', `email=eq.${encodeURIComponent(email)}&select=role&limit=1`);
  if (!emp || !BILLING_EDIT_ROLES.includes(emp.role)) {
    return { error: 'Forbidden — billing role required', status: 403 };
  }
  return { ok: true };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!stripeConfigured(env)) return jsonResponse({ error: 'Stripe not configured' }, 503, request, env);

  const db = supabase(env);
  const gate = await requireBillingRole(request, env, db);
  if (gate.error) return jsonResponse({ error: gate.error }, gate.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  // Idempotency: the client sends a stable UUID per payout action, so a retry or
  // double-click of the SAME action dedups at Stripe; two intentional payouts get
  // two UUIDs (allowed). Fall back to the old per-request key only if absent.
  const idempotencyKey = (typeof body.idempotency_key === 'string' && body.idempotency_key.trim())
    || `payout_${Date.now()}`;

  try {
    const cfg = (await db.select('integration_config', `key=eq.stripe_instant_card_id&select=value&limit=1`))?.[0];
    const destination = cfg?.value || null;

    let amountCents = body.amount != null ? Math.round(Number(body.amount) * 100) : await getInstantAvailable(env);
    if (!(amountCents > 0)) return jsonResponse({ error: 'No instant balance available to pay out' }, 400, request, env);

    const payout = await createPayout(env, { amountCents, destination, method: 'instant', idempotencyKey });
    return jsonResponse({ ok: true, payout_id: payout.id, amount: amountCents / 100, status: payout.status, arrival_date: payout.arrival_date }, 200, request, env);
  } catch (e) {
    return jsonResponse({ error: e.message, request_id: e.requestId || null }, 500, request, env);
  }
}
