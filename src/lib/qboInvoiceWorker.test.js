/**
 * ════════════════════════════════════════════════
 * FILE: qboInvoiceWorker.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that browser invoice actions keep one safe operation id while a
 *   result is uncertain, then replace it after a confirmed outcome.
 *   It also checks that one signed-in user cannot reuse another user's id.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qboInvoiceWorker.js
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
} from './qboInvoiceWorker.js';

const INVOICE_ID = '00000000-0000-4000-8000-00000000aaaa';
const OWNER_ID = '00000000-0000-4000-8000-000000000001';
let stored;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    json: async () => body,
  };
}

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  });
  clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save');
  clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'send');
  clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'delete');
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
    const firstId = initial.getQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save');

    vi.resetModules();
    const reloaded = await import('./qboInvoiceWorker.js');

    expect(reloaded.getQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save')).toBe(firstId);
    reloaded.clearQboInvoiceOperationId(OWNER_ID, INVOICE_ID, 'save');
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
    clearQboInvoiceOperationId(otherOwnerId, INVOICE_ID, 'save');
  });
});
