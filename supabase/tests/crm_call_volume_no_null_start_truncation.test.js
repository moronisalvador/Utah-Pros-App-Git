/**
 * ════════════════════════════════════════════════
 * FILE: crm_call_volume_no_null_start_truncation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves get_call_volume's null-p_start default derives a REAL floor from
 *   the org's earliest actual call, never a guessed distant date. A guessed
 *   floor (the frontend briefly used '2000-01-01') forces the function's
 *   day-by-day generate_series to span decades, which can blow past
 *   PostgREST's default 1000-row response cap and silently return only the
 *   oldest (all-zero) slice — the live bug this migration fixes: "All time"
 *   showed 0 calls despite 68 real ones, because none of them fit inside the
 *   first 1000 truncated days. This test proves a call inserted for a
 *   TEST org still shows up when p_start is omitted, with a small response
 *   (no truncation risk), by checking the returned array actually reaches a
 *   period on/after the fixture's own call date.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs (via RPC's own org lookup)
 *              writes → inbound_leads (one TEST-org call lead), best-effort
 *              deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('get_call_volume — null p_start derives a real floor, not a guessed one (integration)', () => {
  const runId = Date.now();
  let orgId;
  const leadIds = [];

  afterAll(async () => {
    for (const id of leadIds) await db.delete('inbound_leads', `id=eq.${id}`);
  });

  it('an omitted p_start returns a small, non-truncated array that still reaches the fixture call', async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    const now = new Date();
    const [lead] = await db.insert('inbound_leads', {
      org_id: orgId, source_type: 'call', duration_sec: 60, spam_flag: false,
      occurred_at: now.toISOString(), raw_payload: { answered: true },
      notes: `zz-call-vol-nullstart-${runId}`,
    });
    leadIds.push(lead.id);

    // p_start omitted entirely — the exact call shape the Overview page makes
    // under "All time" (p_start: null). A guessed-distant-floor bug would
    // return ~1000 rows starting decades ago and never reach "now" at all.
    const rows = await db.rpc('get_call_volume', { p_end: now.toISOString().slice(0, 10), p_org_id: orgId });

    expect(Array.isArray(rows)).toBe(true);
    // The response must be small (bounded by real data), not PostgREST's
    // 1000-row cap — proves the floor is real, not a distant guess.
    expect(rows.length).toBeLessThan(1000);

    const todayStr = now.toISOString().slice(0, 10);
    const lastRow = rows[rows.length - 1];
    expect(lastRow.period).toBe(todayStr);
    expect(lastRow.total).toBeGreaterThanOrEqual(1);
  });
});
