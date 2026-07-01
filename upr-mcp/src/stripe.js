/**
 * ════════════════════════════════════════════════
 * FILE: stripe.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the assistant read and (carefully) drive UPR's Stripe account from a
 *   Claude chat — check the balance, look up a card charge a customer made, list
 *   payouts to the bank, or create a pay-now link / instant payout. Stripe is how
 *   UPR takes card payments on invoices and moves that money to the bank. The
 *   secret key never touches the browser; this reuses the SAME key the app uses.
 *
 * WHERE IT LIVES:
 *   API layer for the MCP worker (not a routed page). Imported by src/tools.js.
 *
 * DEPENDS ON:
 *   Packages:      none (pure fetch + form-encoding)
 *   Internal:      none
 *   External API:  Stripe REST API (api.stripe.com/v1)
 *   Config:        STRIPE_SECRET_KEY (worker secret — set with `wrangler secret put`)
 *
 * NOTES / GOTCHAS:
 *   - Ported from functions/lib/stripe.js: same API version, same bracket
 *     form-encoding (toForm), same descriptive errors (carries Stripe's
 *     request-id). No SDK — works in the V8 isolate.
 *   - Returns a clean "not configured" error until STRIPE_SECRET_KEY is set, so
 *     the tool is dormant-safe (mirrors resend.js / encircle.js).
 *   - Money-moving calls (payouts, payment links) are guarded [WRITE] tools in
 *     tools.js — they preview unless confirm:true.
 * ════════════════════════════════════════════════
 */

const API_BASE = 'https://api.stripe.com/v1';
const STRIPE_VERSION = '2024-06-20';

function requireKey(env) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured for the MCP worker — add it as a secret (wrangler secret put STRIPE_SECRET_KEY).');
  }
}

// Flatten nested objects/arrays into Stripe's bracket form-encoding, e.g.
// { line_items: [{ price_data: { currency: 'usd' } }] }
//   -> line_items[0][price_data][currency]=usd. Ported from functions/lib/stripe.js.
function toForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') toForm(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (v !== null && typeof v === 'object') {
      toForm(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

// Core request. GET → querystring; POST → form-encoding. Throws with Stripe's
// message + request-id on non-2xx. Ported from functions/lib/stripe.js.
export async function stripeFetch(env, path, { method = 'GET', params, idempotencyKey } = {}) {
  requireKey(env);
  let url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Stripe-Version': STRIPE_VERSION };
  const init = { method, headers };
  if (method === 'GET') {
    if (params) url += '?' + toForm(params).toString();
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    init.body = params ? toForm(params).toString() : '';
  }
  const res = await fetch(url, init);
  const reqId = res.headers.get('request-id') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data && data.error;
    const e = new Error(err ? `${err.message || err.type || 'Stripe error'}${reqId ? ` [${reqId}]` : ''}` : `Stripe ${path} ${res.status}`);
    e.stripeCode = (err && (err.code || err.type)) || null;
    e.status = res.status;
    throw e;
  }
  return data;
}

// ─── Generic power tools (reach any endpoint) ────────────────────────────────────
export function stripeGet(env, path, params) {
  return stripeFetch(env, path, { method: 'GET', params });
}
export function stripeRequest(env, method, path, params) {
  return stripeFetch(env, path, { method: String(method || 'POST').toUpperCase(), params });
}

// ─── Reads ─────────────────────────────────────────────────────────────────────
export function getBalance(env) {
  return stripeFetch(env, '/balance');
}
export function listCharges(env, { limit = 20, customer } = {}) {
  const params = { limit: Math.min(Number(limit) || 20, 100) };
  if (customer) params.customer = customer;
  return stripeFetch(env, '/charges', { params });
}
export function retrieveCharge(env, id) {
  return stripeFetch(env, `/charges/${encodeURIComponent(String(id))}`, { params: { 'expand[0]': 'balance_transaction' } });
}
export function listPayouts(env, { limit = 20 } = {}) {
  return stripeFetch(env, '/payouts', { params: { limit: Math.min(Number(limit) || 20, 100) } });
}

// External accounts (bank + debit-card payout destinations) of the account.
export async function listExternalAccounts(env) {
  const acct = await stripeFetch(env, '/account');
  const accountId = acct && acct.id;
  if (!accountId) throw new Error('Could not resolve the Stripe account id.');
  const [banks, cards] = await Promise.all([
    stripeFetch(env, `/accounts/${accountId}/external_accounts`, { params: { object: 'bank_account', limit: 100 } }),
    stripeFetch(env, `/accounts/${accountId}/external_accounts`, { params: { object: 'card', limit: 100 } }),
  ]);
  const mapBank = (b) => ({ id: b.id, object: 'bank_account', label: `${b.bank_name || 'Bank'} ••${b.last4}`, currency: b.currency, default_for_currency: !!b.default_for_currency, instant: (b.available_payout_methods || []).includes('instant') });
  const mapCard = (c) => ({ id: c.id, object: 'card', label: `${c.brand || 'Card'} ••${c.last4}`, currency: c.currency, default_for_currency: !!c.default_for_currency, instant: (c.available_payout_methods || []).includes('instant') });
  return { accountId, banks: (banks.data || []).map(mapBank), cards: (cards.data || []).map(mapCard) };
}

// ─── Writes ──────────────────────────────────────────────────────────────────────
// Payout to a chosen external account (default instant). Amount in cents.
export function createPayout(env, { amountCents, destination, method = 'instant', idempotencyKey }) {
  const params = { amount: amountCents, currency: 'usd', method };
  if (destination) params.destination = destination;
  return stripeFetch(env, '/payouts', { method: 'POST', params, idempotencyKey });
}

// Hosted Checkout pay-now link for an amount (cents). Returns the session (url).
export function createPaymentLink(env, { amountCents, description, customerEmail, successUrl, cancelUrl }) {
  const params = {
    mode: 'payment',
    success_url: successUrl || 'https://utahpros.app/',
    cancel_url: cancelUrl || 'https://utahpros.app/',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: description || 'Payment' } } }],
  };
  if (customerEmail) params.customer_email = customerEmail;
  return stripeFetch(env, '/checkout/sessions', { method: 'POST', params });
}
