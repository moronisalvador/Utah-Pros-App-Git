/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-accounting-request-id.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves QuickBooks Accounting writes carry Intuit's URI request id so a lost
 *   response can be retried without repeating the provider side effect.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  quickbooks.js; Supabase and HTTP are test doubles.
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Accounting uses `requestid` in the URI. The separate Payments API uses
 *     the `Request-Id` header; these contracts must not be interchanged.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ requests: [], responses: [] }));

vi.mock('./supabase.js', () => ({
  supabase: () => ({
    select: vi.fn(async () => [{
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      realm_id: 'test-realm',
      environment: 'sandbox',
    }]),
  }),
}));

vi.mock('./http.js', () => ({
  fetchWithTimeout: vi.fn(async (url, options) => {
    harness.requests.push({ url, options });
    return harness.responses.shift() || {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ Invoice: { Id: 'qbo-1', DocNumber: 'W-1' } }),
      text: async () => '',
    };
  }),
}));

import {
  createCustomer,
  createInvoice,
  customerCreateRequestId,
  deleteInvoice,
  relinkQboCustomer,
  withAccountingRequestId,
} from './quickbooks.js';

beforeEach(() => {
  harness.requests.length = 0;
  harness.responses.length = 0;
});

describe('QuickBooks Accounting request-id contract', () => {
  it('puts the stable key in the Accounting URI and never leaks it as a fetch option', async () => {
    const requestId = `upr-i-c-${'a'.repeat(40)}`;

    await createInvoice({}, { CustomerRef: { value: '1' }, Line: [] }, { requestId });

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0].url).toBe(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/test-realm/invoice?minorversion=70&requestid=${requestId}`,
    );
    expect(harness.requests[0].options.requestId).toBeUndefined();
  });

  it('derives a stable, separated customer request ID and forwards it to QBO', async () => {
    const primary = await customerCreateRequestId('realm-1', 'contact-1', 'primary');
    const duplicate = await customerCreateRequestId('realm-1', 'contact-1', 'disambiguated');

    expect(primary).toMatch(/^upr-c-[a-f0-9]{44}$/);
    expect(primary).toHaveLength(50);
    expect(await customerCreateRequestId('realm-1', 'contact-1', 'primary')).toBe(primary);
    expect(duplicate).not.toBe(primary);
    expect(await customerCreateRequestId('realm-2', 'contact-1', 'primary')).not.toBe(primary);
    expect(await customerCreateRequestId('realm-1', 'contact-2', 'primary')).not.toBe(primary);

    await createCustomer({}, { DisplayName: 'Test Customer' }, { requestId: primary });

    expect(harness.requests.at(-1).url).toBe(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/test-realm/customer?minorversion=70&requestid=${primary}`,
    );
    expect(harness.requests.at(-1).options.requestId).toBeUndefined();
  });

  it('uses the customer request identity and preserves a concurrent relink winner', async () => {
    harness.responses.push({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ Customer: { Id: 'qbo-created' } }),
      text: async () => '',
    });
    const db = {
      select: vi.fn(async (_table, query) => query.includes('select=id,qbo_customer_id')
        ? [{ id: 'contact-1', qbo_customer_id: 'qbo-concurrent-winner' }]
        : [{ id: 'contact-1', name: 'Alex Customer', qbo_customer_id: 'qbo-stale' }]),
      update: vi.fn(async () => []),
    };

    await expect(relinkQboCustomer({}, db, 'contact-1')).resolves.toEqual({
      id: 'qbo-concurrent-winner',
      matchedBy: 'concurrent',
    });

    const requestId = await customerCreateRequestId('test-realm', 'contact-1', 'primary');
    expect(harness.requests.at(-1).url).toContain(`requestid=${requestId}`);
    expect(db.update).toHaveBeenCalledWith(
      'contacts',
      'id=eq.contact-1&qbo_customer_id=eq.qbo-stale',
      expect.objectContaining({ qbo_customer_id: 'qbo-created', qbo_sync_error: null }),
    );
  });

  it('replaces the stale stored customer only when that exact mapping still wins the CAS', async () => {
    harness.responses.push({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ Customer: { Id: 'qbo-relinked' } }),
      text: async () => '',
    });
    const db = {
      select: vi.fn(async () => [{ id: 'contact-1', name: 'Alex Customer', qbo_customer_id: 'qbo-stale' }]),
      update: vi.fn(async () => [{ id: 'contact-1', qbo_customer_id: 'qbo-relinked' }]),
    };

    await expect(relinkQboCustomer({}, db, 'contact-1')).resolves.toEqual({
      id: 'qbo-relinked',
      matchedBy: 'created',
    });
    expect(db.update).toHaveBeenCalledWith(
      'contacts',
      'id=eq.contact-1&qbo_customer_id=eq.qbo-stale',
      expect.objectContaining({ qbo_customer_id: 'qbo-relinked', qbo_sync_error: null }),
    );
  });

  it('rejects unsafe or oversized keys and appends safely to paths with or without a query', () => {
    expect(withAccountingRequestId('/invoice', 'upr-safe_1')).toBe('/invoice?requestid=upr-safe_1');
    expect(withAccountingRequestId('/invoice?operation=delete', 'upr-safe_2'))
      .toBe('/invoice?operation=delete&requestid=upr-safe_2');
    expect(() => withAccountingRequestId('/invoice', 'x'.repeat(51))).toThrow(/1-50 safe/);
    expect(() => withAccountingRequestId('/invoice', 'contains space')).toThrow(/1-50 safe/);
  });

  it('does not treat an unauthorized delete preflight as an already-missing invoice', async () => {
    harness.responses.push({
      ok: false,
      status: 401,
      headers: { get: () => 'tid-401' },
      json: async () => ({ Fault: { Error: [{ code: '3200' }] } }),
      text: async () => 'unauthorized',
    });
    await expect(deleteInvoice({}, 'qbo-1', { missingIsSuccess: true }))
      .rejects.toThrow('QBO invoice query before delete failed (401)');
    expect(harness.requests).toHaveLength(1);
  });

  it('does not treat a 5xx non-JSON delete preflight as an already-missing invoice', async () => {
    harness.responses.push({
      ok: false,
      status: 503,
      headers: { get: () => 'tid-503' },
      json: async () => { throw new SyntaxError('Unexpected token <'); },
      text: async () => '<html>temporarily unavailable</html>',
    });
    await expect(deleteInvoice({}, 'qbo-1', { missingIsSuccess: true }))
      .rejects.toThrow('QBO invoice query before delete failed (503)');
    expect(harness.requests).toHaveLength(1);
  });

  it('allows already-missing cleanup only after a successful parsed query confirms no invoice', async () => {
    harness.responses.push({
      ok: true,
      status: 200,
      headers: { get: () => 'tid-no-match' },
      json: async () => ({ QueryResponse: {} }),
      text: async () => '',
    });

    await expect(deleteInvoice({}, 'qbo-1', { missingIsSuccess: true }))
      .resolves.toEqual({ deleted: false, missing: true });
    expect(harness.requests).toHaveLength(1);
  });
});
