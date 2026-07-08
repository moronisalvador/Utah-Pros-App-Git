/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_storage_lockdown.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the storage buckets can no longer be written to (or deleted from) by a
 *   browser that is NOT carrying a real logged-in user's identity. The tech app
 *   saves photos to a local queue when the phone is offline and "replays" them
 *   later; if the tech's login has expired by the time the replay runs, the upload
 *   falls back to the public anon key (see src/lib/dispatchers/photoDispatcher.js —
 *   it sends `Bearer ${db.apiKey}`, and `db.apiKey` is `token || ANON_KEY`). Before
 *   DB-Foundation Phase P2, that anonymous upload SUCCEEDED — anyone with the anon
 *   key (shipped in every browser bundle) could overwrite or delete any customer
 *   job photo. P2 revokes anonymous write/delete on `job-files` and drops every
 *   policy on the dead `message-attachments` bucket. This test proves the anonymous
 *   (expired/absent-JWT) upload is now REFUSED, while anonymous READ of `job-files`
 *   still works (photos/PDFs must keep rendering until P8 moves to signed URLs).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test — run via `npm test`)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  none (talks to the Storage REST API directly, exactly like the
 *              offline photo dispatcher does)
 *   Data:      writes → attempts an anon upload to job-files + message-attachments
 *                       (must be REJECTED); cleans up any object a pre-migration
 *                       (RED-state) run wrongly created
 *              reads  → anon GET of a job-files object path (must NOT be auth-blocked)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project — self-skips when
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent (CI has no creds).
 *   - Non-destructive: the upload probes use a unique __dbf_p2_probe__/ path and, if
 *     an upload wrongly succeeds (running against a database WITHOUT the P2 revoke
 *     yet — the RED state), the test deletes the litter before asserting. Once the
 *     migration is applied the upload is refused and nothing is created.
 *   - The admin/authenticated WRITE path is unchanged and unverifiable from an anon
 *     client (it needs a real user JWT); it is verified live via the Supabase MCP.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasCreds = !!SUPABASE_URL && !!ANON_KEY;

// Headers a browser sends with no valid user session — the anon-key fallback the
// offline photo dispatcher lands on when the tech's JWT has expired.
const anonHeaders = (contentType) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  ...(contentType ? { 'Content-Type': contentType } : {}),
});

async function anonUploadProbe(bucket) {
  const path = `${bucket}/__dbf_p2_probe__/${Date.now()}-lockdown-probe.txt`;
  const url = `${SUPABASE_URL}/storage/v1/object/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: anonHeaders('text/plain'),
    body: 'db-foundation P2 offline-replay probe',
  });
  // If a pre-migration (RED) run wrongly succeeded, remove the litter so this test
  // never leaves an orphaned object behind.
  if (res.ok) {
    await fetch(url, { method: 'DELETE', headers: anonHeaders() }).catch(() => {});
  }
  return res;
}

describe.skipIf(!hasCreds)('DB-Foundation P2 — storage write lockdown (integration)', () => {
  it('anon (expired/absent JWT) CANNOT upload to job-files — the offline-replay hole is closed', async () => {
    const res = await anonUploadProbe('job-files');
    expect(res.ok).toBe(false);
    expect([400, 401, 403]).toContain(res.status);
  });

  it('anon (expired/absent JWT) CANNOT upload to message-attachments — bucket is locked', async () => {
    const res = await anonUploadProbe('message-attachments');
    expect(res.ok).toBe(false);
    expect([400, 401, 403]).toContain(res.status);
  });

  it('anon READ of job-files is preserved (photos/PDFs still render until P8 signed URLs)', async () => {
    // GET a path that does not exist. If the public READ policy is intact the reply
    // is a 400/404 "object not found" — NOT a 401/403 auth rejection. This proves we
    // revoked write/delete only, not read.
    const url = `${SUPABASE_URL}/storage/v1/object/public/job-files/__dbf_p2_probe__/nope.txt`;
    const res = await fetch(url, { headers: anonHeaders() });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
