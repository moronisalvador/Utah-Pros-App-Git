/**
 * ════════════════════════════════════════════════
 * FILE: notify_f1_push_subscriptions.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the push_subscriptions table is actually locked down against the
 *   public. Its rows (endpoint + p256dh + auth) are send-capability secrets —
 *   anyone holding them can push to a device — so the table has RLS on with NO
 *   policy and NO table grant, and its two RPCs are executable only by a
 *   signed-in user (they resolve the caller via auth.uid()). This test uses the
 *   UNAUTHENTICATED anon client to confirm all three doors are shut: you can't
 *   read the table, and you can't run either RPC without logging in.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (integration test)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (the UNAUTHENTICATED anon REST client)
 *   Data:      push_subscriptions (read attempt only — creates no rows)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other suites. Creates NO rows, so nothing to clean up.
 *   - The AUTHENTICATED own-row happy path (upsert/delete for the caller's own
 *     employee via auth.uid()) needs a real user JWT the vitest harness doesn't
 *     have; it's exercised by the browser subscribe flow (webPushClient) and the
 *     F1 owner gate. Here we lock down the anon boundary, which is the property
 *     that actually matters for the secret keys.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('Notify F1 — push_subscriptions is locked to owner-row RPCs (integration)', () => {
  it('anon cannot directly SELECT the secret table (RLS on, no policy, no grant)', async () => {
    // No table-level SELECT grant + RLS-with-no-policy → PostgREST denies anon.
    await expect(db.select('push_subscriptions', 'select=endpoint&limit=1')).rejects.toBeTruthy();
  });

  it('anon cannot EXECUTE upsert_push_subscription (granted to authenticated only)', async () => {
    await expect(db.rpc('upsert_push_subscription', {
      p_endpoint: 'https://example.invalid/anon-test',
      p_p256dh: 'x', p_auth: 'y',
    })).rejects.toBeTruthy();
  });

  it('anon cannot EXECUTE delete_push_subscription (granted to authenticated only)', async () => {
    await expect(db.rpc('delete_push_subscription', {
      p_endpoint: 'https://example.invalid/anon-test',
    })).rejects.toBeTruthy();
  });
});
