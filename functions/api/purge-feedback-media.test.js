/**
 * ════════════════════════════════════════════════
 * FILE: purge-feedback-media.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the feedback-media purge worker deletes the right files and, just
 *   as importantly, never deletes the wrong ones. It checks that reading paths
 *   out of an attachment list copes with the old skinny "{path only}" shape,
 *   and it drives the purge engine with fake stand-ins for the database and
 *   the storage service to prove: a dry run touches nothing, a failed storage
 *   delete leaves the row un-marked so it tries again next time, a "file
 *   already gone" still counts as done, every run (even an empty one) leaves a
 *   record behind, and the leftover-file sweep only ever removes old, truly
 *   unreferenced feedback files.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./purge-feedback-media.js (system under test). The DB and the
 *              storage delete/list transports are injected as fakes — no
 *              network, no mocks.
 *
 * NOTES / GOTCHAS:
 *   - runPurge(db, storageDelete, opts) is the injectable seam. `now`,
 *     `storageList`, `days`, `dryRun` are all opts so every branch runs with
 *     no clock and no network.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { runPurge, collectPaths, stripBucketPrefix } from './purge-feedback-media.js';

const NOW = new Date('2026-07-10T00:00:00Z');
const daysAgoISO = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

// A minimal fake DB: get_purgeable rows in, mark/insert captured out.
function makeDb({ purgeable = [], feedbackRows = [], markThrows = false } = {}) {
  const inserts = [];
  const marked = [];
  const db = {
    async rpc(fn, params = {}) {
      if (fn === 'get_purgeable_feedback_media') return purgeable;
      if (fn === 'mark_feedback_attachments_purged') {
        if (markThrows) throw new Error('mark boom');
        marked.push(params.p_id);
        return { id: params.p_id };
      }
      return null;
    },
    async select(table) {
      if (table === 'tech_feedback') return feedbackRows;
      return [];
    },
    async insert(table, data) {
      inserts.push({ table, data });
      return [data];
    },
  };
  return { db, inserts, marked };
}

// A storageDelete spy with a scripted result; records every call's paths.
function makeStorageDelete(result = { ok: true, deleted: undefined }) {
  const calls = [];
  const fn = async (paths) => {
    calls.push(paths);
    return typeof result === 'function' ? result(paths) : result;
  };
  fn.calls = calls;
  return fn;
}

describe('collectPaths / stripBucketPrefix', () => {
  it('strips the legacy job-files/ bucket prefix', () => {
    expect(stripBucketPrefix('job-files/feedback/e/a.jpg')).toBe('feedback/e/a.jpg');
    expect(stripBucketPrefix('feedback/e/a.jpg')).toBe('feedback/e/a.jpg');
    expect(stripBucketPrefix(null)).toBe('');
  });

  it('reads paths from legacy {path}-only elements, full records, and bare strings', () => {
    const attachments = [
      { path: 'feedback/e/legacy.jpg' },                              // legacy skinny record
      { path: 'job-files/feedback/e/bucketed.jpg', mime: 'image/jpeg', size: 10 }, // full record, bucket-prefixed
      'feedback/e/bare-string.jpg',                                    // defensive: bare string
      { name: 'no-path.jpg' },                                         // no path → dropped
      null,                                                            // junk → dropped
    ];
    expect(collectPaths(attachments)).toEqual([
      'feedback/e/legacy.jpg',
      'feedback/e/bucketed.jpg',
      'feedback/e/bare-string.jpg',
    ]);
  });

  it('returns [] for a non-array / empty attachments value', () => {
    expect(collectPaths(null)).toEqual([]);
    expect(collectPaths([])).toEqual([]);
    expect(collectPaths('nope')).toEqual([]);
  });
});

describe('runPurge — retention pass', () => {
  const oneRow = [{ id: 'fb-1', attachments: [{ path: 'feedback/e/a.jpg' }, { path: 'feedback/e/b.jpg' }] }];

  it('dry run marks nothing and deletes nothing, but still logs a run', async () => {
    const { db, inserts, marked } = makeDb({ purgeable: oneRow });
    const del = makeStorageDelete();
    const res = await runPurge(db, del, { dryRun: true, now: () => NOW });

    expect(marked).toEqual([]);
    expect(del.calls).toEqual([]);
    expect(res.dry_run).toBe(true);
    expect(res.purged).toBe(0);
    expect(res.checked).toBe(1);
    expect(inserts.filter(i => i.table === 'worker_runs')).toHaveLength(1);
  });

  it('a storage transport error skips marking so the row retries next run', async () => {
    const { db, marked } = makeDb({ purgeable: oneRow });
    const del = makeStorageDelete({ ok: false, error: 'network down' });
    const res = await runPurge(db, del, { now: () => NOW });

    expect(del.calls).toHaveLength(1);
    expect(marked).toEqual([]);            // NOT marked → get_purgeable returns it again next run
    expect(res.purged).toBe(0);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(1);
  });

  it('storage "not found" (ok, 0 removed) counts as success and marks the row', async () => {
    const { db, marked } = makeDb({ purgeable: oneRow });
    const del = makeStorageDelete({ ok: true, deleted: 0 });
    const res = await runPurge(db, del, { now: () => NOW });

    expect(marked).toEqual(['fb-1']);
    expect(res.purged).toBe(1);
    expect(res.ok).toBe(true);
  });

  it('marks the row and counts files on a normal delete', async () => {
    const { db, marked } = makeDb({ purgeable: oneRow });
    const del = makeStorageDelete({ ok: true, deleted: 2 });
    const res = await runPurge(db, del, { now: () => NOW });

    expect(del.calls[0]).toEqual(['feedback/e/a.jpg', 'feedback/e/b.jpg']);
    expect(marked).toEqual(['fb-1']);
    expect(res.files_deleted).toBe(2);
  });

  it('a mark failure after a good delete is recorded as an error, not swallowed', async () => {
    const { db } = makeDb({ purgeable: oneRow, markThrows: true });
    const del = makeStorageDelete({ ok: true, deleted: 2 });
    const res = await runPurge(db, del, { now: () => NOW });

    expect(res.ok).toBe(false);
    expect(res.errors.length).toBe(1);
  });
});

describe('runPurge — empty run', () => {
  it('still writes a worker_runs row when nothing is purgeable', async () => {
    const { db, inserts } = makeDb({ purgeable: [] });
    const del = makeStorageDelete();
    const res = await runPurge(db, del, { now: () => NOW });

    const runs = inserts.filter(i => i.table === 'worker_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].data.worker_name).toBe('purge-feedback-media');
    expect(runs[0].data.status).toBe('completed');
    expect(res.checked).toBe(0);
    expect(res.purged).toBe(0);
  });
});

describe('runPurge — orphan sweep', () => {
  // Only feedback/-prefix objects, unreferenced by any row, older than 7 days.
  function orphanFixture() {
    const feedbackRows = [
      { attachments: [{ path: 'feedback/e1/keep.jpg' }], screenshots: ['job-files/feedback/e1/legacy-keep.jpg'] },
    ];
    const objects = [
      { path: 'feedback/e1/keep.jpg', updated_at: daysAgoISO(30) },          // referenced → keep
      { path: 'feedback/e1/legacy-keep.jpg', updated_at: daysAgoISO(30) },   // referenced via screenshots → keep
      { path: 'feedback/e2/orphan-old.jpg', updated_at: daysAgoISO(10) },    // orphan + old → DELETE
      { path: 'feedback/e2/orphan-recent.jpg', updated_at: daysAgoISO(2) },  // orphan but recent → keep
      { path: 'other/not-feedback.jpg', updated_at: daysAgoISO(99) },        // wrong prefix → keep (defensive)
    ];
    return { feedbackRows, objects };
  }

  it('deletes only old, unreferenced feedback/ objects', async () => {
    const { feedbackRows, objects } = orphanFixture();
    const { db, marked } = makeDb({ purgeable: [], feedbackRows });
    const del = makeStorageDelete({ ok: true, deleted: 1 });
    const res = await runPurge(db, del, {
      now: () => NOW,
      storageList: async () => objects,
    });

    expect(del.calls).toHaveLength(1);
    expect(del.calls[0]).toEqual(['feedback/e2/orphan-old.jpg']);
    expect(marked).toEqual([]);            // orphan sweep never marks rows
    expect(res.orphans).toBe(1);
    expect(res.files_deleted).toBe(1);
  });

  it('dry run reports orphan candidates without deleting them', async () => {
    const { feedbackRows, objects } = orphanFixture();
    const { db } = makeDb({ purgeable: [], feedbackRows });
    const del = makeStorageDelete({ ok: true, deleted: 1 });
    const res = await runPurge(db, del, {
      dryRun: true,
      now: () => NOW,
      storageList: async () => objects,
    });

    expect(del.calls).toEqual([]);
    expect(res.orphans).toBe(1);           // would-delete count reported
    expect(res.files_deleted).toBe(0);     // but nothing actually deleted
  });

  it('skips the sweep entirely when no storageList is injected', async () => {
    const { db } = makeDb({ purgeable: [] });
    const del = makeStorageDelete();
    const res = await runPurge(db, del, { now: () => NOW });
    expect(del.calls).toEqual([]);
    expect(res.orphans).toBe(0);
  });
});
