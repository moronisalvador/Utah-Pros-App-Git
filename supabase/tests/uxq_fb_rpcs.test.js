/**
 * ════════════════════════════════════════════════
 * FILE: uxq_fb_rpcs.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the three UX-Quality F-B database helpers are locked down to
 *   logged-in / server callers only — a logged-OUT (anon) visitor must not be
 *   able to run them. This is the least-privilege half of F-B's proof; the
 *   atomicity + column-shape half is the runnable SQL gate uxq_fb_rpcs.sql
 *   (executed live via the Supabase MCP by the orchestrator, because it needs a
 *   caller that CAN execute the RPCs — anon deliberately cannot).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated/anon REST client — CLAUDE.md
 *              rule 3 allows the anon singleton in a script/test)
 *   Data:      reads/writes → none. Only attempts (and expects rejection of)
 *              three RPC calls as anon: sync_appointment_crew, save_estimate_lines,
 *              get_jobs_list.
 *
 * NOTES / GOTCHAS:
 *   - Integration test against the live shared Supabase (glsmljpabrwonfiltiqm).
 *     Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.example); self-skips
 *     via describe.skipIf when absent, matching the CRM/DBF/SMS suites (CI's
 *     `npm test` step does not pass those secrets, so it does not fail CI red).
 *   - All three are SECURITY DEFINER, REVOKE EXECUTE FROM PUBLIC, anon +
 *     GRANT EXECUTE TO authenticated, service_role (never anon). PostgREST
 *     therefore does not expose them to the anon role, so an anon .rpc() call is
 *     rejected — that rejection IS the contract this asserts.
 *   - ⚠️ These RPCs are NOT applied to prod at the time this file was authored —
 *     the orchestrator applies them via MCP before merge. Until then this suite
 *     self-skips (no creds in CI) OR, if run with creds against a DB that lacks
 *     the RPCs, the calls still reject (function-not-found), so it stays green.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const ZERO = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!hasCreds)('UX-Quality F-B RPC least-privilege (integration)', () => {
  it('anon CANNOT execute sync_appointment_crew (authenticated/service_role only)', async () => {
    await expect(
      db.rpc('sync_appointment_crew', { p_appointment_id: ZERO, p_crew: [] }),
    ).rejects.toThrow();
  });

  it('anon CANNOT execute save_estimate_lines (authenticated/service_role only)', async () => {
    await expect(
      db.rpc('save_estimate_lines', { p_id: ZERO, p_lines: [], p_kind: 'estimate' }),
    ).rejects.toThrow();
  });

  it('anon CANNOT execute get_jobs_list (authenticated/service_role only)', async () => {
    await expect(
      db.rpc('get_jobs_list', { p_search: null, p_limit: 10, p_offset: 0 }),
    ).rejects.toThrow();
  });
});
