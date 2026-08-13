/**
 * ════════════════════════════════════════════════
 * FILE: qboEstimateWorker.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends a person-approved estimate action to the UPR server with one durable
 *   retry identity. If the result is uncertain, the browser keeps that same
 *   identity so another click cannot create a second QuickBooks action.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none (retry state is read from browser localStorage)
 *              writes → none (retry state is written to browser localStorage)
 *
 * NOTES / GOTCHAS:
 *   - Web Locks serialize tabs, and missing lock or storage support fails closed.
 *   - Estimate retry keys intentionally never share the invoice namespace.
 * ════════════════════════════════════════════════
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const actionFor = (body) => (body?.action === 'send' || body?.action === 'delete' ? body.action : 'save');
const keyFor = (ownerId, estimateId, action) => `upr:qbo-estimate:v1:${ownerId}:${action}:${estimateId}`;

function requiredOwner(ownerId) {
  if (!String(ownerId || '').trim()) throw new Error('A signed-in user id is required for QBO estimate operations');
  return String(ownerId);
}

function storage() {
  try {
    globalThis.localStorage.setItem('upr:qbo-estimate:probe', '1');
    globalThis.localStorage.removeItem('upr:qbo-estimate:probe');
    return globalThis.localStorage;
  } catch {
    const error = new Error('Durable QuickBooks retry storage is unavailable. Restore browser storage access before trying again.');
    error.code = 'qbo-operation-storage-unavailable';
    error.retrySameRequest = true;
    throw error;
  }
}

async function locked(key, callback) {
  if (typeof globalThis.navigator?.locks?.request !== 'function') {
    const error = new Error('Cross-tab QuickBooks retry locking is unavailable. Update this browser before trying again.');
    error.code = 'qbo-operation-lock-unavailable';
    error.retrySameRequest = true;
    throw error;
  }
  return globalThis.navigator.locks.request(`upr:qbo-estimate:${key}`, callback);
}

function uuid() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('Secure operation-id generation is unavailable');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return Number.isFinite(value) || typeof value !== 'number' ? value : null;
}

async function fingerprint(body) {
  if (typeof crypto?.subtle?.digest !== 'function') throw new Error('Secure QuickBooks retry binding is unavailable');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(body))));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function operation(ownerId, estimateId, action, body) {
  const key = keyFor(requiredOwner(ownerId), estimateId, action);
  const bodyHash = await fingerprint({ ...body, action });
  return locked(key, () => {
    const store = storage();
    const raw = store.getItem(key);
    let record = null;
    try { record = raw ? JSON.parse(raw) : null; } catch { /* replace malformed local-only state */ }
    if (record?.id && UUID_V4.test(record.id)) {
      if (record.hash !== bodyHash) {
        const error = new Error('A different QuickBooks estimate change is still unresolved. Restore the original values and retry it first.');
        error.status = 409; error.code = 'pending-operation-body-mismatch'; error.retrySameRequest = true;
        throw error;
      }
      return record.id;
    }
    const id = uuid();
    store.setItem(key, JSON.stringify({ id, hash: bodyHash }));
    return id;
  });
}

async function clearIfMatches(ownerId, estimateId, action, id) {
  const key = keyFor(requiredOwner(ownerId), estimateId, action);
  return locked(key, () => {
    const store = storage();
    try { if (JSON.parse(store.getItem(key))?.id === id) store.removeItem(key); } catch { /* preserve unreadable record */ }
  });
}

/** Calls the estimate Worker with the same deterministic id through every ambiguous retry. */
export async function callQboEstimateWorker({ ownerId, estimateId, authHeaders = {}, body = {} }) {
  const action = actionFor(body);
  const operationId = await operation(ownerId, estimateId, action, body);
  const response = await fetch('/api/qbo-estimate', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
    body: JSON.stringify({ estimate_id: estimateId, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  const retrySameRequest = !response.ok && (data.retry_same_request === true || (response.status >= 500 && data.retry_same_request !== false));
  if (!retrySameRequest) await clearIfMatches(ownerId, estimateId, action, operationId);
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status; error.retrySameRequest = retrySameRequest;
    throw error;
  }
  return data;
}
