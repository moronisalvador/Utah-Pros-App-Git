// Stripe helper for Cloudflare Workers. No SDK — pure fetch() + Web Crypto, works in
// V8 isolates. Mirrors functions/lib/quickbooks.js.
//
// Secrets are env vars (Cloudflare Pages): STRIPE_SECRET_KEY (sk_...),
// STRIPE_PUBLISHABLE_KEY (pk_...), STRIPE_WEBHOOK_SECRET (whsec_...). Everything in
// this file no-ops/throws cleanly when the secret key is absent, so the rest of the
// app can ship before Stripe is configured.

import { resolveCredential } from './credentials.js';

const API_BASE = 'https://api.stripe.com/v1';
const STRIPE_VERSION = '2024-06-20';

// Cheap synchronous pre-flight used by the worker route guards. Env-only by design
// (it must not do an async DB read); the actual secret used for a call is resolved
// DB-first in stripeFetch(). During the P9 cutover the env var stays as a backup,
// so this gate keeps working; see functions/lib/credentials.js.
export function stripeConfigured(env) {
  return !!(env && env.STRIPE_SECRET_KEY);
}

// Flatten nested objects/arrays into Stripe's bracket form-encoding, e.g.
// { line_items: [{ price_data: { currency: 'usd' } }] }
//   -> line_items[0][price_data][currency]=usd
function toForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
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

// Core request. GET uses querystring; POST uses form-encoding. Throws a descriptive
// Error (with .stripeCode / .status) on non-2xx, capturing Stripe's request-id for support.
export async function stripeFetch(env, path, { method = 'GET', params, idempotencyKey } = {}) {
  const { secretKey } = await resolveCredential(env, null, 'stripe'); // DB-first, env fallback
  if (!secretKey) throw new Error('Stripe not configured');
  let url = `${API_BASE}${path}`;
  const headers = {
    'Authorization': `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_VERSION,
  };
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
    const err = data?.error;
    const e = new Error(err ? `${err.message || err.type || 'Stripe error'}` : `Stripe ${path} ${res.status}`);
    e.stripeCode = err?.code || err?.type || null;
    e.status = res.status;
    e.requestId = reqId;
    throw e;
  }
  return data;
}

// ── Webhook signature verification (Web Crypto HMAC-SHA256) ─────────────────────
// Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>...]". Signed payload = `${t}.${rawBody}`.
// Verifies against the raw request body and returns the parsed event. Tolerance guards
// replay (default 5 min). Throws on any mismatch.
export async function constructEvent(rawBody, sigHeader, secret, toleranceSec = 300) {
  if (!secret) throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  if (!sigHeader) throw new Error('Missing Stripe-Signature header');

  let t = null;
  const v1s = [];
  for (const part of sigHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (k === 't') t = val;
    else if (k === 'v1') v1s.push(val);
  }
  if (!t || v1s.length === 0) throw new Error('Malformed Stripe-Signature header');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');

  if (!v1s.some(v => timingSafeEqual(v, expected))) throw new Error('Signature verification failed');

  if (toleranceSec > 0) {
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
    if (Number.isFinite(age) && age > toleranceSec) throw new Error('Timestamp outside tolerance');
  }
  return JSON.parse(rawBody);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Reads ───────────────────────────────────────────────────────────────────────
export function getBalanceTransaction(env, id) {
  return stripeFetch(env, `/balance_transactions/${id}`);
}
export function retrieveCharge(env, id) {
  // expand balance_transaction so we get amount/fee/net in one round-trip
  return stripeFetch(env, `/charges/${id}`, { params: { 'expand[0]': 'balance_transaction' } });
}
export function retrievePaymentIntent(env, id) {
  return stripeFetch(env, `/payment_intents/${id}`, { params: { 'expand[0]': 'latest_charge.balance_transaction' } });
}
export function getAccount(env) {
  return stripeFetch(env, '/account');
}
export function getBalance(env) {
  return stripeFetch(env, '/balance');
}

// instant_available total in cents for the given currency (default usd).
export async function getInstantAvailable(env, currency = 'usd') {
  const bal = await getBalance(env);
  const row = (bal.instant_available || []).find(b => b.currency === currency);
  return row ? Number(row.amount) : 0;
}

// External accounts (bank accounts + debit cards) of *your* account — the payout
// destination choices. Adding a new one happens in the Stripe Dashboard / Financial
// Connections, never via raw entry in UPR.
export async function listExternalAccounts(env) {
  const acct = await getAccount(env);
  const accountId = acct?.id;
  if (!accountId) throw new Error('Could not resolve Stripe account id');
  const [banks, cards] = await Promise.all([
    stripeFetch(env, `/accounts/${accountId}/external_accounts`, { params: { object: 'bank_account', limit: 100 } }),
    stripeFetch(env, `/accounts/${accountId}/external_accounts`, { params: { object: 'card', limit: 100 } }),
  ]);
  const mapBank = (b) => ({ id: b.id, object: 'bank_account', label: `${b.bank_name || 'Bank'} ••${b.last4}`, currency: b.currency, default_for_currency: !!b.default_for_currency, instant: (b.available_payout_methods || []).includes('instant') });
  const mapCard = (c) => ({ id: c.id, object: 'card', label: `${c.brand || 'Card'} ••${c.last4}`, currency: c.currency, default_for_currency: !!c.default_for_currency, instant: (c.available_payout_methods || []).includes('instant') });
  return {
    accountId,
    banks: (banks.data || []).map(mapBank),
    cards: (cards.data || []).map(mapCard),
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────────
// Hosted Checkout session (mode=payment) for an invoice balance. metadata.invoice_id
// is set on BOTH the session and the resulting PaymentIntent/Charge so the webhook can
// resolve the invoice from the charge alone.
export function createCheckoutSession(env, { amountCents, invoiceId, invoiceNumber, customerEmail, successUrl, cancelUrl }) {
  const params = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: `Invoice ${invoiceNumber || ''}`.trim() },
      },
    }],
    metadata: { invoice_id: invoiceId, upr: 'invoice' },
    payment_intent_data: { metadata: { invoice_id: invoiceId, upr: 'invoice' } },
  };
  if (customerEmail) params.customer_email = customerEmail;
  return stripeFetch(env, '/checkout/sessions', { method: 'POST', params, idempotencyKey: `cs_${invoiceId}_${amountCents}` });
}

// Instant payout to a chosen external account (debit card or eligible bank).
export function createPayout(env, { amountCents, destination, method = 'instant', idempotencyKey }) {
  const params = { amount: amountCents, currency: 'usd', method };
  if (destination) params.destination = destination;
  return stripeFetch(env, '/payouts', { method: 'POST', params, idempotencyKey });
}
