/**
 * ════════════════════════════════════════════════
 * FILE: qboInvoiceWorker.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that browser invoice actions keep one safe operation id while a
 *   result is uncertain, then replace it after a confirmed outcome.
 *   It also binds ambiguous line patches to that identity and checks that one
 *   signed-in user cannot reuse another user's id.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qboInvoiceWorker.js
 *   Browser:   Web Locks API test double
 *   Data:      reads/writes → localStorage test double (opaque request ids only)
 *
 * NOTES / GOTCHAS:
 *   - No QuickBooks, network, or production database call is made by this file.
 *   - The tests intentionally simulate lost responses and definitive failures.
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  callQboInvoiceWorker,
  clearQboInvoiceOperationId,
  getQboInvoiceOperationId,
} from './qboInvoiceWorker.js';

const INVOICE_ID = '00000000-0000-4000-8000-00000000aaaa';
const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const V2_KEY = `upr:qbo-invoice:v2:${OWNER_ID}:save:${INVOICE_ID}`;
const V3_KEY = `upr:qbo-invoice:v3:${OWNER_ID}:save:${INVOICE_ID}`;
let stored;

function lockManager() {
  const queues = new Map();
  return {
    request(name, callback) {
      const previous = queues.get(name) || Promise.resolve();
      const current = previous.catch(() => {}).then(callback);
      let tracked;
      const cleanup = () => {
        if (queues.get(name) === tracked) queues.delete(name);
      };
      tracked = current.then(cleanup, cleanup);
      queues.set(name, tracked);
      return current;
    },
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    json: async () => body,
  };
}

beforeEach(async () => {
  stored = new Map();
  vi.stubGlobal('navigator', { locks: lockManager() });
  vi.stubGlobal('localStorage', {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  });
  await clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save');
  await clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'send');
  await clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'delete');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QBO invoice caller operation ids', () => {
  it('reuses one id after a transport failure, then retires it after success', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) throw new Error('network response lost');
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID })).rejects.toThrow(/response lost/);
    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID })).resolves.toEqual({ ok: true });

    expect(requestIds[1]).toBe(requestIds[0]);

    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID });
    expect(requestIds[2]).not.toBe(requestIds[1]);
  });

  it('keeps the id only for an explicitly ambiguous server result', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) {
        return response(503, { error: 'provider timeout', retry_same_request: true });
      }
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({
      ownerId: OWNER_ID,
      invoiceId: INVOICE_ID,
      body: { action: 'send' },
    })).rejects.toMatchObject({ retrySameRequest: true });
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body: { action: 'send' } });

    expect(requestIds[1]).toBe(requestIds[0]);
  });

  it('keeps the id for a generic 503 whose response body lost the retry marker', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) return response(503, { error: 'proxy unavailable' });
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID })).rejects.toMatchObject({ retrySameRequest: true });
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID });

    expect(requestIds[1]).toBe(requestIds[0]);
  });

  it('preserves the original ambiguous line-patch identity across a changed form and exact retry', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) return response(503, { error: 'provider timeout', retry_same_request: true });
      return response(200, { ok: true });
    }));
    const original = {
      action: 'save',
      line_update: { line_id: 'line-1', description: 'Original patch', quantity: 1, unit_price: 10 },
    };
    const changed = {
      action: 'save',
      line_update: { ...original.line_update, description: 'Different patch' },
    };

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body: original }))
      .rejects.toMatchObject({ retrySameRequest: true });
    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body: changed }))
      .rejects.toMatchObject({ code: 'pending-operation-body-mismatch', retrySameRequest: true });
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body: original }))
      .resolves.toEqual({ ok: true });
    expect(requestIds[1]).toBe(requestIds[0]);
  });

  it('persists only the operation id and cryptographic fingerprint, never request PII', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('response lost'); }));
    await expect(callQboInvoiceWorker({
      ownerId: OWNER_ID,
      invoiceId: INVOICE_ID,
      body: {
        action: 'save',
        send_to: 'private@example.test',
        line_update: { line_id: 'line-secret', description: 'Sensitive customer work', quantity: 7, unit_price: 123.45 },
      },
    })).rejects.toThrow(/response lost/);

    expect(stored.get(V2_KEY)).toMatch(/^[0-9a-f-]{36}$/i);
    const record = JSON.parse(stored.get(V3_KEY));
    expect(Object.keys(record).sort()).toEqual(['fingerprint', 'operationId', 'version']);
    expect(record.operationId).toBe(stored.get(V2_KEY));
    expect(record.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(record.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify([...stored.entries()])).not.toMatch(/private@example|Sensitive customer work|123\.45|line-secret/);
  });

  it('keeps a legacy v2 id after a server line-patch mismatch so the original body can recover', async () => {
    const legacyId = '11111111-1111-4111-8111-111111111111';
    stored.set(V2_KEY, legacyId);
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) return response(409, { error: 'different patch', code: 'line-update-mismatch' });
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body: { action: 'save', line_update: { description: 'changed' } } }))
      .rejects.toMatchObject({ retrySameRequest: true });
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body: { action: 'save', line_update: { description: 'original' } } });

    expect(requestIds).toEqual([legacyId, legacyId]);
  });

  it('keeps the old v2 value raw and repairs a missing mirror from v3', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) return response(503, { error: 'provider timeout', retry_same_request: true });
      expect(stored.get(V2_KEY)).toBe(requestIds[0]);
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID }))
      .rejects.toMatchObject({ retrySameRequest: true });
    const originalId = requestIds[0];
    expect(stored.get(V2_KEY)).toBe(originalId);
    expect(JSON.parse(stored.get(V3_KEY))).toMatchObject({ operationId: originalId });

    // Deployed v2 code can clear only this raw slot after replaying X.
    stored.delete(V2_KEY);
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID });

    expect(requestIds).toEqual([originalId, originalId]);
    expect(stored.has(V2_KEY)).toBe(false);
    expect(stored.has(V3_KEY)).toBe(false);
  });

  it('never overwrites or clears a legitimate newer raw v2 id during late v3 replay', async () => {
    const requestIds = [];
    const newerV2Id = '22222222-2222-4222-8222-222222222222';
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) return response(503, { error: 'provider timeout', retry_same_request: true });
      expect(stored.get(V2_KEY)).toBe(newerV2Id);
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID }))
      .rejects.toMatchObject({ retrySameRequest: true });
    const originalId = requestIds[0];

    // An already-open v2 tab replays X, clears its raw key, then starts and
    // sends legitimate newer action Y before this tab receives X's late result.
    stored.delete(V2_KEY);
    stored.set(V2_KEY, newerV2Id);
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID });

    expect(requestIds).toEqual([originalId, originalId]);
    expect(stored.get(V2_KEY)).toBe(newerV2Id);
    expect(stored.has(V3_KEY)).toBe(false);
  });

  it('serializes separate-tab clear/bind so a late response cannot remove a newer id', async () => {
    const requests = [];
    const completions = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requests.push(options.headers['Idempotency-Key']);
      return new Promise((resolve) => completions.push(resolve));
    }));
    const body = { action: 'save', line_update: { line_id: 'line-1', description: 'same patch' } };
    vi.resetModules();
    const otherTab = await import('./qboInvoiceWorker.js');

    const first = callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body });
    const late = otherTab.callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    completions[0](response(200, { ok: true }));
    await first;

    const newer = otherTab.callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID, body });
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]).not.toBe(requests[0]);
    completions[1](response(200, { ok: true }));
    await late;
    expect(await getQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save')).toBe(requests[2]);

    completions[2](response(503, { error: 'still pending', retry_same_request: true }));
    await expect(newer).rejects.toMatchObject({ retrySameRequest: true });
  });

  it('retires the id when a 5xx explicitly confirms no same-request retry', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) return response(503, { error: 'definitive rejection', retry_same_request: false });
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID })).rejects.toMatchObject({ retrySameRequest: false });
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID });

    expect(requestIds[1]).not.toBe(requestIds[0]);
  });

  it('retires the id after a definitive rejection so corrected input is a new command', async () => {
    const requestIds = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      if (requestIds.length === 1) {
        return response(422, { error: 'invalid invoice' });
      }
      return response(200, { ok: true });
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID })).rejects.toMatchObject({
      retrySameRequest: false,
    });
    await callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID });

    expect(requestIds[1]).not.toBe(requestIds[0]);
  });

  it('retains an ambiguous operation id through a module reload', async () => {
    const initial = await import('./qboInvoiceWorker.js');
    const firstId = await initial.getQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save');

    vi.resetModules();
    const reloaded = await import('./qboInvoiceWorker.js');

    expect(await reloaded.getQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save')).toBe(firstId);
    await reloaded.clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save');
  });

  it('does not share a pending operation id across signed-in accounts', async () => {
    const requestIds = [];
    const otherOwnerId = '00000000-0000-4000-8000-000000000002';
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestIds.push(options.headers['Idempotency-Key']);
      throw new Error('network response lost');
    }));

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID })).rejects.toThrow(/response lost/);
    await expect(callQboInvoiceWorker({ ownerId: otherOwnerId, invoiceId: INVOICE_ID })).rejects.toThrow(/response lost/);

    expect(requestIds[1]).not.toBe(requestIds[0]);
    await clearQboInvoiceOperationId(otherOwnerId, INVOICE_ID, 'save');
  });

  it('fails closed before fetch when durable pending storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('storage denied'); }),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn());

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID }))
      .rejects.toMatchObject({ code: 'qbo-operation-storage-unavailable', retrySameRequest: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed before fetch when cross-tab locking is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn());

    await expect(callQboInvoiceWorker({ ownerId: OWNER_ID, invoiceId: INVOICE_ID }))
      .rejects.toMatchObject({ code: 'qbo-operation-lock-unavailable', retrySameRequest: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
