/**
 * ════════════════════════════════════════════════
 * FILE: qboEstimateWorker.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that repeated estimate actions keep or clear their browser retry
 *   identity at the correct time. Network calls, browser storage, and tab locks
 *   are all local test doubles.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qboEstimateWorker.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These tests cover same-body retry, changed-body refusal, and tab races.
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { callQboEstimateWorker } from './qboEstimateWorker.js';

const OWNER = '00000000-0000-4000-8000-000000000001';
const ESTIMATE = '00000000-0000-4000-8000-000000000002';
let records;

function locks() {
  const tails = new Map();
  return {
    request(name, callback) {
      const result = (tails.get(name) || Promise.resolve()).catch(() => {}).then(callback);
      tails.set(name, result.catch(() => {}));
      return result;
    },
  };
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  json: async () => body,
});

beforeEach(() => {
  records = new Map();
  vi.stubGlobal('navigator', { locks: locks() });
  vi.stubGlobal('localStorage', {
    getItem: (key) => records.get(key) || null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QBO estimate browser command identity', () => {
  it('reuses one UUIDv4 after an ambiguous result and retires it after success', async () => {
    const ids = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      ids.push(options.headers['Idempotency-Key']);
      return ids.length === 1
        ? response(503, { error: 'outcome unknown', retry_same_request: true })
        : response(200, { ok: true });
    }));

    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE }))
      .rejects.toMatchObject({ retrySameRequest: true });
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE }))
      .resolves.toEqual({ ok: true });
    expect(ids[1]).toBe(ids[0]);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    await callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE });
    expect(ids[2]).not.toBe(ids[1]);
  });

  it('binds the pending id to the exact line mutation body before fetch', async () => {
    const original = { action: 'save', line_change: { kind: 'delete', line_id: '00000000-0000-4000-8000-000000000003' } };
    const changed = { action: 'save', line_change: { kind: 'delete', line_id: '00000000-0000-4000-8000-000000000004' } };
    vi.stubGlobal('fetch', vi.fn(async () => response(503, { error: 'unknown', retry_same_request: true })));

    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE, body: original }))
      .rejects.toMatchObject({ retrySameRequest: true });
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE, body: changed }))
      .rejects.toMatchObject({ status: 409, retrySameRequest: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps send, delete, and save identities separate', async () => {
    const ids = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      ids.push(options.headers['Idempotency-Key']);
      return response(503, { error: 'unknown', retry_same_request: true });
    }));
    for (const action of ['save', 'send', 'delete']) {
      await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE, body: { action } }))
        .rejects.toMatchObject({ retrySameRequest: true });
    }
    expect(new Set(ids).size).toBe(3);
  });

  it('preserves the id for a lost transport response and across a module reload', async () => {
    const ids = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      ids.push(options.headers['Idempotency-Key']);
      throw new Error('response lost');
    }));
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE })).rejects.toThrow('response lost');
    vi.resetModules();
    const reloaded = await import('./qboEstimateWorker.js');
    await expect(reloaded.callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE })).rejects.toThrow('response lost');
    expect(ids[1]).toBe(ids[0]);
  });

  it('never shares a pending identity across signed-in owners', async () => {
    const ids = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      ids.push(options.headers['Idempotency-Key']);
      throw new Error('response lost');
    }));
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE })).rejects.toThrow('response lost');
    await expect(callQboEstimateWorker({ ownerId: '00000000-0000-4000-8000-000000000099', estimateId: ESTIMATE })).rejects.toThrow('response lost');
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('serializes cross-tab compare-and-clear so a late response cannot erase a newer id', async () => {
    const ids = [];
    const completions = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      ids.push(options.headers['Idempotency-Key']);
      return new Promise((resolve) => completions.push(resolve));
    }));
    vi.resetModules();
    const otherTab = await import('./qboEstimateWorker.js');
    const first = callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE });
    const late = otherTab.callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE });
    await vi.waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[1]).toBe(ids[0]);

    completions[0](response(200, { ok: true }));
    await first;
    const newer = otherTab.callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE });
    await vi.waitFor(() => expect(ids).toHaveLength(3));
    expect(ids[2]).not.toBe(ids[0]);

    completions[1](response(200, { ok: true }));
    await late;
    const pending = [...records.values()].map((value) => {
      try { return JSON.parse(value); } catch { return null; }
    }).find((value) => value?.id);
    expect(pending?.id).toBe(ids[2]);

    completions[2](response(503, { error: 'still pending', retry_same_request: true }));
    await expect(newer).rejects.toMatchObject({ retrySameRequest: true });
  });

  it('retires the id after a definitive rejection so corrected input gets a new command', async () => {
    const ids = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      ids.push(options.headers['Idempotency-Key']);
      return ids.length === 1 ? response(422, { error: 'rejected' }) : response(200, { ok: true });
    }));
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE })).rejects.toMatchObject({ retrySameRequest: false });
    await callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE });
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('sends the closed endpoint body and caller auth without persisting body data', async () => {
    const body = { action: 'send', send_to: 'private@example.test' };
    vi.stubGlobal('fetch', vi.fn(async () => response(503, { error: 'unknown', retry_same_request: true })));
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE, authHeaders: { Authorization: 'Bearer jwt' }, body }))
      .rejects.toMatchObject({ retrySameRequest: true });
    const [, options] = fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ estimate_id: ESTIMATE, ...body });
    expect(options.headers.Authorization).toBe('Bearer jwt');
    expect(JSON.stringify([...records.entries()])).not.toContain('private@example.test');
  });

  it('fails closed before fetch when durable storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(), removeItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error('denied'); }),
    });
    vi.stubGlobal('fetch', vi.fn());
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE }))
      .rejects.toMatchObject({ retrySameRequest: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed before fetch when Web Locks is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn());
    await expect(callQboEstimateWorker({ ownerId: OWNER, estimateId: ESTIMATE }))
      .rejects.toMatchObject({ retrySameRequest: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
