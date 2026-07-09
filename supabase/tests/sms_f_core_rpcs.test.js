/**
 * ════════════════════════════════════════════════
 * FILE: sms_f_core_rpcs.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two Foundation database helpers for the texting system are locked
 *   down to logged-in/server callers only — a logged-OUT (anon) visitor must not be
 *   able to run them. This is the least-privilege half of F-core's proof; the
 *   atomicity ("exactly one winner", monotonic unread) half is the runnable SQL
 *   gate supabase/tests/sms_f_core_rpcs.sql (executed live via the Supabase MCP,
 *   because it needs a caller that CAN execute the RPCs — anon deliberately cannot).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated/anon REST client — CLAUDE.md
 *              rule 3 allows the anon singleton in a script/test)
 *   Data:      reads/writes → none. Only attempts (and expects rejection of) two
 *              RPC calls as anon: claim_scheduled_message, increment_conversation_unread.
 *
 * NOTES / GOTCHAS:
 *   - Integration test against the live shared Supabase (glsmljpabrwonfiltiqm). Needs
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.example); self-skips via
 *     describe.skipIf when absent, matching the CRM/DBF suites (CI's `npm test` step
 *     does not pass those secrets, so it does not fail CI red).
 *   - Both RPCs are SECURITY DEFINER, GRANT EXECUTE TO authenticated, service_role
 *     (never anon). PostgREST therefore does not expose them to the anon role, so an
 *     anon .rpc() call is rejected — that rejection IS the contract this asserts.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('SMS F-core RPC least-privilege (integration)', () => {
  it('anon CANNOT execute claim_scheduled_message (authenticated/service_role only)', async () => {
    await expect(
      db.rpc('claim_scheduled_message', { p_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });

  it('anon CANNOT execute increment_conversation_unread (authenticated/service_role only)', async () => {
    await expect(
      db.rpc('increment_conversation_unread', { p_conversation_id: '00000000-0000-0000-0000-000000000000', p_by: 1 }),
    ).rejects.toThrow();
  });
});
