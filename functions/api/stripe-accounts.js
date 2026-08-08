// GET /api/stripe-accounts — list the Stripe account's external accounts (bank accounts
// + debit cards) for the payout-destination selectors in Payment Settings. Selecting one
// only stores its id; ADDING a new bank/card happens in Stripe's hosted Dashboard /
// Financial Connections (never raw entry in UPR — PCI/compliance).
//
// Doubles as the "is Stripe connected?" probe: on success it flips stripe_connected=true.
//
// Auth: requireRole(PAYOUT_MANAGE_ROLES) — the same admin-only predicate the Payment
//       Settings page enforces (src/lib/claimUtils canManagePayouts). Dormant-safe:
//       503 until keys exist.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, listExternalAccounts } from '../lib/stripe.js';
import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';

// This endpoint reads the company's payout destinations (bank accounts + debit cards) —
// payout-management surface, NOT general billing. Mirrors functions/api/stripe-payout.js:
// the one UI caller (/settings/payments) self-guards on canManagePayouts (admin only) and
// the server enforces the same list. Do not widen to BILLING_EDIT_ROLES — billing editors
// record customer payments; they do not manage where company money pays out.
const PAYOUT_MANAGE_ROLES = ['admin'];

// The inline isAuthorized() this replaces only proved the Bearer token resolved at
// /auth/v1/user — any employee session passed (AGENTS.md §16: a valid session is
// authentication, not authorization). requireRole matches the employee by auth_user_id
// and refuses an inactive employee; the is_external check mirrors stripe-payout.js.
// Deliberate divergence from stripe-payout's helper: any status other than 401/403
// (auth misconfiguration, employee-lookup failure) is genericized — internal server
// state is not for callers.
async function requirePayoutRole(request, env, db) {
  const auth = await requireRole(request, env, db, PAYOUT_MANAGE_ROLES, fetchWithTimeout);
  if (auth.error) {
    const error = auth.status === 403 ? 'Forbidden — payout role required'
      : auth.status === 401 ? auth.error
      : 'Authorization check failed';
    return { error, status: auth.status };
  }
  if (auth.employee.is_external) {
    return { error: 'Forbidden — payout role required', status: 403 };
  }
  return { ok: true };
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // Authorize BEFORE the dormant-safe probe — an unauthenticated caller learns nothing,
  // not even whether Stripe is configured. The one legitimate caller (Payment Settings)
  // always probes with an admin session, so it still sees the 503 while keys are absent.
  const db = supabase(env);
  const gate = await requirePayoutRole(request, env, db);
  if (gate.error) return jsonResponse({ error: gate.error }, gate.status, request, env);
  if (!stripeConfigured(env)) return jsonResponse({ connected: false, error: 'Stripe not configured' }, 503, request, env);

  try {
    const { accountId, banks, cards } = await listExternalAccounts(env);
    await db.upsert('integration_config', { key: 'stripe_connected', value: 'true', updated_at: new Date().toISOString() });
    return jsonResponse({ connected: true, account_id: accountId, banks, cards }, 200, request, env);
  } catch (e) {
    return jsonResponse({ connected: false, error: e.message, request_id: e.requestId || null }, 500, request, env);
  }
}
