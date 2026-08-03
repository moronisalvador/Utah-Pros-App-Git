/**
 * ════════════════════════════════════════════════
 * FILE: notify_f1_push_subscriptions.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the push_subscriptions table is actually locked down against the
 *   public. Its rows (endpoint + p256dh + auth) are send-capability secrets —
 *   anyone holding them can push to a device — so the table has RLS on with NO
 *   read policy, and its two RPCs are executable only by a signed-in user (they
 *   resolve the caller via auth.uid()). This test uses the UNAUTHENTICATED anon
 *   client to confirm all three doors are shut: no rows are visible, and neither
 *   RPC can run without logging in.
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
 *   - INTEGRATION test against the qa-staging Supabase branch; self-skips
 *     without branch creds like the other suites. Creates NO rows.
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
const isPermissionDenial = (error) =>
  error?.status === 401 ||
  error?.status === 403 ||
  /permission denied|42501/i.test(String(error?.message));
const expectPermissionDenied = async (promise) => {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(isPermissionDenial(error)).toBe(true);
};

describe.skipIf(!hasCreds)('Notify F1 — push_subscriptions is locked to owner-row RPCs (integration)', () => {
  it('anon cannot read any secret subscription row', async () => {
    // PostgREST may represent deny-by-default RLS as either [] or a permission
    // error depending on the table-level grant. Both are safe; rows are not.
    try {
      const rows = await db.select('push_subscriptions', 'select=endpoint&limit=1');
      expect(rows).toEqual([]);
    } catch (error) {
      expect(isPermissionDenial(error)).toBe(true);
    }
  });

  it('anon cannot EXECUTE upsert_push_subscription (granted to authenticated only)', async () => {
    await expectPermissionDenied(db.rpc('upsert_push_subscription', {
      p_endpoint: 'https://example.invalid/anon-test',
      p_p256dh: 'x', p_auth: 'y',
    }));
  });

  it('anon cannot EXECUTE delete_push_subscription (granted to authenticated only)', async () => {
    await expectPermissionDenied(db.rpc('delete_push_subscription', {
      p_endpoint: 'https://example.invalid/anon-test',
    }));
  });
});
