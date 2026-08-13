/**
 * ════════════════════════════════════════════════
 * FILE: analyze-xactimate-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves every valid Xactimate request stops before documents, Storage, Anthropic, QuickBooks,
 *   invoice records, or financial lines while its durable operation owner is unavailable.
 *
 * DEPENDS ON:
 *   Packages:  Vitest
 *   Internal:  analyze-xactimate route with mocked authorization and database client
 *   Data:      reads  → mocked authentication only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - No provider, database, or network call leaves the test process.
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: null, db: null }));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboBrowserRequest: (...args) => state.auth(...args) }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => state.db }));

import { XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED, onRequestPost } from './analyze-xactimate.js';

const INVOICE_ID = '33333333-3333-4333-8333-333333333333';
const request = (body) => new Request('https://app.test/api/analyze-xactimate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body,
});

beforeEach(() => {
  state.auth = vi.fn(async () => ({ ok: true, employee: { id: 'employee-1' } }));
  state.db = {
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn(), rpc: vi.fn(),
    downloadStorage: vi.fn(), uploadStorage: vi.fn(),
  };
});

describe('Xactimate durable operation boundary', () => {
  it('refuses a valid request before business, Storage, AI, QBO, or financial work', async () => {
    const response = await onRequestPost({
      request: request(JSON.stringify({ invoice_id: INVOICE_ID, file_path: 'any-recorded-file.pdf' })),
      env: {},
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED,
      reason: XACTIMATE_IMPORT_DURABLE_BOUNDARY_REQUIRED,
    });
    for (const value of Object.values(state.db)) expect(value).not.toHaveBeenCalled();
  });

  it.each([
    ['{}', 'invoice_id must be a UUID'],
    [JSON.stringify({ invoice_id: INVOICE_ID }), 'Provide file_path'],
  ])('keeps cheap validation before containment', async (body, error) => {
    const response = await onRequestPost({ request: request(body), env: {} });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(state.db.select).not.toHaveBeenCalled();
  });

  it('keeps authorization denial before containment', async () => {
    state.auth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const response = await onRequestPost({
      request: request(JSON.stringify({ invoice_id: INVOICE_ID, file_path: 'file.pdf' })), env: {},
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(state.db.select).not.toHaveBeenCalled();
  });
});
