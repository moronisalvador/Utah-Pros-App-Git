/**
 * ════════════════════════════════════════════════
 * FILE: paymentAllocation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps payment amounts exact and checks that a payment has the details a
 *   person needs before reviewing it. It also keeps an unchanged retry tied to
 *   the same request ID, so a lost connection cannot make a second payment.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - All money calculations use integer cents, never decimal addition.
 *   - The server remains the final authority for balances and idempotency.
 * ════════════════════════════════════════════════
 */
export const cents = (value) => {
  const normalized = String(value ?? '').replace(/[$,\s]/g, '');
  if (!/^\d*(?:\.\d{0,2})?$/.test(normalized) || normalized === '') return null;
  return Math.round(Number(normalized) * 100);
};

export const money = (amountCents) => `$${(Number(amountCents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function allocationTotal(allocations = []) {
  return allocations.reduce((total, item) => total + Number(item.amount_cents || 0), 0);
}

// One tap on an invoice row fills its FULL open balance — the amount customers
// actually pay — and a second tap clears it. A manually-typed partial amount is
// visibly replaced by the full balance (QuickBooks checkbox semantics), never
// silently zeroed: the cleared state only comes from tapping an exact-full row.
export function toggleAllocationFill(currentValue, balanceCents) {
  const cents = Number(balanceCents);
  if (!Number.isFinite(cents) || cents <= 0) return String(currentValue ?? '');
  const full = (cents / 100).toFixed(2);
  return String(currentValue ?? '').trim() === full ? '' : full;
}

export function validateReceipt({ contactId, paymentDate, paymentMethod, referenceNumber, depositAccountId, allocations }) {
  const total = allocationTotal(allocations);
  if (!contactId) return 'Choose a customer.';
  if (!paymentDate) return 'Choose the payment date.';
  if (!paymentMethod) return 'Choose a payment method.';
  if (String(paymentMethod).toLowerCase() === 'check' && !String(referenceNumber || '').trim()) return 'A check number is required.';
  if (!depositAccountId) return 'Choose the deposit account.';
  if (!allocations?.length || total <= 0) return 'Allocate a positive payment amount.';
  if (allocations.some((item) => !item.invoice_id || Number(item.amount_cents) <= 0)) return 'Each allocation must be a positive amount.';
  return null;
}

export function canonicalPayload(payload) {
  return JSON.stringify({
    ...payload,
    allocations: [...(payload.allocations || [])].sort((a, b) => String(a.invoice_id).localeCompare(String(b.invoice_id))),
  });
}

export function nextRequestIdentity(current, payload, makeId = () => crypto.randomUUID()) {
  const canonical = canonicalPayload(payload);
  return current?.canonical === canonical ? current : { canonical, id: makeId() };
}

// React bubbles blur events. Only end the two-click review when focus has moved
// completely outside its card; moving from a field to Confirm is still one review.
export function shouldDisarmReviewOnBlur(currentTarget, relatedTarget) {
  return !relatedTarget || !currentTarget?.contains(relatedTarget);
}

export function groupPaymentLedgerRows(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const id = row.receipt_id || row.qbo_payment_id;
    const key = id ? `receipt:${id}` : `payment:${row.payment_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.amount = Number(existing.amount || 0) + Number(row.amount || 0);
      existing.allocation_count += 1;
      existing.invoice_numbers.push(row.qbo_doc_number || row.invoice_number || '—');
      existing.claim_ids.push(row.claim_id);
      existing.claim_numbers.push(row.claim_number);
      existing.job_numbers.push(row.job_number);
    } else groups.set(key, {
      ...row,
      ledger_group_key: key,
      allocation_count: 1,
      invoice_numbers: [row.qbo_doc_number || row.invoice_number || '—'],
      claim_ids: [row.claim_id],
      claim_numbers: [row.claim_number],
      job_numbers: [row.job_number],
    });
  });
  return [...groups.values()].map((group) => {
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const claimIds = unique(group.claim_ids);
    const claimNumbers = unique(group.claim_numbers);
    const jobNumbers = unique(group.job_numbers);
    const invoiceNumbers = unique(group.invoice_numbers);
    return {
      ...group,
      claim_id: claimIds.length === 1 ? claimIds[0] : null,
      claim_ids: claimIds,
      claim_numbers: claimNumbers,
      job_numbers: jobNumbers,
      invoice_numbers: invoiceNumbers,
      cross_claim: claimIds.length > 1,
      grouped: group.allocation_count > 1,
    };
  });
}
