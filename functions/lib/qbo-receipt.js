/**
 * ════════════════════════════════════════════════
 * FILE: qbo-receipt.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks and standardizes the details for one customer payment before the
 *   protected server sends it to QuickBooks. It also creates the stable marker
 *   that makes an unchanged retry return the original QuickBooks payment.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → feature_flags when isReceivePaymentsGateOpen() is used
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - All payment amounts cross this boundary as positive whole cents.
 *   - Payer and method values must stay identical to the database receipt RPCs.
 *   - The Intuit request ID is realm-scoped, collision-free, and at most 50 characters.
 * ════════════════════════════════════════════════
 */

const METHODS = new Set(['check', 'ach', 'credit_card', 'wire', 'cash', 'insurance_direct', 'other']);
const PAYERS = new Set(['homeowner', 'insurance', 'other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ALLOCATIONS = 100;

export function normalizeQboPaymentMethod(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (normalized.includes('check')) return 'check';
  if (normalized.includes('ach') || normalized.includes('bank') || normalized.includes('echeck')
      || normalized.includes('e-check') || normalized.includes('eft')) return 'ach';
  if (normalized.includes('card') || normalized.includes('credit') || normalized.includes('visa')
      || normalized.includes('master') || normalized.includes('amex') || normalized.includes('discover')) return 'credit_card';
  if (normalized.includes('wire')) return 'wire';
  if (normalized.includes('cash')) return 'cash';
  if (normalized.includes('insurance')) return 'insurance_direct';
  return 'other';
}

export function isReceivePaymentsEnabled(env) {
  return env.QBO_RECEIVE_PAYMENT_ENABLED === 'true';
}

export async function isReceivePaymentsGateOpen(env, db) {
  if (!isReceivePaymentsEnabled(env) || !db?.select) return false;
  try {
    const flag = (await db.select(
      'feature_flags',
      'key=eq.feature%3Aqbo_receive_payment&select=key,enabled,force_disabled&limit=1',
    ))?.[0];
    return flag?.key === 'feature:qbo_receive_payment'
      && flag.enabled === true
      && flag.force_disabled === false;
  } catch {
    return false;
  }
}

export function cents(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function validateReceiptRequest(body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid request body');
  const clientRequestId = String(body.client_request_id || '').trim();
  if (!UUID.test(clientRequestId)) throw new Error('client_request_id must be a UUID');
  const contactId = String(body.contact_id || '').trim();
  if (!UUID.test(contactId)) throw new Error('contact_id must be a UUID');
  const paymentDate = String(body.payment_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error('payment_date must be YYYY-MM-DD');
  const [year, month, day] = paymentDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('payment_date must be a real calendar date');
  }
  const payerType = String(body.payer_type || '');
  const paymentMethod = String(body.payment_method || '');
  if (!PAYERS.has(payerType)) throw new Error('Invalid payer_type');
  if (!METHODS.has(paymentMethod)) throw new Error('Invalid payment_method');
  const referenceNumber = body.reference_number == null ? null : String(body.reference_number).trim() || null;
  if (referenceNumber && referenceNumber.length > 100) throw new Error('reference_number is too long');
  if (paymentMethod === 'check' && !referenceNumber) throw new Error('reference_number is required for check payments');
  const paymentMethodId = String(body.qbo_payment_method_id || '').trim();
  if (!paymentMethodId || paymentMethodId.length > 100) throw new Error('qbo_payment_method_id is required');
  const depositAccountId = String(body.deposit_account_id || '').trim();
  if (!depositAccountId || depositAccountId.length > 100) throw new Error('deposit_account_id is required');
  if (Array.isArray(body.allocations) && body.allocations.length > MAX_ALLOCATIONS) {
    throw new Error(`No more than ${MAX_ALLOCATIONS} invoice allocations are allowed`);
  }
  const seen = new Set();
  const allocations = Array.isArray(body.allocations) ? body.allocations.map((row) => {
    const invoiceId = String(row?.invoice_id || '').trim();
    const amountCents = cents(row?.amount_cents);
    if (!UUID.test(invoiceId) || !amountCents) throw new Error('Each allocation requires a UUID invoice_id and positive integer amount_cents');
    if (seen.has(invoiceId)) throw new Error('An invoice may only appear once');
    seen.add(invoiceId);
    return { invoice_id: invoiceId, amount_cents: amountCents };
  }) : [];
  if (!allocations.length) throw new Error('At least one allocation is required');
  const totalCents = allocations.reduce((sum, allocation) => sum + allocation.amount_cents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('Payment total is too large');
  return {
    client_request_id: clientRequestId,
    contact_id: contactId,
    payment_date: paymentDate,
    payer_type: payerType,
    payment_method: paymentMethod,
    qbo_payment_method_id: paymentMethodId,
    reference_number: referenceNumber,
    deposit_account_id: depositAccountId,
    allocations: allocations.sort((a, b) => a.invoice_id.localeCompare(b.invoice_id)),
  };
}

export async function receiptFingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function intuitRequestId(clientRequestId) {
  // A canonical UUID is 36 chars, so this is collision-free and stays within Intuit's 50-char limit.
  return `uprp-${clientRequestId.toLowerCase()}`;
}

export function qboBalanceCents(invoice) {
  const balance = Number(invoice?.Balance);
  const centsValue = Math.round(balance * 100);
  return Number.isFinite(balance) && Math.abs(balance * 100 - centsValue) < 1e-7 ? centsValue : null;
}
