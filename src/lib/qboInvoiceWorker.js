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
 *   Browser:   Web Locks API (cross-tab compare/write/delete serialization)
 *   Data:      reads/writes → owner-scoped localStorage (opaque request ids and
 *                              one-way request fingerprints only)
 *
 * NOTES / GOTCHAS:
 *   - The stored record contains no customer, amount, email, or line text; the
 *     owner/invoice identifiers remain only in the namespaced v2/v3 keys.
 *   - Side effects fail closed before fetch when durable storage or cross-tab
 *     locking is unavailable; an in-memory fallback can lose an ambiguous id.
 *   - Never replace this with Date.now(); money retries require a stable
 *     caller-supplied idempotency identity.
 * ════════════════════════════════════════════════
 */

const OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING_RECORD_VERSION = 3;
const STORAGE_PROBE_KEY = 'upr:qbo-invoice:storage-probe';

function operationName(body) {
  return body?.action === 'send' || body?.action === 'delete' ? body.action : 'save';
}

function storageKey(ownerId, invoiceId, action) {
  return `upr:qbo-invoice:v2:${String(ownerId)}:${action}:${String(invoiceId)}`;
}

function metadataStorageKey(ownerId, invoiceId, action) {
  return `upr:qbo-invoice:v3:${String(ownerId)}:${action}:${String(invoiceId)}`;
}

function requiredLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') throw new Error('missing');
    localStorage.setItem(STORAGE_PROBE_KEY, '1');
    localStorage.removeItem(STORAGE_PROBE_KEY);
    return localStorage;
  } catch {
    const error = new Error('Durable QuickBooks retry storage is unavailable. Restore browser storage access before trying again.');
    error.code = 'qbo-operation-storage-unavailable';
    error.retrySameRequest = true;
    throw error;
  }
}

async function withPendingLock(key, callback) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request !== 'function') {
    const error = new Error('Cross-tab QuickBooks retry locking is unavailable. Update this browser before trying again.');
    error.code = 'qbo-operation-lock-unavailable';
    error.retrySameRequest = true;
    throw error;
  }
  return locks.request(`upr:qbo-invoice:${key}`, callback);
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

function metadataRecord(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed?.version === PENDING_RECORD_VERSION
        && OPERATION_ID_RE.test(String(parsed.operationId || ''))
        && (parsed.fingerprint == null || /^sha256:[a-f0-9]{64}$/.test(parsed.fingerprint))) {
      return {
        operationId: parsed.operationId,
        fingerprint: parsed.fingerprint || null,
        legacyUnknownBody: false,
      };
    }
  } catch { /* invalid metadata is ignored below */ }
  return null;
}

function persistPending(key, metadataKey, record, storage) {
  // Keep the deployed v2 key as a raw UUID so an already-open old tab cannot
  // mistake v3 JSON for corruption and overwrite an unresolved operation. The
  // separate v3 record is authoritative for content binding and recovery.
  const rawValue = storage.getItem(key);
  const rawOperationId = OPERATION_ID_RE.test(String(rawValue || '')) ? String(rawValue) : null;
  // A different valid raw UUID can belong to a legitimate newer action from an
  // already-open v2 tab. Never overwrite it; v3 can still recover its own id.
  if (!rawOperationId || rawOperationId === record.operationId) {
    storage.setItem(key, record.operationId);
  }
  storage.setItem(metadataKey, JSON.stringify({
    version: PENDING_RECORD_VERSION,
    operationId: record.operationId,
    fingerprint: record.fingerprint,
  }));
}

function readPendingRecord(ownerId, invoiceId, action, storage) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  const metadataKey = metadataStorageKey(ownerId, invoiceId, action);
  const rawValue = storage.getItem(key);
  const rawOperationId = OPERATION_ID_RE.test(String(rawValue || '')) ? String(rawValue) : null;
  // Also migrate the brief authoring-build format that placed v3 JSON directly
  // in the v2 slot; no released client depends on that shape.
  const storedMetadata = metadataRecord(storage.getItem(metadataKey));
  const record = storedMetadata || metadataRecord(rawValue);
  if (record) {
    if (!rawOperationId || !storedMetadata) {
      persistPending(key, metadataKey, record, storage);
    }
    return { key, metadataKey, record, storage };
  }
  if (rawOperationId) {
    // v2 stored only the operation id. Keep it usable across a rolling client
    // upgrade, but do not guess which already-sent body it belongs to.
    return {
      key,
      metadataKey,
      record: { operationId: rawOperationId, fingerprint: null, legacyUnknownBody: true },
      storage,
    };
  }
  return null;
}

function getPendingRecord(ownerId, invoiceId, action, storage) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  const metadataKey = metadataStorageKey(ownerId, invoiceId, action);
  let pending = readPendingRecord(ownerId, invoiceId, action, storage);
  let record = pending?.record;
  if (!record) {
    record = { operationId: createOperationId(), fingerprint: null, legacyUnknownBody: false };
    persistPending(key, metadataKey, record, storage);
    pending = { key, metadataKey, record, storage };
  }
  return pending;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry === undefined ? null : entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalValue(value[key])]));
  }
  return Number.isNaN(value) || value === Infinity || value === -Infinity ? null : value;
}

async function bodyFingerprint(body, action) {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== 'function') {
    throw new Error('Secure QuickBooks retry binding is unavailable');
  }
  const canonical = JSON.stringify(canonicalValue({ ...body, action }));
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

async function boundOperation(ownerId, invoiceId, action, body) {
  const owner = requiredOwnerId(ownerId);
  const key = storageKey(owner, invoiceId, action);
  const fingerprint = await bodyFingerprint(body, action);
  return withPendingLock(key, () => {
    const storage = requiredLocalStorage();
    const pending = getPendingRecord(owner, invoiceId, action, storage);
    if (pending.record.fingerprint && pending.record.fingerprint !== fingerprint) {
      const error = new Error('A different QuickBooks change is still unresolved. Restore the original values and retry that update first.');
      error.status = 409;
      error.code = 'pending-operation-body-mismatch';
      error.retrySameRequest = true;
      throw error;
    }
    if (!pending.record.fingerprint && !pending.record.legacyUnknownBody) {
      pending.record = { ...pending.record, fingerprint };
      persistPending(pending.key, pending.metadataKey, pending.record, pending.storage);
    }
    return pending.record.operationId;
  });
}

export async function getQboInvoiceOperationId(ownerId, invoiceId, action) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  return withPendingLock(key, () => (
    getPendingRecord(ownerId, invoiceId, action, requiredLocalStorage()).record.operationId
  ));
}

export async function clearQboInvoiceOperationId(ownerId, invoiceId, action) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  return withPendingLock(key, () => {
    const storage = requiredLocalStorage();
    const metadataKey = metadataStorageKey(ownerId, invoiceId, action);
    const rawValue = storage.getItem(key);
    const rawOperationId = OPERATION_ID_RE.test(String(rawValue || '')) ? String(rawValue) : null;
    const metadata = metadataRecord(storage.getItem(metadataKey)) || metadataRecord(rawValue);
    if (rawOperationId && metadata && rawOperationId !== metadata.operationId) {
      const error = new Error('Two QuickBooks operations are still represented in browser storage; retry or reload before clearing either one.');
      error.code = 'qbo-operation-clear-conflict';
      error.retrySameRequest = true;
      throw error;
    }
    storage.removeItem(metadataKey);
    storage.removeItem(key);
  });
}

async function clearQboInvoiceOperationIdIfMatches(ownerId, invoiceId, action, operationId) {
  const key = storageKey(requiredOwnerId(ownerId), invoiceId, action);
  return withPendingLock(key, () => {
    const storage = requiredLocalStorage();
    const metadataKey = metadataStorageKey(ownerId, invoiceId, action);
    const rawValue = storage.getItem(key);
    const rawOperationId = OPERATION_ID_RE.test(String(rawValue || '')) ? String(rawValue) : null;
    const metadata = metadataRecord(storage.getItem(metadataKey)) || metadataRecord(rawValue);
    // The cross-context Web Lock makes this comparison and removal one
    // indivisible app operation: no cooperating tab can bind a newer id between
    // the read and delete. v2 and v3 are compared independently so a late v3 X
    // response cannot delete a legitimate newer raw v2 Y from an old tab.
    if (metadata?.operationId === operationId) storage.removeItem(metadataKey);
    if (rawOperationId === operationId || metadataRecord(rawValue)?.operationId === operationId) storage.removeItem(key);
  });
}

export async function callQboInvoiceWorker({ ownerId, invoiceId, authHeaders = {}, body = {} }) {
  const action = operationName(body);
  const operationId = await boundOperation(ownerId, invoiceId, action, body);
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
    || ['line-update-mismatch', 'command-source-mismatch', 'qbo-invoice-mismatch'].includes(data.code)
    || (response.status >= 500 && data.retry_same_request !== false)
  );
  if (!retrySameRequest) await clearQboInvoiceOperationIdIfMatches(ownerId, invoiceId, action, operationId);

  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    error.retrySameRequest = retrySameRequest;
    throw error;
  }
  return data;
}
