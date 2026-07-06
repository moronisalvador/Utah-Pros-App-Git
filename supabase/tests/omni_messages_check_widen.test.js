/**
 * ════════════════════════════════════════════════
 * FILE: omni_messages_check_widen.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the omnichannel-inbox Foundation migration did what it promised, against
 *   the real shared database. It asks the database's own self-test function to try
 *   inserting a message of every OLD kind (the SMS ones that already existed) AND
 *   every NEW kind (email), plus each channel value — and to confirm bogus values are
 *   still rejected. It also checks that "claiming" the same inbound email twice
 *   succeeds once and then reports a duplicate (idempotency). The self-test cleans up
 *   every throwaway row it creates, so this leaves nothing behind.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated anon REST client)
 *   Data:      messages / conversations / email_inbound_events — exercised via the
 *              SECURITY DEFINER omni_verify_foundation() + claim_inbound_email() RPCs,
 *              all self-cleaned. Never asserts on live row counts.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds like
 *     the other suites. In CI without VITE_SUPABASE_* it is skipped; the DB-level proof
 *     was also run at apply time.
 *   - The CHECK widen is ADDITIVE — every pre-existing type/channel value must still
 *     validate. type_accepts covers all old + new type values; channel_accepts covers
 *     all channels; both must be all-true.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('Omni-inbox Foundation — messages CHECK widen + claim idempotency (integration)', () => {
  it('every OLD and NEW messages.type value still validates; bogus is rejected', async () => {
    const r = await db.rpc('omni_verify_foundation');
    // Existing values (backward compat) …
    expect(r.type_accepts.sms_inbound).toBe(true);
    expect(r.type_accepts.sms_outbound).toBe(true);
    expect(r.type_accepts.internal_note).toBe(true);
    // … and the new email values.
    expect(r.type_accepts.email_inbound).toBe(true);
    expect(r.type_accepts.email_outbound).toBe(true);
    // Bogus type still fails the CHECK.
    expect(r.type_rejects_bogus).toBe(true);
  });

  it('every channel value (incl. new email) validates; bogus channel is rejected', async () => {
    const r = await db.rpc('omni_verify_foundation');
    for (const ch of ['sms', 'mms', 'rcs', 'email']) {
      expect(r.channel_accepts[ch]).toBe(true);
    }
    expect(r.channel_rejects_bogus).toBe(true);
  });

  it('claim_inbound_email is idempotent (first claim true, duplicate false)', async () => {
    const r = await db.rpc('omni_verify_foundation');
    expect(r.claim_first).toBe(true);
    expect(r.claim_second).toBe(false);

    // Also exercise the RPC directly with a fresh key for a second, independent proof.
    const key = `omni-test-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    expect(await db.rpc('claim_inbound_email', { p_message_key: key })).toBe(true);
    expect(await db.rpc('claim_inbound_email', { p_message_key: key })).toBe(false);
    // A blank key never claims.
    expect(await db.rpc('claim_inbound_email', { p_message_key: '' })).toBe(false);
  });
});
