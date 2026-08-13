/**
 * ════════════════════════════════════════════════
 * FILE: invoicePayment.js  (single-invoice receipt flow helpers)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns the invoice payment screen into the exact one-allocation payload the
 *   protected Receive Payment Worker accepts. It also validates the amount
 *   against the open balance returned by that Worker and chooses the default
 *   QuickBooks deposit account.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/components/collections/paymentAllocation
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This module never writes a payment row. The Worker owns the receipt ledger.
 *   - Amounts stay in integer cents from this boundary onward.
 * ════════════════════════════════════════════════
 */
import {
  canonicalPayload,
  cents,
  validateReceipt,
} from '@/components/collections/paymentAllocation';

export const RECEIVE_PAYMENT_DEPOSIT_KEY = 'upr:receive-payment:deposit-account';
const PENDING_PAYMENT_PREFIX = 'upr:invoice-payment:pending:v1';

function browserStorage(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

async function canonicalFingerprint(payload) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('Secure payment retry storage is unavailable on this device.');
  }
  const canonical = canonicalPayload(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return {
    canonical,
    fingerprint: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

async function pendingIdentityContext({ actorId, invoiceId, payload }) {
  if (!actorId || !invoiceId) throw new Error('Your employee session is unavailable. Reopen the invoice and try again.');
  const identity = await canonicalFingerprint(payload);
  return {
    ...identity,
    key: `${PENDING_PAYMENT_PREFIX}:${encodeURIComponent(String(actorId))}:${encodeURIComponent(String(invoiceId))}:${identity.fingerprint}`,
  };
}

// The random client request id is durable for exactly one actor + invoice +
// canonical payload. It is persisted before the network call so a killed native
// process or response-loss reload resumes the same server receipt attempt.
export async function readPendingInvoicePaymentIdentity({ storage, actorId, invoiceId, payload }) {
  const target = browserStorage(storage);
  if (!target) return null;
  const { key, canonical, fingerprint } = await pendingIdentityContext({ actorId, invoiceId, payload });
  try {
    const saved = JSON.parse(target.getItem(key) || 'null');
    return saved?.version === 1
      && saved.fingerprint === fingerprint
      && typeof saved.id === 'string'
      && saved.id
      ? { canonical, id: saved.id }
      : null;
  } catch { return null; }
}

export async function persistPendingInvoicePaymentIdentity({ storage, actorId, invoiceId, payload, identity }) {
  const target = browserStorage(storage);
  if (!target) throw new Error('Payment retry storage is unavailable on this device.');
  const { key, canonical, fingerprint } = await pendingIdentityContext({ actorId, invoiceId, payload });
  if (!identity?.id || identity.canonical !== canonical) throw new Error('Payment retry identity does not match this payment.');
  target.setItem(key, JSON.stringify({ version: 1, fingerprint, id: identity.id }));
  return identity;
}

export async function clearPendingInvoicePaymentIdentity({ storage, actorId, invoiceId, payload, requestId }) {
  const target = browserStorage(storage);
  if (!target) return false;
  const { key } = await pendingIdentityContext({ actorId, invoiceId, payload });
  try {
    const saved = JSON.parse(target.getItem(key) || 'null');
    if (requestId && saved?.id !== requestId) return false;
    target.removeItem(key);
    return true;
  } catch { return false; }
}

export function findInvoiceOption(data, invoiceId) {
  return (data?.invoices || []).find((row) => String(row.id) === String(invoiceId)) || null;
}

export function chooseDepositAccountId(accounts = [], currentId = '', rememberedId = '') {
  const valid = (id) => id && accounts.some((account) => String(account.id) === String(id));
  if (valid(currentId)) return String(currentId);
  if (valid(rememberedId)) return String(rememberedId);
  const fallback = accounts.find((account) => account.account_type === 'Bank') || accounts[0];
  return fallback?.id ? String(fallback.id) : '';
}

export function buildInvoicePaymentPayload({
  contactId,
  invoice,
  amount,
  paymentDate,
  payerType,
  method,
  referenceNumber,
  depositAccountId,
}) {
  return {
    contact_id: contactId || '',
    payment_date: paymentDate || '',
    payer_type: payerType || 'homeowner',
    payment_method: method?.type || method?.name || '',
    qbo_payment_method_id: method?.id ? String(method.id) : null,
    reference_number: String(referenceNumber || '').trim() || null,
    deposit_account_id: depositAccountId || '',
    allocations: [{
      invoice_id: invoice?.id || '',
      amount_cents: cents(amount),
    }],
  };
}

export function validateInvoicePayment(payload, invoice) {
  const message = validateReceipt({
    contactId: payload?.contact_id,
    paymentDate: payload?.payment_date,
    paymentMethod: payload?.payment_method,
    referenceNumber: payload?.reference_number,
    depositAccountId: payload?.deposit_account_id,
    allocations: payload?.allocations,
  });
  if (message) return message;
  const allocation = payload.allocations[0];
  if (payload.allocations.length !== 1 || String(allocation.invoice_id) !== String(invoice?.id)) {
    return 'This payment must apply only to the invoice you opened.';
  }
  if (Number(allocation.amount_cents) > Number(invoice?.balance_cents || 0)) {
    return 'The payment is greater than this invoice’s current open balance.';
  }
  return null;
}
