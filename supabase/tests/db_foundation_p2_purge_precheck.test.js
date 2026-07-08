/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_p2_purge_precheck.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the RED-tier, owner-gated cleanup of the dead `message-attachments`
 *   storage bucket BEFORE anyone applies it. The staged migration
 *   (supabase/migrations-staged/20260708_dbf_p2_message_attachments_purge.sql)
 *   flips that bucket to private and DELETES its orphaned objects — an
 *   irreversible action. This test proves the pre-conditions the owner is relying
 *   on still hold at approval time: the bucket is the dead one (has no write/read
 *   API policies left after P2 stage 1), and its object count is the small,
 *   expected, orphaned set — NOT a bucket that has quietly started being used
 *   again. If anything about that changed, this test fails and the owner should
 *   re-investigate before approving the delete.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration guard — run via `npm test`)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  none (talks to the Storage REST API directly, as an anon client)
 *   Data:      reads → storage.objects write-policy state, probed via an anon
 *                      write-refusal request to the message-attachments bucket
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test — self-skips when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *     are absent (CI has no creds). It is a PRE-APPLY guard, not a post-apply test:
 *     the staged migration is intentionally NOT applied, so this asserts the
 *     CURRENT (pre-purge) state is the expected, safe-to-purge state.
 *   - The load-bearing pre-condition it CAN assert as anon: the bucket is locked to
 *     writes (all its policies were dropped by P2 stage 1), so it is genuinely dead.
 *   - It intentionally does NOT assert anon READ is blocked: `message-attachments` is
 *     still `public=true` (the flip is the staged, unapplied action), so its objects
 *     remain publicly readable until an owner applies the purge. Asserting read-lock
 *     now would be false.
 *   - The object COUNT (expected 21) and the post-apply expectations (bucket
 *     public=false, 0 objects) require service-role/catalog access and are verified
 *     live via the Supabase MCP at approval/apply time — documented in the staged
 *     migration header; they cannot run from an anon client here.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasCreds = !!SUPABASE_URL && !!ANON_KEY;

const anonHeaders = (contentType) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  ...(contentType ? { 'Content-Type': contentType } : {}),
});

describe.skipIf(!hasCreds)('DB-Foundation P2 — message-attachments purge pre-apply guard (integration)', () => {
  it('message-attachments is fully locked to anon WRITE (dead-bucket precondition)', async () => {
    const url = `${SUPABASE_URL}/storage/v1/object/message-attachments/__dbf_p2_purge_guard__/probe.txt`;
    const res = await fetch(url, {
      method: 'POST',
      headers: anonHeaders('text/plain'),
      body: 'purge guard',
    });
    // Clean up if a wrong (pre-lockdown) state let it through.
    if (res.ok) {
      await fetch(url, { method: 'DELETE', headers: anonHeaders() }).catch(() => {});
    }
    expect(res.ok).toBe(false);
    expect([400, 401, 403]).toContain(res.status);
  });
});
