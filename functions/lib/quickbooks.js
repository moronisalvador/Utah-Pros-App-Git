/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Connects UPR's protected server tasks to QuickBooks Online. It refreshes
 *   the private connection when needed and provides the shared customer,
 *   invoice, estimate, payment, attachment, and card-payment operations.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  supabase, http
 *   Data:      reads/writes → integration_credentials and QuickBooks Online
 *
 * NOTES / GOTCHAS:
 *   - This module is server-only; browser code must never receive OAuth credentials.
 *   - Accounting creates that can be retried accept stable provider request IDs.
 *   - Multi-invoice payment amounts stay as integer cents until the JSON payload.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';
import { fetchWithTimeout } from './http.js';

const PROVIDER      = 'quickbooks';
const TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
// Accounting (invoices/payments) + Payments (card charging via the Payments API). Adding
// the payment scope requires the owner to RECONNECT QuickBooks once to re-consent.
const SCOPE         = 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment';
const MINOR_VERSION = '70';

// ── Environment helpers ────────────────────────────────────────────────────────
export function qboEnvironment(env) {
  return (env.QBO_ENVIRONMENT || 'production').toLowerCase() === 'sandbox'
    ? 'sandbox'
    : 'production';
}

export function apiBase(environment) {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

function basicAuth(env) {
  return 'Basic ' + btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`);
}

// ── OAuth ──────────────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(env, state) {
  const params = new URLSearchParams({
    client_id:     env.QBO_CLIENT_ID,
    response_type: 'code',
    scope:         SCOPE,
    redirect_uri:  env.QBO_REDIRECT_URI,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(env, params) {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuth(env),
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || '';
    throw new Error(`QBO token endpoint ${res.status}${tid ? ` [intuit_tid ${tid}]` : ''}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

export function exchangeCodeForTokens(env, code) {
  return postToken(env, {
    grant_type:   'authorization_code',
    code,
    redirect_uri: env.QBO_REDIRECT_URI,
  });
}

export function refreshTokens(env, refreshToken) {
  return postToken(env, {
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
}

// ── Connection persistence ──────────────────────────────────────────────────────
export async function getConnection(env) {
  const db = supabase(env, fetchWithTimeout);
  const rows = await db.select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

export async function saveTokens(env, tokens, extra = {}) {
  const db = supabase(env, fetchWithTimeout);
  const now = Date.now();
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
  const row = {
    provider:         PROVIDER,
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token,
    token_expires_at: new Date(now + ttlMs).toISOString(),
    updated_at:       new Date(now).toISOString(),
    // Persist the granted scopes so the app can tell whether card charging (the payment
    // scope) is authorized, and prompt a reconnect when it isn't. Intuit returns `scope`
    // on both the initial exchange and refreshes; omit when absent so we don't clobber it.
    ...(tokens.scope ? { granted_scopes: tokens.scope } : {}),
    ...extra,
  };
  await db.upsert('integration_credentials', row);
  return row;
}

// Returns a valid access token, refreshing first if it expires within 5 minutes.
export async function getValidAccessToken(env) {
  let conn = await getConnection(env);
  if (!conn || !conn.refresh_token) throw new Error('QuickBooks not connected');

  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (Date.now() > expMs - 5 * 60 * 1000) {
    const tokens = await refreshTokens(env, conn.refresh_token);
    conn = await saveTokens(env, tokens, {
      realm_id:    conn.realm_id,
      environment: conn.environment,
    });
  }
  return {
    accessToken: conn.access_token,
    realmId:     conn.realm_id,
    environment: conn.environment || qboEnvironment(env),
  };
}

// ── QuickBooks API ───────────────────────────────────────────────────────────────
const ACCOUNTING_REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,50}$/;

// Intuit's Accounting API deduplicates write/modify/delete requests by the
// `requestid` URI parameter (not the Payments API's Request-Id header). Keep the
// validation here so a malformed or oversized key fails before provider access.
export function withAccountingRequestId(path, requestId) {
  if (requestId == null || requestId === '') return path;
  const key = String(requestId);
  if (!ACCOUNTING_REQUEST_ID_RE.test(key)) {
    throw new Error('QBO accounting request id must be 1-50 safe characters');
  }
  return `${path}${path.includes('?') ? '&' : '?'}requestid=${encodeURIComponent(key)}`;
}

export async function qboFetch(env, path, options = {}) {
  const { accessToken, realmId, environment } = await getValidAccessToken(env);
  const { requestId, ...fetchOptions } = options;
  const url = `${apiBase(environment)}/v3/company/${realmId}${withAccountingRequestId(path, requestId)}`;
  return fetchWithTimeout(url, {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
}

// ── QuickBooks PAYMENTS API (card processing) ────────────────────────────────────
// Separate product from the Accounting API above: DIFFERENT host, /quickbooks/v4/payments
// base, same OAuth bearer (needs the com.intuit.quickbooks.payment scope). Used for keyed
// card charges (card-not-present). The raw card number is tokenized client-side; only the
// opaque token reaches here.
export function paymentsApiBase(environment) {
  return environment === 'sandbox'
    ? 'https://sandbox.api.intuit.com'
    : 'https://api.intuit.com';
}

export async function paymentsFetch(env, path, options = {}) {
  const { accessToken, environment } = await getValidAccessToken(env);
  const url = `${paymentsApiBase(environment)}/quickbooks/v4/payments${path}`;
  const { requestId, headers, ...rest } = options;
  return fetchWithTimeout(url, {
    ...rest,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      'Request-Id':    requestId || crypto.randomUUID(), // Intuit idempotency key
      ...(headers || {}),
    },
  });
}

// Charge a tokenized card. `token` is the opaque value-token minted client-side by Intuit's
// tokenizer (the PAN never touches our servers). Returns the Charge ({ id, status, authCode }).
// Throws with `e.declined = true` on a card decline so callers can message it cleanly.
export async function createCharge(env, { amount, token, currency = 'USD', requestId } = {}) {
  const res = await paymentsFetch(env, '/charges', {
    method: 'POST',
    requestId,
    body: JSON.stringify({
      amount: Number(amount).toFixed(2),
      currency,
      token,
      capture: true,
      context: { isEcommerce: true },
    }),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  const apiErr = data?.errors?.[0];
  if (!res.ok || apiErr) {
    const e = new Error(apiErr ? `${apiErr.code || ''} ${apiErr.message || apiErr.detail || ''}`.trim() : `QBO charge failed (${res.status})`);
    e.status = res.status; e.intuitTid = tid;
    e.declined = res.status === 402 || /declin/i.test(JSON.stringify(data));
    throw e;
  }
  return data;
}

export async function fetchCompanyName(env) {
  try {
    const { realmId } = await getValidAccessToken(env);
    const res = await qboFetch(env, `/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.CompanyInfo?.CompanyName || null;
  } catch {
    return null;
  }
}

// ── Customer mapping + create ────────────────────────────────────────────────────
// Maps a UPR contacts row → a QuickBooks Customer payload.
export function mapContactToCustomer(contact) {
  const name = normalizeWhitespace(contact.name);
  const parts = name ? name.split(/\s+/) : [];
  const cust = {
    DisplayName: name || contact.company || `UPR contact ${String(contact.id).slice(0, 8)}`,
  };
  if (parts.length > 1) {
    cust.GivenName  = parts.slice(0, -1).join(' ');
    cust.FamilyName = parts[parts.length - 1];
  } else if (name) {
    cust.GivenName = name;
  }
  if (contact.company) cust.CompanyName     = contact.company;
  if (contact.email)   cust.PrimaryEmailAddr = { Address: contact.email };
  if (contact.phone)   cust.PrimaryPhone     = { FreeFormNumber: contact.phone };

  const addr = {};
  if (contact.billing_address) addr.Line1                  = contact.billing_address;
  if (contact.billing_city)    addr.City                   = contact.billing_city;
  if (contact.billing_state)   addr.CountrySubDivisionCode = contact.billing_state;
  if (contact.billing_zip)     addr.PostalCode             = contact.billing_zip;
  if (Object.keys(addr).length) cust.BillAddr = addr;

  return cust;
}

// Looks up an existing customer by exact DisplayName (dedup before create).
// Collapses repeated whitespace and trims — normalizes names before matching.
export function normalizeWhitespace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function escQ(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Runs a Customer query, returns all matches ([] means QBO answered "none").
// FAILS CLOSED: a non-OK response or unparseable body THROWS — it must never
// read as "no match", because callers decide create-vs-link on this result and
// a swallowed transient failure would silently mint a duplicate customer
// (worker-security-reviewer finding, 2026-07-29).
export async function queryCustomers(env, whereClause, max = 10) {
  const q = `SELECT Id, DisplayName, GivenName, FamilyName, PrimaryEmailAddr, PrimaryPhone FROM Customer WHERE ${whereClause} MAXRESULTS ${max}`;
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const tid = res.headers.get('intuit_tid') || null;
  if (!res.ok) {
    const e = new Error(`QBO customer query failed (${res.status}) — cannot decide link-vs-create, try again`);
    e.status = res.status;
    e.intuitTid = tid;
    throw e;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    const e = new Error('QBO customer query returned an unreadable body — cannot decide link-vs-create, try again');
    e.intuitTid = tid;
    throw e;
  }
  return data?.QueryResponse?.Customer || [];
}

// Runs a Customer query, returns the first match (or null on no match / error).
export async function queryCustomer(env, whereClause) {
  return (await queryCustomers(env, whereClause, 1))[0] || null;
}

// Last-10-digits phone normalization — QBO stores free-form numbers, so phone
// equality is compared on digits, never on formatting.
export function normalizePhoneDigits(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function disambiguatedCustomerPayload(contact, payload) {
  const last4 = String(contact?.phone || '').replace(/\D/g, '').slice(-4);
  const suffix = last4 || String(contact?.id || '').slice(0, 4) || 'UPR';
  return {
    ...payload,
    DisplayName: `${payload.DisplayName} (${suffix})`,
  };
}

// Both display-name conventions seen in the realm. These variants are useful
// for diagnostics and manual review, but a name by itself is not identity proof
// and is never enough for an automatic money-path link.
export function displayNameVariants(name) {
  const n = normalizeWhitespace(name);
  if (!n) return [];
  const variants = [n];
  const parts = n.split(' ');
  if (parts.length > 1 && !n.includes(',')) {
    variants.push(`${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`);
  }
  return variants;
}

// Dedup lookup before creating — every signal we hold, strongest first:
//   1. exact email;
//   2. same family name + same phone digits (candidate scan).
// DisplayName-only matches are deliberately excluded: similar or identical
// names are not sufficient evidence to attach an invoice to an existing QBO
// customer. QBO duplicate-name handling creates a disambiguated customer
// instead, which is safer than silently posting to the wrong account.
// Returns { customer, matchedBy } on ONE confident match, null when QBO
// answered "none" for every signal, and { ambiguous: true, candidates } when
// distinct customers both look right — a money path never guesses between two
// people. A FAILED query throws (see queryCustomers) — never reads as "none".
// `deps` is test injection only; production callers pass nothing.
export async function findExistingCustomer(env, contact, payload, deps = {}) {
  const many = deps.queryCustomers || queryCustomers;

  const email = (contact.email || '').trim();
  if (email) {
    const byEmail = await many(env, `PrimaryEmailAddr = '${escQ(email)}'`);
    if (byEmail.length === 1) return { customer: byEmail[0], matchedBy: 'email' };
    if (byEmail.length > 1) return { ambiguous: true, candidates: byEmail };
  }

  const phone = normalizePhoneDigits(contact.phone);
  const family = normalizeWhitespace(contact.name).split(' ').pop();
  if (phone.length === 10 && family) {
    const candidates = await many(env, `FamilyName = '${escQ(family)}'`);
    const byPhone = candidates.filter(
      (c) => normalizePhoneDigits(c?.PrimaryPhone?.FreeFormNumber) === phone,
    );
    if (byPhone.length === 1) return { customer: byPhone[0], matchedBy: 'phone' };
    if (byPhone.length > 1) return { ambiguous: true, candidates: byPhone };
  }
  return null;
}

// True when QBO rejected a transaction because its CustomerRef points at a
// customer that no longer exists in the realm (deleted/merged duplicate, or a
// cross-realm id) — e.g. "Invalid Reference Id : Names element id 583 not found".
export function isStaleCustomerRef(err) {
  const msg = String(err?.message || '');
  return /invalid reference id/i.test(msg) && /names element/i.test(msg);
}

// Repair a contact whose stored qbo_customer_id no longer resolves: re-match
// against QBO on verified identity (email or family-name + phone), or create the
// customer if it genuinely is not there, then write the mapping back. Refuses
// to guess between multiple plausible customers. Returns { id, matchedBy }.
export async function relinkQboCustomer(env, db, contactId) {
  const contact = (await db.select('contacts', `id=eq.${contactId}&limit=1`))?.[0];
  if (!contact) throw new Error('Contact not found for QuickBooks relink');
  const payload = mapContactToCustomer(contact);

  const match = await findExistingCustomer(env, contact, payload);
  if (match?.ambiguous) {
    const list = match.candidates.map((c) => `${c.DisplayName} (#${c.Id})`).join(', ');
    throw new Error(
      `Multiple QuickBooks customers could match ${contact.name}: ${list} — open the contact and link the right one manually.`,
    );
  }

  let customer = match?.customer || null;
  let matchedBy = match?.matchedBy || 'created';
  if (!customer) {
    try {
      customer = await createCustomer(env, payload);
    } catch (e) {
      // 6240 = duplicate DisplayName. A name alone is not identity proof, so
      // create a disambiguated customer instead of adopting the existing name.
      if (e.qboCode === '6240' || /duplicate/i.test(e.message || '')) {
        customer = await createCustomer(env, disambiguatedCustomerPayload(contact, payload));
        matchedBy = 'created';
      }
      if (!customer) throw e;
    }
  }

  await db.update('contacts', `id=eq.${contactId}`, {
    qbo_customer_id: String(customer.Id),
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_error: null,
  });
  console.log('QBO customer relinked', JSON.stringify({ contact_id: contactId, qbo_customer_id: customer.Id, matched_by: matchedBy }));
  return { id: String(customer.Id), matchedBy };
}

export async function createCustomer(env, payload) {
  const res = await qboFetch(env, `/customer?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO create customer ${res.status}`);
    e.qboCode = fault?.code;
    e.status  = res.status;
    e.intuitTid = tid;
    throw e;
  }
  console.log('QBO customer created', JSON.stringify({ id: data.Customer?.Id, intuit_tid: tid }));
  return data.Customer;
}

// On-demand: ensure a billable contact exists as a QuickBooks customer, at the
// moment it's actually invoiced/estimated rather than when it was first added.
// Reuses the qbo-sync-customer worker (the same create/dedup/write-back logic
// the contact-insert trigger has always used) via the deployment's own origin,
// authenticated with the shared webhook secret. Best-effort — the caller
// re-reads qbo_customer_id and raises its own clear error if it's still missing.
export async function ensureQboCustomer(request, env, contactId) {
  if (!contactId) return false;
  try {
    const url = new URL('/api/qbo-sync-customer', request.url);
    const res = await fetchWithTimeout(url.toString(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': env.QBO_WEBHOOK_SECRET || '' },
      body:    JSON.stringify({ contact_id: contactId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Invoices (Phase 2) ───────────────────────────────────────────────────────
// UPR division → QBO line mapping (Item Id + Class name). Item Ids are stable in
// QBO; Class Id is resolved at runtime by name. Class only for mit/recon for now.
export function divisionToQbo(division) {
  const d = (division || '').toLowerCase();
  if (d.includes('recon'))                                  return { itemId: '1010000201', itemName: 'Reconstruction/ Remodeling Services', className: 'Reconstruction' };
  if (d.includes('remodel'))                                return { itemId: '1010000201', itemName: 'Reconstruction/ Remodeling Services', className: 'Reconstruction' };
  if (d.includes('mold'))                                   return { itemId: '1010000131', itemName: 'Mold Remediation Services',           className: null };
  if (d.includes('content'))                                return { itemId: '38',         itemName: 'Contents',                            className: null };
  if (d.includes('mit') || d.includes('water') || d.includes('dry'))
                                                            return { itemId: '1010000071', itemName: 'Water Damage Mitigation And Drying',  className: 'Mitigation' };
  return null;
}

export const QBO_INSURANCE_ADJUSTMENT_ITEM_ID = '1010000231'; // Discounts:Insurance Adjustments

export async function findClassId(env, name) {
  const safe = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id FROM Class WHERE Name = '${safe}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) return null;
  const d = await res.json().catch(() => ({}));
  return d?.QueryResponse?.Class?.[0]?.Id || null;
}

export async function createInvoice(env, payload, { requestId } = {}) {
  const res = await qboFetch(env, `/invoice?minorversion=${MINOR_VERSION}`, {
    method: 'POST', requestId, body: JSON.stringify(payload),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO create invoice ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data.Invoice;
}

// Delete a QBO invoice (used for test cleanup). Looks up SyncToken first.
export async function deleteInvoice(env, qboInvoiceId, { requestId, missingIsSuccess = false } = {}) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Invoice WHERE Id = '${qboInvoiceId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qTid = q.headers.get('intuit_tid') || null;
  if (!q.ok) {
    const e = new Error(`QBO invoice query before delete failed (${q.status}) — cannot decide whether it is missing`);
    e.status = q.status;
    e.intuitTid = qTid;
    throw e;
  }
  let qd;
  try {
    qd = await q.json();
  } catch {
    const e = new Error('QBO invoice query before delete returned an unreadable body — cannot decide whether it is missing');
    e.intuitTid = qTid;
    throw e;
  }
  const queryResponse = qd?.QueryResponse;
  if (!queryResponse || typeof queryResponse !== 'object' || Array.isArray(queryResponse)) {
    const e = new Error('QBO invoice query before delete returned an unrecognized body — cannot decide whether it is missing');
    e.intuitTid = qTid;
    throw e;
  }
  const invoices = queryResponse.Invoice;
  if (!Object.hasOwn(queryResponse, 'Invoice') || (Array.isArray(invoices) && invoices.length === 0)) {
    if (missingIsSuccess) return { deleted: false, missing: true };
    throw new Error('Invoice not found in QBO for delete');
  }
  if (!Array.isArray(invoices) || invoices.length !== 1 || invoices[0]?.SyncToken == null) {
    const e = new Error('QBO invoice query before delete returned an unrecognized invoice result');
    e.intuitTid = qTid;
    throw e;
  }
  const syncToken = invoices[0].SyncToken;
  const res = await qboFetch(env, `/invoice?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST', requestId, body: JSON.stringify({ Id: String(qboInvoiceId), SyncToken: syncToken }),
  });
  if (!res.ok) throw new Error(`QBO delete invoice ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { deleted: true, missing: false };
}

// Sparse-update an existing QBO invoice (used by auto-push when the UPR invoice is
// edited after it was first pushed). Looks up the current SyncToken, then sends a
// sparse update — `fields` typically { Line: [...], PrivateNote }. Sparse semantics
// preserve everything we don't send (CustomerRef, etc.); a provided Line array
// replaces the line set, which is how the amount changes.
export async function updateInvoice(env, qboInvoiceId, fields, { requestId } = {}) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Invoice WHERE Id = '${qboInvoiceId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const existing = qd?.QueryResponse?.Invoice?.[0];
  if (existing?.SyncToken == null) throw new Error('Invoice not found in QBO for update');
  const res = await qboFetch(env, `/invoice?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    requestId,
    body: JSON.stringify({ Id: String(qboInvoiceId), SyncToken: existing.SyncToken, sparse: true, ...fields }),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO update invoice ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data.Invoice;
}

// Ask QuickBooks to EMAIL the invoice to the customer (QBO sends the email, with a
// pay-now link if QBO Payments is on). `sendTo` overrides the recipient; if omitted,
// QBO uses the customer's billing email (BillEmail / PrimaryEmailAddr) on the invoice.
// QBO's send endpoint wants an empty octet-stream body; the response echoes the invoice
// with EmailStatus = 'EmailSent'.
export async function sendInvoice(env, qboInvoiceId, sendTo, { requestId } = {}) {
  const path = `/invoice/${qboInvoiceId}/send?minorversion=${MINOR_VERSION}`
    + (sendTo ? `&sendTo=${encodeURIComponent(sendTo)}` : '');
  const res = await qboFetch(env, path, {
    method: 'POST',
    requestId,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO send invoice ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data.Invoice;
}

// ── Attachments (Attachable API) ──────────────────────────────────────────────
// Attach a file to a QBO Invoice or Estimate. With IncludeOnSend=true the file
// rides along on the email QuickBooks sends the customer AND shows on the txn in
// QuickBooks. Uses the accounting API host (apiBase) + the same OAuth bearer as
// qboFetch, but the "upload" endpoint is multipart/form-data with two named parts:
//   file_metadata_01 (application/json) — the Attachable + its AttachableRef link
//   file_content_01  (the file's MIME)  — the raw bytes

// Pure builder (exported for tests): the Attachable metadata JSON that links a file
// to exactly one transaction, optionally included when QBO emails that transaction.
export function buildAttachableMetadata({ entityType, qboEntityId, fileName, contentType, includeOnSend = true } = {}) {
  const type = entityType === 'estimate' ? 'Estimate' : 'Invoice';
  return {
    FileName: fileName,
    ...(contentType ? { ContentType: contentType } : {}),
    AttachableRef: [{
      EntityRef: { type, value: String(qboEntityId) },
      IncludeOnSend: !!includeOnSend,
    }],
  };
}

// Upload `bytes` and link it to the invoice/estimate. Returns the created Attachable
// ({ Id, FileName, ... }). Throws with e.intuitTid on any QBO fault.
export async function uploadAttachable(env, { entityType, qboEntityId, bytes, fileName, contentType, includeOnSend = true } = {}) {
  const { accessToken, realmId, environment } = await getValidAccessToken(env);
  const metadata = buildAttachableMetadata({ entityType, qboEntityId, fileName, contentType, includeOnSend });

  // FormData sets the multipart boundary itself — do NOT set Content-Type here.
  const form = new FormData();
  form.append('file_metadata_01', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
  form.append('file_content_01', new Blob([bytes], { type: contentType || 'application/octet-stream' }), fileName);

  // Multi-MB upload → a longer explicit timeout than the 15s default (workers-standard.md §2).
  const res = await fetchWithTimeout(`${apiBase(environment)}/v3/company/${realmId}/upload?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body: form,
  }, 30000);
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  // The upload endpoint returns a per-file response array; a file-level Fault can
  // ride on a 200, so check both the top-level and per-entry Fault.
  const entry = data?.AttachableResponse?.[0];
  const fault = entry?.Fault?.Error?.[0] || data?.Fault?.Error?.[0];
  if (!res.ok || fault || !entry?.Attachable?.Id) {
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO attach failed (${res.status})`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return entry.Attachable;
}

export async function getAttachable(env, attachableId) {
  const res = await qboFetch(env, `/attachable/${attachableId}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.Attachable || null;
}

// Remove an attachment from QuickBooks (needs the current SyncToken → GET first).
// A missing attachable is treated as already-gone, not an error.
export async function deleteAttachable(env, attachableId) {
  const existing = await getAttachable(env, attachableId);
  if (!existing) return { deleted: false, missing: true };
  const res = await qboFetch(env, `/attachable?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    body: JSON.stringify({ Id: String(existing.Id), SyncToken: String(existing.SyncToken ?? '0') }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const fault = data?.Fault?.Error?.[0];
    throw new Error(fault ? `${fault.Message}` : `QBO attachable delete ${res.status}`);
  }
  return { deleted: true };
}

// ── Estimates (Phase 2 — mirrors Invoices) ────────────────────────────────────
// QBO Estimates use the same line shape as Invoices (SalesItemLineDetail + ItemRef
// + ClassRef). An Estimate can later be linked to an Invoice via the Invoice's
// LinkedTxn ([{ TxnId: <estimateId>, TxnType: 'Estimate' }]) — that's how QBO marks
// an estimate "converted" and rolls it into the invoice. (Handled in qbo-invoice.)
export async function createEstimate(env, payload) {
  const res = await qboFetch(env, `/estimate?minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify(payload),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO create estimate ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data.Estimate;
}

// Sparse-update an existing QBO estimate (auto-push when the UPR estimate is edited
// after first push). Looks up the current SyncToken, then sends a sparse update — a
// provided Line array replaces the line set (how the amount changes).
export async function updateEstimate(env, qboEstimateId, fields) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Estimate WHERE Id = '${qboEstimateId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const existing = qd?.QueryResponse?.Estimate?.[0];
  if (existing?.SyncToken == null) throw new Error('Estimate not found in QBO for update');
  const res = await qboFetch(env, `/estimate?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
    body: JSON.stringify({ Id: String(qboEstimateId), SyncToken: existing.SyncToken, sparse: true, ...fields }),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO update estimate ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data.Estimate;
}

// Delete a QBO estimate (revert-to-draft cleanup). Looks up SyncToken first.
export async function deleteEstimate(env, qboEstimateId) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Estimate WHERE Id = '${qboEstimateId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const syncToken = qd?.QueryResponse?.Estimate?.[0]?.SyncToken;
  if (syncToken == null) throw new Error('Estimate not found in QBO for delete');
  const res = await qboFetch(env, `/estimate?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify({ Id: String(qboEstimateId), SyncToken: syncToken }),
  });
  if (!res.ok) throw new Error(`QBO delete estimate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// Ask QuickBooks to EMAIL the estimate to the customer (QBO sends the email). `sendTo`
// overrides the recipient; if omitted QBO uses the customer's billing email. QBO's send
// endpoint wants an empty octet-stream body; the response echoes the estimate.
export async function sendEstimate(env, qboEstimateId, sendTo) {
  const path = `/estimate/${qboEstimateId}/send?minorversion=${MINOR_VERSION}`
    + (sendTo ? `&sendTo=${encodeURIComponent(sendTo)}` : '');
  const res = await qboFetch(env, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO send estimate ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data.Estimate;
}

// Look up a QBO estimate's id + SyncToken (used by qbo-invoice to mark an estimate
// Closed/accepted after the converted invoice is created). Returns null if not found.
export async function getEstimateRef(env, qboEstimateId) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Estimate WHERE Id = '${qboEstimateId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const row = qd?.QueryResponse?.Estimate?.[0];
  return row?.SyncToken != null ? { id: String(row.Id), syncToken: String(row.SyncToken) } : null;
}

// ── Payments (one-way UPR → QBO) ─────────────────────────────────────────────
// Create a QBO Payment applied to an invoice. UPR records the payment first; this
// mirrors it into QBO so the QBO invoice shows paid/partial. `txnDate` = 'YYYY-MM-DD'.
// `depositAccountId` (optional) sets DepositToAccountRef — used for Stripe payments so
// the gross deposits into the "Stripe Clearing" bank account (fee + payout reconcile
// against it). Omitted for hand-entered payments → QBO uses its default (Undeposited Funds).
export async function createAllocatedPayment(env, {
  customerId, allocations, txnDate, privateNote, depositAccountId, paymentMethodId, paymentRefNum, requestId,
} = {}) {
  if (!customerId) throw new Error('QBO customer is required');
  if (!Array.isArray(allocations) || !allocations.length) throw new Error('At least one QBO invoice allocation is required');
  if (allocations.length > 100) throw new Error('No more than 100 QBO invoice allocations are allowed');
  const invoiceIds = new Set();
  const lines = allocations.map(({ qboInvoiceId, amountCents }) => {
    if (!qboInvoiceId || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error('Each QBO allocation requires an invoice and positive integer cents');
    }
    const invoiceId = String(qboInvoiceId);
    if (invoiceIds.has(invoiceId)) throw new Error('A QBO invoice may only appear once in a payment');
    invoiceIds.add(invoiceId);
    return {
      Amount: amountCents / 100,
      LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }],
    };
  });
  const totalCents = allocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('QBO payment total is too large');
  if (requestId && String(requestId).length > 50) throw new Error('QBO request ID exceeds 50 characters');
  if (paymentRefNum && String(paymentRefNum).length > 100) throw new Error('QBO payment reference is too long');
  const payload = {
    CustomerRef: { value: String(customerId) },
    TotalAmt: totalCents / 100,
    ...(txnDate ? { TxnDate: txnDate } : {}),
    ...(privateNote ? { PrivateNote: privateNote } : {}),
    ...(depositAccountId ? { DepositToAccountRef: { value: String(depositAccountId) } } : {}),
    ...(paymentMethodId ? { PaymentMethodRef: { value: String(paymentMethodId) } } : {}),
    ...(paymentRefNum ? { PaymentRefNum: String(paymentRefNum) } : {}),
    Line: lines,
  };
  const requestQuery = requestId ? `&requestid=${encodeURIComponent(String(requestId))}` : '';
  const res = await qboFetch(env, `/payment?minorversion=${MINOR_VERSION}${requestQuery}`, {
    method: 'POST', body: JSON.stringify(payload),
  });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO create payment ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  if (!data?.Payment?.Id) throw new Error('QBO create payment returned no Payment');
  return data.Payment;
}

// Backwards-compatible single-invoice facade retained for the existing payment and Stripe paths.
export async function createPayment(env, {
  customerId, qboInvoiceId, amount, txnDate, privateNote, depositAccountId, requestId,
}) {
  const amountCents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || Math.abs(Number(amount) * 100 - amountCents) > 1e-7) {
    throw new Error('Payment amount must be a positive whole number of cents');
  }
  return createAllocatedPayment(env, {
    customerId,
    allocations: [{ qboInvoiceId, amountCents }],
    txnDate,
    privateNote,
    depositAccountId,
    requestId,
  });
}

export async function getQboInvoice(env, qboInvoiceId) {
  const res = await qboFetch(env, `/invoice/${encodeURIComponent(String(qboInvoiceId))}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.Invoice) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault?.Message || `QBO get invoice ${res.status}`);
    e.status = res.status; e.qboCode = fault?.code; e.intuitTid = res.headers.get('intuit_tid') || null;
    throw e;
  }
  return data.Invoice;
}

export async function getQboPayment(env, qboPaymentId) {
  const res = await qboFetch(env, `/payment/${encodeURIComponent(String(qboPaymentId))}?minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.Payment) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault?.Message || `QBO get payment ${res.status}`);
    e.status = res.status; e.qboCode = fault?.code; e.intuitTid = res.headers.get('intuit_tid') || null;
    throw e;
  }
  return data.Payment;
}

export async function listQboPaymentMethods(env) {
  const q = 'SELECT Id, Name, Active FROM PaymentMethod WHERE Active = true MAXRESULTS 1000';
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) throw new Error(`QBO list payment methods ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data?.QueryResponse?.PaymentMethod || [];
}

export async function listQboDepositAccounts(env) {
  const q = "SELECT Id, Name, AccountType, Active FROM Account WHERE Active = true AND AccountType IN ('Bank','Other Current Asset') MAXRESULTS 1000";
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) throw new Error(`QBO list deposit accounts ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data?.QueryResponse?.Account || [];
}

// Delete a QBO Payment (used when a UPR payment is removed). Looks up SyncToken first.
export async function deletePayment(env, qboPaymentId) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Payment WHERE Id = '${qboPaymentId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const syncToken = qd?.QueryResponse?.Payment?.[0]?.SyncToken;
  if (syncToken == null) throw new Error('Payment not found in QBO for delete');
  const res = await qboFetch(env, `/payment?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify({ Id: String(qboPaymentId), SyncToken: syncToken }),
  });
  if (!res.ok) throw new Error(`QBO delete payment ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// ── Stripe fee automation (Purchase + Transfer against the clearing account) ────
// Shared POST helper for the entities below (mirrors the error handling of create*).
async function postEntity(env, path, payload, label) {
  const res = await qboFetch(env, `${path}?minorversion=${MINOR_VERSION}`, { method: 'POST', body: JSON.stringify(payload) });
  const tid = res.headers.get('intuit_tid') || null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0];
    const e = new Error(fault ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}` : `QBO ${label} ${res.status}`);
    e.qboCode = fault?.code; e.status = res.status; e.intuitTid = tid;
    throw e;
  }
  return data;
}

// Book the Stripe processing fee as an expense: paid FROM the Stripe-clearing bank
// account, categorized TO the Merchant-Fees expense account. Net effect: the clearing
// account holds (gross − fee) = the eventual payout. `amount` is the exact fee.
export async function createPurchase(env, { paidFromAccountId, expenseAccountId, amount, txnDate, privateNote }) {
  const payload = {
    AccountRef: { value: String(paidFromAccountId) },
    PaymentType: 'Cash',
    ...(txnDate ? { TxnDate: txnDate } : {}),
    ...(privateNote ? { PrivateNote: privateNote } : {}),
    Line: [{
      Amount: Number(amount),
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: { AccountRef: { value: String(expenseAccountId) } },
    }],
  };
  return (await postEntity(env, '/purchase', payload, 'create purchase')).Purchase;
}

// Move the net payout from the Stripe-clearing account to the real bank account, so
// the clearing account self-zeroes and the bank reconciles to the Stripe payout.
export async function createTransfer(env, { fromAccountId, toAccountId, amount, txnDate, privateNote }) {
  const payload = {
    FromAccountRef: { value: String(fromAccountId) },
    ToAccountRef: { value: String(toAccountId) },
    Amount: Number(amount),
    ...(txnDate ? { TxnDate: txnDate } : {}),
    ...(privateNote ? { PrivateNote: privateNote } : {}),
  };
  return (await postEntity(env, '/transfer', payload, 'create transfer')).Transfer;
}

// Delete a QBO Purchase/Transfer (S4 refund/dispute reversal). Looks up SyncToken first.
export async function deleteEntity(env, entity, id) {
  const cap = entity.charAt(0).toUpperCase() + entity.slice(1);
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM ${cap} WHERE Id = '${id}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const syncToken = qd?.QueryResponse?.[cap]?.[0]?.SyncToken;
  if (syncToken == null) throw new Error(`${cap} not found in QBO for delete`);
  const res = await qboFetch(env, `/${entity}?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify({ Id: String(id), SyncToken: syncToken }),
  });
  if (!res.ok) throw new Error(`QBO delete ${entity} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}
