/**
 * ════════════════════════════════════════════════
 * FILE: qbo-reconciliation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps a durable, small to-do item whenever QuickBooks and UPR cannot be
 *   safely matched without a person deciding. It also closes that same item
 *   when a later run has a clear answer.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → qbo_events
 *
 * NOTES / GOTCHAS:
 *   - Synthetic ids use stable provider/internal record identifiers only.
 *     Never put customer data, amounts, or provider payloads in this ledger.
 * ════════════════════════════════════════════════
 */

const REASON_MAP = new Map([
  ['combined-invoice-manual-reconciliation', 'combined-invoice'],
  ['combined-estimate-manual-reconciliation', 'combined-estimate'],
  ['unmapped-qbo-invoice-manual-reconciliation', 'unmapped-qbo-invoice'],
  ['needs-manual-reconciliation', 'needs-manual-reconciliation'],
  ['qbo-invoice-mismatch', 'qbo-invoice-mismatch'],
  ['staff-decision-conflict', 'staff-decision-conflict'],
]);

const UNMAPPED_QBO_INVOICE_REASON = 'unmapped-qbo-invoice-manual-reconciliation';

function bounded(value, max = 500) {
  return String(value || '').slice(0, max);
}

export function reconciliationItem(entity, qboId, result) {
  const rawReason = result?.manual_reconciliation || result?.skipped || result?.blocked;
  const reason = REASON_MAP.get(rawReason);
  if (!reason || !entity || qboId == null || String(qboId) === '') return null;
  return { entity: String(entity), qboId: String(qboId), reason };
}

export function reconciliationEventId({ entity, qboId }) {
  return `reconcile:${entity}:${qboId}`;
}

function paymentScope(realmId, paymentId) {
  const realm = String(realmId || '').trim();
  const payment = String(paymentId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(realm) || !/^[A-Za-z0-9_-]{1,128}$/.test(payment)) {
    return null;
  }
  return { entity: 'Payment', qboId: `${realm}:${payment}` };
}

export async function resolvePaymentReconciliation(db, realmId, paymentId) {
  const scope = paymentScope(realmId, paymentId);
  return scope ? resolveReconciliation(db, scope.entity, scope.qboId) : null;
}

export async function reconcilePaymentResults(db, realmId, paymentId, results = []) {
  const scope = paymentScope(realmId, paymentId);
  const delegated = [];
  let hasScopedUnmappedMarker = false;
  for (const result of results || []) {
    const rawReason = result?.manual_reconciliation || result?.skipped || result?.blocked;
    if (rawReason === UNMAPPED_QBO_INVOICE_REASON && scope && result?.qboInvoiceId != null) {
      hasScopedUnmappedMarker = true;
      delegated.push(await recordReconciliation(db, {
        ...scope,
        reason: 'unmapped-qbo-invoice',
        context: { qbo_invoice_id: String(result.qboInvoiceId) },
      }));
      continue;
    }
    const entity = result?.qboInvoiceId ? 'Invoice' : 'Payment';
    const qboId = result?.qboInvoiceId || paymentId;
    const item = reconciliationItem(entity, qboId, result);
    if (item) delegated.push(await recordReconciliation(db, item));
    else await resolveReconciliation(db, entity, qboId);
  }
  // Only the same realm/payment identity can close its prior unmapped marker.
  // Another payment against the same invoice must never silence this to-do.
  if (scope && !hasScopedUnmappedMarker && (results || []).length > 0) {
    await resolvePaymentReconciliation(db, realmId, paymentId);
  }
  return delegated.filter(Boolean);
}

export async function recordReconciliation(db, item) {
  if (!item) return null;
  const id = reconciliationEventId(item);
  // Optional context is deliberately narrow: callers may record stable internal
  // identifiers that tell finance what lost a race, never provider payloads,
  // customer details, or amounts. Keep the ledger row bounded even if a caller
  // accidentally supplies a long identifier.
  const context = item.context && typeof item.context === 'object'
    ? Object.entries(item.context)
      .filter(([key, value]) => /^[a-z_]{1,40}$/i.test(key) && value != null && value !== '')
      .slice(0, 6)
      .map(([key, value]) => `${key}=${bounded(value, 160)}`)
      .join('; ')
    : '';
  await db.upsert('qbo_events', {
    id,
    entity: item.entity,
    operation: 'reconcile',
    status: 'needs_reconciliation',
    error: bounded(`reconciliation_required: ${item.reason}; ${item.entity}=${item.qboId}${context ? `; ${context}` : ''}`),
    processed_at: null,
  });
  return { ...item, id };
}

// A later non-ambiguous import closes only its matching deterministic item.
// PostgREST treats an absent marker as a no-op, which is correct for ordinary
// QBO traffic that never needed human attention.
export async function resolveReconciliation(db, entity, qboId) {
  if (!entity || qboId == null || String(qboId) === '') return null;
  const id = reconciliationEventId({ entity: String(entity), qboId: String(qboId) });
  await db.update('qbo_events', `id=eq.${id}`, {
    status: 'processed',
    error: null,
    processed_at: new Date().toISOString(),
  });
  return id;
}
