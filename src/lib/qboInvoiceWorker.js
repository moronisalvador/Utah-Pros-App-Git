/**
 * ════════════════════════════════════════════════
 * FILE: qboInvoiceWorker.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Calls the QuickBooks invoice Worker with one stable operation id per
 *   explicit Save, Send, or Delete command. An ambiguous network/provider
 *   failure keeps that id for a safe retry; a confirmed result retires it so a
 *   later deliberate command gets a fresh id.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  /api/qbo-invoice
 *   Data:      reads/writes → owner-scoped localStorage (opaque request ids only)
 *
 * NOTES / GOTCHAS:
 *   - The stored value is random and contains no customer, invoice, or amount.
 *   - Never replace this with Date.now(); money retries require a stable
 *     caller-supplied idempotency identity.
 * ════════════════════════════════════════════════
 */

const memoryPending = new Map();
const OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function operationName(body) {
  return body?.action === 'send' || body?.action === 'delete' ? body.action : 'save';
}

function storageKey(ownerId, invoiceId, action) {
  return `upr:qbo-invoice:v2:${String(ownerId)}:${action}:${String(invoiceId)}`;
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function requiredOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new Error('A signed-in user id is required for QBO invoice operations');
  }
  return ownerId;
}

function createOperationId() {
  const secureCrypto = globalThis.crypto;
  if (typeof secureCrypto?.randomUUID === 'function') return secureCrypto.randomUUID();
  if (typeof secureCrypto?.getRandomValues !== 'function') {
    throw new Error('Secure operation-id generation is unavailable');
  }
  const bytes = secureCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getQboInvoiceOperationId(ownerId, invoiceId, action) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  const storage = safeLocalStorage();
  let value = memoryPending.get(key) || null;
  if (!value && storage) {
    try { value = storage.getItem(key); } catch { /* memory fallback */ }
  }
  if (!OPERATION_ID_RE.test(String(value || ''))) {
    value = createOperationId();
    memoryPending.set(key, value);
    if (storage) {
      try { storage.setItem(key, value); } catch { /* memory fallback */ }
    }
  }
  return value;
}

export function clearQboInvoiceOperationId(ownerId, invoiceId, action) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  memoryPending.delete(key);
  const storage = safeLocalStorage();
  if (storage) {
    try { storage.removeItem(key); } catch { /* memory fallback */ }
  }
}

export async function callQboInvoiceWorker({ ownerId, invoiceId, authHeaders = {}, body = {} }) {
  const action = operationName(body);
  const operationId = getQboInvoiceOperationId(ownerId, invoiceId, action);
  // A rejected fetch never reaches the clearing logic below, so the exact
  // operation id remains pending for a safe retry after an unknown outcome.
  const response = await fetch('/api/qbo-invoice', {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
      'Idempotency-Key': operationId,
    },
    body: JSON.stringify({ invoice_id: invoiceId, ...body }),
  });

  const data = await response.json().catch(() => ({}));
  // An intermediary can replace an uncertain Worker response with a bare 5xx.
  // Keep the id in that case; only an explicit false is a definitive rejection.
  const retrySameRequest = !response.ok && (
    data.retry_same_request === true
    || (response.status >= 500 && data.retry_same_request !== false)
  );
  if (!retrySameRequest) clearQboInvoiceOperationId(ownerId, invoiceId, action);

  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    error.retrySameRequest = retrySameRequest;
    throw error;
  }
  return data;
}
