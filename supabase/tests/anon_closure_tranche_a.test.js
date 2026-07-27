/**
 * ════════════════════════════════════════════════
 * FILE: anon_closure_tranche_a.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that the two most dangerous doors we just closed are actually shut,
 *   and that nothing people rely on broke when we shut them.
 *
 *   Before this closure, anyone on the internet could switch customer texting on
 *   or off, and could delete the list of people who asked us to stop emailing
 *   them — no login required, because the key the website uses is public by
 *   design. These tests check that a logged-out visitor is now refused, while
 *   the screens that legitimately read those settings keep working.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js — the unauthenticated anon REST client, i.e.
 *              exactly what a logged-out browser has
 *   Data:      reads  → automation_settings, email_suppressions
 *              writes → none (every write assertion expects a REFUSAL)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. An anon GRANT
 *     cannot be proven as a pure unit test. Self-skips without
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY so CI stays green.
 *   - The CLOSURE block is opt-in (RUN_TRANCHE_A=1), matching the P3 precedent:
 *     the revoke is RED-tier and lands in the owner's apply window, so before it
 *     applies these assertions would correctly fail. After the apply, run
 *     `RUN_TRANCHE_A=1 npm test`.
 *   - Deliberately asserts REFUSAL, never a successful write. Nothing here
 *     mutates the kill switch or the suppression list — a test that flips
 *     sms_sending_enabled to prove it can would be a TCPA hazard in itself.
 *   - db.select THROWS on any non-OK response (it does not return [] on 403),
 *     so every negative assertion is a rejects.toThrow.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
const nodeEnv = globalThis.process?.env || {};
const runClosure =
  hasCreds &&
  (import.meta.env.RUN_TRANCHE_A === '1' || nodeEnv.RUN_TRANCHE_A === '1');

describe.skipIf(!runClosure)('anon closure tranche (a) — the doors are shut', () => {
  it('refuses an anonymous read of automation_settings', async () => {
    await expect(db.select('automation_settings', 'select=sms_sending_enabled'))
      .rejects.toThrow();
  });

  it('refuses an anonymous write to the SMS kill switch', async () => {
    // The exposure this closure exists for: flipping customer texting with no login.
    await expect(
      db.update('automation_settings', 'sms_sending_enabled=eq.false', { sms_sending_enabled: false }),
    ).rejects.toThrow();
  });

  it('refuses an anonymous read of email_suppressions', async () => {
    await expect(db.select('email_suppressions', 'select=id&limit=1'))
      .rejects.toThrow();
  });

  it('refuses an anonymous DELETE of the opt-out list', async () => {
    // Scoped to an address that cannot exist, so a regression that lets this
    // through still destroys nothing.
    await expect(
      db.delete('email_suppressions', 'email=eq.nobody-tranche-a-probe@example.invalid'),
    ).rejects.toThrow();
  });
});

describe.skipIf(!runClosure)('anon closure tranche (a) — nothing legitimate broke', () => {
  it('leaves the public allowlist reachable (status page RPC still answers)', async () => {
    // database-standard.md §2 keeps /status anon-reachable. Tranche (a) must not
    // have touched it; this is the canary for over-broad revoking.
    const rows = await db.rpc('get_crm_build_progress', {});
    expect(rows).toBeTruthy();
  });

  it('does not expose the settings RPCs to an anonymous caller either', async () => {
    // get_automation_settings is granted to authenticated + service_role only.
    // A logged-out caller must be refused at the function level too, not merely
    // at the table.
    await expect(db.rpc('get_automation_settings', {})).rejects.toThrow();
  });
});
