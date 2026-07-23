/**
 * ════════════════════════════════════════════════
 * FILE: worker-runs.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves long-running workers can start and finish one shared run record, and
 *   that a logging failure never breaks the work being logged.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./worker-runs.js
 *   Data:      test fixtures only
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { finishWorkerRun, startWorkerRun } from './worker-runs.js';

describe('worker run lifecycle helpers', () => {
  it('returns the inserted run id and finishes the same row', async () => {
    const db = {
      insert: vi.fn().mockResolvedValue([{ id: 'run-1' }]),
      update: vi.fn().mockResolvedValue([{ id: 'run-1' }]),
    };

    const id = await startWorkerRun(db, 'encircle-backfill');
    await finishWorkerRun(db, id, {
      status: 'completed',
      records_processed: 3,
    });

    expect(id).toBe('run-1');
    expect(db.update).toHaveBeenCalledWith(
      'worker_runs',
      'id=eq.run-1',
      expect.objectContaining({ status: 'completed', records_processed: 3 }),
    );
  });

  it('swallows telemetry failures', async () => {
    const db = {
      insert: vi.fn().mockRejectedValue(new Error('offline')),
      update: vi.fn().mockRejectedValue(new Error('offline')),
    };

    await expect(startWorkerRun(db, 'encircle-backfill')).resolves.toBeNull();
    await expect(finishWorkerRun(db, 'run-1', { status: 'error' })).resolves.toBeUndefined();
  });
});
