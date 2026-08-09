// POST /api/stripe-payout — same-day deposit (Stripe Instant Payout) to the configured
// debit card. Exposed as the "Pay out now" button in Payment Settings.
//
// Auth: Supabase Bearer (UI gates to admins). Dormant-safe: 503 until keys exist.
// Body (optional): { "amount": <dollars> } — defaults to the full instant-available balance.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, getInstantAvailable, createPayout } from '../lib/stripe.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';

// Instant payout moves real money OUT to a debit card — gate it to the payout-management
// roles the UI requires (src/lib/claimUtils PAYOUT_MANAGE_ROLES), NOT to BILLING_EDIT_ROLES.
// Those diverged 2026-08-04 (owner-directed): billing editing widened to office +
// project_manager so office staff can record customer payments, while moving money OUT
// stayed admin-only. Do not re-point this at BILLING_EDIT_ROLES — that would hand the
// instant-payout button to every billing editor.
// Verifying the token server-side is not enough: any employee session would pass.
// F-B consolidates this into functions/lib/auth.js (requireRole).
const PAYOUT_MANAGE_ROLES = ['admin'];

// Delegates to functions/lib/auth.js (workers-standard.md §1: "A local auth definition is
// a review failure once the lib exists"). The hand-rolled version this replaces matched the
// employee by EMAIL and selected only `role`, so it never saw is_active or is_external — a
// deactivated or external admin holding a still-valid session token could trigger a real
// Instant Payout. requireEmployee matches on auth_user_id and rejects an inactive employee;
// the is_external check below mirrors authorizeQboBrowserRequest.
async function requirePayoutRole(request, env, db) {
  const auth = await requireRole(request, env, db, PAYOUT_MANAGE_ROLES, fetchWithTimeout);
  if (auth.error) {
    return { error: auth.status === 403 ? 'Forbidden — payout role required' : auth.error, status: auth.status };
  }
  if (auth.employee.is_external) {
    return { error: 'Forbidden — payout role required', status: 403 };
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
  const gate = await requirePayoutRole(request, env, db);
  if (gate.error) return jsonResponse({ error: gate.error }, gate.status, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }

  // Idempotency: the client sends a stable UUID per payout action, so a retry or
  // double-click of the SAME action dedups at Stripe; two intentional payouts get
  // two UUIDs (allowed).
  //
  // There is deliberately NO fallback. This previously substituted a timestamp-derived
  // key, which is the exact anti-pattern AGENTS.md §15 and workers-standard.md §3 name: a
  // per-attempt value is unique on every retry, so it defeats Stripe's dedup and a
  // duplicate submit moves real money twice. Failing closed is correct — the one live
  // caller (src/pages/settings/Payments.jsx) always sends a crypto.randomUUID().
  // (The banned literal is deliberately not spelled here: the contract test greps this
  // file as text, so quoting it would defeat the guard.)
  const idempotencyKey = typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
    ? body.idempotency_key.trim()
    : null;
  if (!idempotencyKey) {
    return jsonResponse({ error: 'idempotency_key is required' }, 400, request, env);
  }

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
