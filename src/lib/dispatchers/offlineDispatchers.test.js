/**
 * ════════════════════════════════════════════════
 * FILE: offlineDispatchers.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Preserves contract tests for dormant historical dispatch helpers without
 *   claiming that any helper is imported, admitted, or replayed in production.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  photo/reading/equipment dispatchers (fake db/rpc injected)
 *
 * NOTES / GOTCHAS:
 *   - No real IndexedDB, Storage, or Supabase project is touched.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const offlineFakes = vi.hoisted(() => ({
  QUEUE_CLAIM_TTL_MS: 120_000,
  deletePhoto: vi.fn(async () => true),
  getPhotoBlob: vi.fn(async () => ({
    blob: new Blob(['photo'], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    uploadedBy: 'emp-1',
    jobId: 'job-1',
    name: '../field photo.jpg',
  })),
  recordIdSwap: vi.fn(async () => true),
  resolveIdSwap: vi.fn(async (value) => value),
  isStableQueueOperationId: vi.fn(() => true),
}));

vi.mock('../offlineDb', () => offlineFakes);

import {
  PHOTO_UPLOAD_TIMEOUT_MS,
  dispatchPhoto,
} from './photoDispatcher';
import { dispatchReading } from './readingDispatcher';
import {
  dispatchEquipmentPlace,
  dispatchEquipmentRemove,
} from './equipmentDispatcher';

const employee = { id: 'emp-1' };
const ownerLease = {
  owner: 'v1.aaaaaaaaaaaa',
  epoch: 'e1.session-a',
};

function queueItem(clientId, type) {
  return {
    clientId,
    operationId: clientId,
    owner: ownerLease.owner,
    type,
  };
}

beforeEach(() => {
  for (const fake of Object.values(offlineFakes)) {
    if (typeof fake?.mockClear === 'function') fake.mockClear();
  }
});

describe('stable operation identity and owned auxiliary reads', () => {
  it('keeps the dormant reading helper bound to its immutable operation ID', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'server-reading' });
    const item = {
      ...queueItem('reading-operation', 'reading.insert'),
      createdAt: Date.parse('2026-07-26T12:00:00.000Z'),
    };
    await dispatchReading(
      { rpc },
      employee,
      {
        clientId: item.operationId,
        jobId: 'job-1',
        material: 'drywall',
        isAffected: true,
      },
      item,
      ownerLease,
    );

    expect(rpc).toHaveBeenCalledWith('insert_reading', expect.objectContaining({
      p_client_id: 'reading-operation',
      p_taken_at: '2026-07-26T12:00:00.000Z',
    }));
  });

  it('keeps the dormant placement helper bound to its immutable operation ID', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'server-equipment' });
    const item = queueItem('equipment-operation', 'equipment.place');
    await dispatchEquipmentPlace(
      { rpc },
      employee,
      {
        clientId: item.operationId,
        jobId: 'job-1',
        equipmentType: 'dehumidifier',
      },
      item,
      ownerLease,
    );

    expect(rpc).toHaveBeenCalledWith('place_equipment', expect.objectContaining({
      p_client_id: 'equipment-operation',
      p_equipment_type: 'dehumidifier',
    }));
    expect(offlineFakes.recordIdSwap).toHaveBeenCalledWith(
      'equipment-operation',
      'server-equipment',
      ownerLease,
    );
  });

  it('keeps the dormant removal helper outside any replay guarantee', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'equipment-1' });
    const item = queueItem('remove-operation', 'equipment.remove');
    await dispatchEquipmentRemove(
      { rpc },
      employee,
      {
        equipmentId: 'equipment-1',
        removedBy: 'emp-1',
      },
      item,
      ownerLease,
    );

    expect(rpc).toHaveBeenCalledWith('remove_equipment', {
      p_equipment_id: 'equipment-1',
      p_removed_by: 'emp-1',
    });
  });

  it('reads/deletes a photo through its owner and uses a stable object path', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'server-photo' });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchImpl);
    const item = queueItem('photo-operation', 'photo.upload');

    const result = await dispatchPhoto(
      {
        apiKey: 'public-test-key',
        baseUrl: 'https://example.test',
        rpc,
      },
      employee,
      {
        clientId: item.operationId,
        jobId: 'job-1',
        name: '../field photo.jpg',
      },
      item,
      ownerLease,
    );

    expect(offlineFakes.getPhotoBlob).toHaveBeenCalledWith(
      'photo-operation',
      ownerLease,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/storage/v1/object/job-files/job-1/offline/photo-operation-field_photo.jpg',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-upsert': 'false' }),
      }),
    );
    expect(offlineFakes.deletePhoto).not.toHaveBeenCalled();
    await result.cleanup();
    expect(offlineFakes.deletePhoto).toHaveBeenCalledWith(
      'photo-operation',
      ownerLease,
    );
    vi.unstubAllGlobals();
  });

  it('aborts a hung photo upload before the queue claim can expire', async () => {
    const item = queueItem('photo-operation', 'photo.upload');
    const clearTimeoutImpl = vi.fn();
    const fetchImpl = vi.fn(async (_url, { signal }) => {
      if (signal.aborted) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return { ok: true };
    });

    await expect(dispatchPhoto(
      {
        apiKey: 'public-test-key',
        baseUrl: 'https://example.test',
        rpc: vi.fn(),
      },
      employee,
      {
        clientId: item.operationId,
        jobId: 'job-1',
        name: '../field photo.jpg',
      },
      item,
      ownerLease,
      {
        fetchImpl,
        setTimeoutImpl: (callback) => {
          callback();
          return 9;
        },
        clearTimeoutImpl,
      },
    )).rejects.toThrow(/timed out before queue claim expiry/i);
    expect(PHOTO_UPLOAD_TIMEOUT_MS).toBeLessThan(
      offlineFakes.QUEUE_CLAIM_TTL_MS,
    );
    expect(clearTimeoutImpl).toHaveBeenCalledWith(9);
  });
});
