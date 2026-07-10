/**
 * ════════════════════════════════════════════════
 * FILE: tech_msgs_v2_f_conversation_rpcs.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two Tech Messages v2 Foundation database helpers are locked down to
 *   logged-in / server callers only — a logged-OUT (anon) visitor must not be able
 *   to run them. This is the least-privilege half of F-M's proof; the shape/cursor/
 *   find-or-create-idempotency half is the runnable SQL gate
 *   supabase/tests/tech_msgs_v2_f_conversation_rpcs.sql (executed live via the
 *   Supabase MCP, because it needs a caller that CAN execute the RPCs — anon
 *   deliberately cannot).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated/anon REST client — CLAUDE.md
 *              rule 3 allows the anon singleton in a script/test)
 *   Data:      reads/writes → none. Only attempts (and expects rejection of) two RPC
 *              calls as anon: get_tech_conversations, find_or_create_conversation.
 *
 * NOTES / GOTCHAS:
 *   - Integration test against the live shared Supabase (glsmljpabrwonfiltiqm). Needs
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.example); self-skips via
 *     describe.skipIf when absent, matching the CRM/DBF/SMS suites (CI's `npm test`
 *     step does not pass those secrets, so it does not fail CI red).
 *   - Both RPCs are SECURITY DEFINER, GRANT EXECUTE TO authenticated, service_role
 *     (never anon; explicit REVOKE FROM PUBLIC, anon). PostgREST therefore does not
 *     expose them to the anon role, so an anon .rpc() call is rejected — that
 *     rejection IS the contract this asserts. find_or_create is called with a random
 *     uuid so that even if the guard ever regressed, no real thread is created.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('Tech Messages v2 F-M RPC least-privilege (integration)', () => {
  it('anon CANNOT execute get_tech_conversations (authenticated/service_role only)', async () => {
    await expect(db.rpc('get_tech_conversations', {})).rejects.toThrow();
  });

  it('anon CANNOT execute find_or_create_conversation (authenticated/service_role only)', async () => {
    await expect(
      db.rpc('find_or_create_conversation', { p_contact_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });
});
