// QuickBooks Online (Intuit) helper for Cloudflare Workers.
// No SDK — pure fetch(), works in V8 isolates. Mirrors functions/lib/supabase.js.
//
// Tokens live in the `integration_credentials` table (provider = 'quickbooks'),
// readable/writable only by the service-role key. Access tokens last ~1 hour;
// refresh tokens roll forward on each refresh and are persisted automatically.

import { supabase } from './supabase.js';

const PROVIDER      = 'quickbooks';
const TOKEN_URL     = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPE         = 'com.intuit.quickbooks.accounting';
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
  const res = await fetch(TOKEN_URL, {
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
  const db = supabase(env);
  const rows = await db.select('integration_credentials', `provider=eq.${PROVIDER}&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}

export async function saveTokens(env, tokens, extra = {}) {
  const db = supabase(env);
  const now = Date.now();
  const ttlMs = (tokens.expires_in ? Number(tokens.expires_in) : 3600) * 1000;
  const row = {
    provider:         PROVIDER,
    access_token:     tokens.access_token,
    refresh_token:    tokens.refresh_token,
    token_expires_at: new Date(now + ttlMs).toISOString(),
    updated_at:       new Date(now).toISOString(),
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
export async function qboFetch(env, path, options = {}) {
  const { accessToken, realmId, environment } = await getValidAccessToken(env);
  const url = `${apiBase(environment)}/v3/company/${realmId}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      ...(options.headers || {}),
    },
  });
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

// Runs a Customer query, returns the first match (or null on no match / error).
export async function queryCustomer(env, whereClause) {
  const q = `SELECT Id, DisplayName, PrimaryEmailAddr FROM Customer WHERE ${whereClause}`;
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  if (!res.ok) {
    console.warn('QBO customer query failed', JSON.stringify({ status: res.status, intuit_tid: res.headers.get('intuit_tid') || null }));
    return null;
  }
  const data = await res.json().catch(() => ({}));
  return data?.QueryResponse?.Customer?.[0] || null;
}

// Dedup lookup before creating: match on email first, then exact (normalized,
// case-insensitive) display name. Returns { customer, matchedBy } or null.
export async function findExistingCustomer(env, contact, payload) {
  const email = (contact.email || '').trim();
  if (email) {
    const byEmail = await queryCustomer(env, `PrimaryEmailAddr = '${escQ(email)}'`);
    if (byEmail) return { customer: byEmail, matchedBy: 'email' };
  }
  if (payload.DisplayName) {
    const byName = await queryCustomer(env, `DisplayName = '${escQ(payload.DisplayName)}'`);
    if (byName) return { customer: byName, matchedBy: 'name' };
  }
  return null;
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

// ── Invoices (Phase 2) ───────────────────────────────────────────────────────
// UPR division → QBO line mapping (Item Id + Class name). Item Ids are stable in
// QBO; Class Id is resolved at runtime by name. Class only for mit/recon for now.
export function divisionToQbo(division) {
  const d = (division || '').toLowerCase();
  if (d.includes('recon'))                                  return { itemId: '1010000201', className: 'Reconstruction' };
  if (d.includes('mold'))                                   return { itemId: '1010000131', className: null };
  if (d.includes('content'))                                return { itemId: '38',         className: null };
  if (d.includes('mit') || d.includes('water') || d.includes('dry'))
                                                            return { itemId: '1010000071', className: 'Mitigation' };
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

export async function createInvoice(env, payload) {
  const res = await qboFetch(env, `/invoice?minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify(payload),
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
export async function deleteInvoice(env, qboInvoiceId) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Invoice WHERE Id = '${qboInvoiceId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const syncToken = qd?.QueryResponse?.Invoice?.[0]?.SyncToken;
  if (syncToken == null) throw new Error('Invoice not found in QBO for delete');
  const res = await qboFetch(env, `/invoice?operation=delete&minorversion=${MINOR_VERSION}`, {
    method: 'POST', body: JSON.stringify({ Id: String(qboInvoiceId), SyncToken: syncToken }),
  });
  if (!res.ok) throw new Error(`QBO delete invoice ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// Sparse-update an existing QBO invoice (used by auto-push when the UPR invoice is
// edited after it was first pushed). Looks up the current SyncToken, then sends a
// sparse update — `fields` typically { Line: [...], PrivateNote }. Sparse semantics
// preserve everything we don't send (CustomerRef, etc.); a provided Line array
// replaces the line set, which is how the amount changes.
export async function updateInvoice(env, qboInvoiceId, fields) {
  const q = await qboFetch(env, `/query?query=${encodeURIComponent(`SELECT Id, SyncToken FROM Invoice WHERE Id = '${qboInvoiceId}'`)}&minorversion=${MINOR_VERSION}`, { method: 'GET' });
  const qd = await q.json().catch(() => ({}));
  const existing = qd?.QueryResponse?.Invoice?.[0];
  if (existing?.SyncToken == null) throw new Error('Invoice not found in QBO for update');
  const res = await qboFetch(env, `/invoice?minorversion=${MINOR_VERSION}`, {
    method: 'POST',
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
export async function sendInvoice(env, qboInvoiceId, sendTo) {
  const path = `/invoice/${qboInvoiceId}/send?minorversion=${MINOR_VERSION}`
    + (sendTo ? `&sendTo=${encodeURIComponent(sendTo)}` : '');
  const res = await qboFetch(env, path, {
    method: 'POST',
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
export async function createPayment(env, { customerId, qboInvoiceId, amount, txnDate, privateNote, depositAccountId }) {
  const payload = {
    CustomerRef: { value: String(customerId) },
    TotalAmt: Number(amount),
    ...(txnDate ? { TxnDate: txnDate } : {}),
    ...(privateNote ? { PrivateNote: privateNote } : {}),
    ...(depositAccountId ? { DepositToAccountRef: { value: String(depositAccountId) } } : {}),
    Line: [{
      Amount: Number(amount),
      LinkedTxn: [{ TxnId: String(qboInvoiceId), TxnType: 'Invoice' }],
    }],
  };
  const res = await qboFetch(env, `/payment?minorversion=${MINOR_VERSION}`, {
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
  return data.Payment;
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
