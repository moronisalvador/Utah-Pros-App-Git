/**
 * ════════════════════════════════════════════════
 * FILE: qboCatalog.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   Temporary QBO catalog failures retry without turning a read into an invoice
 *   write, while permanent failures stop immediately and category items stay out.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { isTransientQboCatalogError, loadQboCatalog } from './qboCatalog';

const responseFor = (query) => query.includes('FROM Item')
  ? { Item: [{ Id: 1, Name: 'Labor', Type: 'Service' }, { Id: 2, Name: 'Parent', Type: 'Category' }] }
  : { Class: [{ Id: 7, Name: 'Reconstruction' }] };

describe('loadQboCatalog', () => {
  it('retries a temporary 503 and returns the read-only item/class catalog', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    let itemAttempts = 0;
    const runQuery = vi.fn(async (query) => {
      if (query.includes('FROM Item') && itemAttempts++ === 0) {
        throw Object.assign(new Error('Service unavailable'), { status: 503 });
      }
      return responseFor(query);
    });

    await expect(loadQboCatalog(runQuery, { wait })).resolves.toEqual({
      items: [{ id: '1', name: 'Labor' }],
      classes: [{ id: '7', name: 'Reconstruction' }],
    });
    expect(wait).toHaveBeenCalledWith(250, undefined);
    expect(runQuery).toHaveBeenCalledTimes(4);
    expect(runQuery.mock.calls.every(([query]) => /^SELECT /.test(query))).toBe(true);
  });

  it('stops immediately for a non-transient provider response', async () => {
    const error = Object.assign(new Error('Forbidden'), { status: 403 });
    const runQuery = vi.fn().mockRejectedValue(error);
    const wait = vi.fn();

    await expect(loadQboCatalog(runQuery, { wait })).rejects.toBe(error);
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it('recognizes transport, timeout, throttling, and server failures as transient', () => {
    expect(isTransientQboCatalogError(new TypeError('offline'))).toBe(true);
    expect(isTransientQboCatalogError({ status: 408 })).toBe(true);
    expect(isTransientQboCatalogError({ status: 429 })).toBe(true);
    expect(isTransientQboCatalogError({ status: 503 })).toBe(true);
    expect(isTransientQboCatalogError({ status: 401 })).toBe(false);
  });
});
