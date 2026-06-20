// GET /api/stripe-accounts — list the Stripe account's external accounts (bank accounts
// + debit cards) for the payout-destination selectors in Payment Settings. Selecting one
// only stores its id; ADDING a new bank/card happens in Stripe's hosted Dashboard /
// Financial Connections (never raw entry in UPR — PCI/compliance).
//
// Doubles as the "is Stripe connected?" probe: on success it flips stripe_connected=true.
//
// Auth: Supabase Bearer (UI gates to admins/managers). Dormant-safe: 503 until keys exist.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { stripeConfigured, listExternalAccounts } from '../lib/stripe.js';

async function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!stripeConfigured(env)) return jsonResponse({ connected: false, error: 'Stripe not configured' }, 503, request, env);
  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

  const db = supabase(env);
  try {
    const { accountId, banks, cards } = await listExternalAccounts(env);
    await db.upsert('integration_config', { key: 'stripe_connected', value: 'true', updated_at: new Date().toISOString() });
    return jsonResponse({ connected: true, account_id: accountId, banks, cards }, 200, request, env);
  } catch (e) {
    return jsonResponse({ connected: false, error: e.message, request_id: e.requestId || null }, 500, request, env);
  }
}
