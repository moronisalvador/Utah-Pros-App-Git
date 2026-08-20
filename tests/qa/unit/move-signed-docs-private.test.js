/**
 * ════════════════════════════════════════════════
 * FILE: move-signed-docs-private.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the script that moves signed customer documents into the private
 *   bucket. The thing worth protecting is the ORDER it does things in: copy the
 *   file, then record its new home, then delete the old copy. Any other order
 *   makes a customer authorization briefly un-openable on a screen the owner
 *   requires to keep working, and nobody would notice from reading the code.
 *
 * WHY A SOURCE-CONTRACT TEST:
 *   The script talks to production Storage with the service-role key. There is
 *   no credential-free lane that can execute it, and a mock of Supabase Storage
 *   would prove only that the mock was written to match the script. So this
 *   asserts the properties that make the script safe to hand to the owner —
 *   the ordering, the dry-run default, the scope, and that the key is never
 *   printed — and the real proof is the --verify run against live afterwards.
 *   Stating that limit is the point; do not present this as behavioural cover.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SRC = readFileSync(join(ROOT, 'scripts/move-signed-docs-private.mjs'), 'utf8');

describe('signed-document privacy mover — safety contract', () => {
  it('defaults to a dry run; only --apply mutates', () => {
    expect(SRC).toMatch(/const APPLY = args\.has\('--apply'\)/);
    // The mutating block is reached only when APPLY is true.
    expect(SRC).toMatch(/if \(!APPLY\) \{/);
    expect(SRC).toContain('Re-run with --apply to do it.');
  });

  it('copies BEFORE flipping the row, and deletes the public copy LAST', () => {
    // The whole safety argument in one assertion. `storage_bucket` is what
    // switches the reader (src/lib/storageUrl.js bucketFor), so:
    //   copy  → both exist, row says public  → opens from public  ✓
    //   flip  → both exist, row says private → opens from private ✓
    //   delete→ only private, row private    → opens from private ✓
    // Reordering any pair of these opens a window where the document 404s.
    const block = SRC.slice(SRC.indexOf("if (state === 'todo')"));
    const iCopy = block.indexOf('await copyObject(key)');
    const iVerify = block.indexOf('await objectSize(PRIVATE_BUCKET, key)');
    const iFlip = block.indexOf('await setRowBucket(doc.id)');
    const iDelete = block.indexOf('await deleteObject(PUBLIC_BUCKET, key)');

    for (const [name, i] of Object.entries({ iCopy, iVerify, iFlip, iDelete })) {
      expect(i, `${name} must be present`).toBeGreaterThan(-1);
    }
    expect(iCopy).toBeLessThan(iVerify);
    expect(iVerify).toBeLessThan(iFlip);
    expect(iFlip).toBeLessThan(iDelete);
  });

  it('verifies the copy landed, and refuses on a size mismatch', () => {
    expect(SRC).toContain('copy reported success but the object is not there');
    expect(SRC).toMatch(/size mismatch/);
  });

  it('is scoped to e-sign documents only — job photos are Phase 2', () => {
    expect(SRC).toContain('sign_request_id=not.is.null');
    // No unscoped read of the whole table.
    expect(SRC).not.toMatch(/\/rest\/v1\/job_documents\?select=/);
  });

  it('reads the move set live, never from a hardcoded count', () => {
    // The roadmap's 1.1 exists because these numbers drift. 32 was true when
    // the script was written and is not a promise.
    expect(SRC).not.toMatch(/\b32\b/);
    expect(SRC).toContain('async function loadMoveSet()');
  });

  it('classifies from live state, so an interrupted run is resumable', () => {
    for (const state of ['done', 'orphan-public', 'copied-not-flipped', 'moved-not-flipped', 'todo']) {
      expect(SRC, state).toContain(`'${state}'`);
    }
    // The dangerous leftover: row already private, public copy still readable.
    // That is the exposure this whole exercise closes, so it must be swept.
    expect(SRC).toContain('a PUBLIC COPY REMAINS');
    const sweep = SRC.slice(SRC.indexOf("state === 'orphan-public'"));
    expect(sweep).toContain('await deleteObject(PUBLIC_BUCKET, key)');
  });

  it('stops on the first failure instead of grinding on', () => {
    expect(SRC).toContain('Stopped at the first failure, deliberately.');
  });

  it('halts before ANY change when a document is in neither bucket', () => {
    const guard = SRC.indexOf('byState.missing');
    const firstMutation = SRC.indexOf("if (state === 'todo')");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstMutation);
  });

  it('never prints the service-role key', () => {
    // It may be read, and it may be sent in a header. It may not be logged.
    const logs = SRC.match(/console\.(log|error)\([^\n]*\)/g) || [];
    for (const line of logs) {
      expect(line).not.toMatch(/SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|authHeaders/);
    }
    expect(SRC).toContain('IT NEVER PRINTS THE KEY');
  });

  it('tolerates the legacy job-files/ path prefix', () => {
    // 0 of the e-sign rows carry it today (roadmap E14), but the column holds
    // both shapes and a prefixed key would silently copy to the wrong name.
    expect(SRC).toMatch(/replace\(\/\^job-files\\\/\/, ''\)/);
  });
});
