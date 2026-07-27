/**
 * ════════════════════════════════════════════════
 * FILE: anon_closure_tranche_b.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the customer list is no longer readable by strangers, and that the
 *   parts of the app that legitimately use it did not break when we closed it.
 *
 *   Before this closure, anyone on the internet could read every contact we have
 *   — name, phone, email, billing address — and edit any of them, plus read every
 *   conversation and who was in it. No login required, because the key the website
 *   uses is public by design. These tests check a logged-out visitor is now
 *   refused, while the public signing page (the one surface that MUST keep working
 *   without a login) still answers.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — db lane; see NOTES, it does not run in `npm test`
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js — the unauthenticated anon REST client, i.e.
 *              exactly what a logged-out browser has
 *   Data:      reads  → contacts, conversations, conversation_participants
 *              writes → none (every write assertion expects a REFUSAL)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. An anon GRANT
 *     cannot be proven as a pure unit test. Self-skips without
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY so CI stays green.
 *   - This folder is the `db` lane, which `npm test` does NOT run (backlog 6.1).
 *     The CI-visible guard is tests/qa/unit/anon-closure-tranche-b.test.js, which
 *     proves intent only. THIS file is what proves effect, in the apply window.
 *   - The CLOSURE block is opt-in (RUN_TRANCHE_B=1), matching tranche (a): the
 *     revoke is RED-tier and lands in the owner's apply window, so before it
 *     applies these assertions would correctly fail. After the apply, run
 *     `RUN_TRANCHE_B=1 npm run test:db:local` (or the db lane runner).
 *   - Deliberately asserts REFUSAL, never a successful write. Every probe is
 *     scoped to values that cannot match a real row, so a regression that lets a
 *     write through still changes no customer data.
 *   - db.select THROWS on any non-OK response (it does not return [] on 403), so
 *     every negative assertion is a rejects.toThrow.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const nodeEnv = globalThis.process?.env || {};
const runClosure =
  hasCreds &&
  (import.meta.env.RUN_TRANCHE_B === '1' || nodeEnv.RUN_TRANCHE_B === '1');

const NOWHERE = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!runClosure)('anon closure tranche (b) — the customer list is shut', () => {
  it('refuses an anonymous read of contacts', async () => {
    // The exposure this closure exists for: the whole customer database, to anyone.
    await expect(db.select('contacts', 'select=id,name,phone,email&limit=1'))
      .rejects.toThrow();
  });

  it('refuses an anonymous edit of a contact', async () => {
    // Scoped to an id that cannot exist, so a regression still changes nothing.
    await expect(
      db.update('contacts', `id=eq.${NOWHERE}`, { name: 'tranche-b probe' }),
    ).rejects.toThrow();
  });

  it('refuses an anonymous insert of a contact', async () => {
    await expect(
      db.insert('contacts', { name: 'tranche-b probe', phone: '+15550000000' }),
    ).rejects.toThrow();
  });

  it('refuses an anonymous read of conversations', async () => {
    await expect(db.select('conversations', 'select=id&limit=1')).rejects.toThrow();
  });

  it('refuses an anonymous read of conversation_participants', async () => {
    // This one leaked which customer belongs to which thread.
    await expect(db.select('conversation_participants', 'select=contact_id&limit=1'))
      .rejects.toThrow();
  });

  it('refuses an anonymous edit of a conversation', async () => {
    await expect(
      db.update('conversations', `id=eq.${NOWHERE}`, { unread_count: 0 }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!runClosure)('anon closure tranche (b) — nothing legitimate broke', () => {
  it('leaves the public allowlist reachable (status page RPC still answers)', async () => {
    // database-standard.md §2 keeps /status anon-reachable. The canary for
    // over-broad revoking.
    const rows = await db.rpc('get_crm_build_progress', {});
    expect(rows).toBeTruthy();
  });

  it('keeps the public signing page answering without a login', async () => {
    // SignPage is the ONE logged-out surface, and it must survive this closure.
    // It reads none of the three tables — it calls this token-scoped RPC. A bad
    // token is expected to come back empty/null rather than permission-denied;
    // what matters is that the CALL itself is still permitted to anon.
    const rows = await db.rpc('get_sign_request_by_token', { p_token: 'tranche-b-probe-not-a-token' });
    expect(rows === null || Array.isArray(rows) || typeof rows === 'object').toBe(true);
  });
});
