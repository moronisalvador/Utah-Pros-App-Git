/**
 * ════════════════════════════════════════════════
 * FILE: crm_call_volume_answered_field.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves get_call_volume's answered/missed split uses CallRail's OWN
 *   `answered` disposition (raw_payload->>'answered'), not a duration_sec > 0
 *   proxy. The two disagree in real data: CallRail marks a call "missed" even
 *   when it has real talk time (rang, went to voicemail, a few seconds of
 *   greeting) — the owner found this live (CallRail said 20 missed of 67
 *   calls; the duration-based proxy only caught 1). This test pins a call with
 *   duration_sec > 0 but answered:false and asserts it counts as MISSED.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs (via RPC's own org lookup)
 *              writes → inbound_leads (two TEST-org call leads), best-effort
 *              deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites (CI's `npm test` passes no secrets).
 *   - Fixtures are dated "today" (mt_today()) so they land inside
 *     get_call_volume's default 30-day window without passing explicit bounds.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('get_call_volume — answered field, not duration proxy (integration)', () => {
  const runId = Date.now();
  let orgId;
  const createdLeadIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of createdLeadIds) {
      await db.delete('inbound_leads', `id=eq.${id}`);
    }
  });

  it('counts a call as MISSED when raw_payload.answered=false, even with duration_sec > 0', async () => {
    const now = new Date().toISOString();

    // A real CallRail shape: answered:false but a few seconds of voicemail/
    // greeting talk time — the exact case the duration-proxy got wrong.
    const [missedButTalked] = await db.insert('inbound_leads', {
      org_id: orgId,
      source_type: 'call',
      duration_sec: 14,
      spam_flag: false,
      occurred_at: now,
      raw_payload: { answered: false, direction: 'inbound' },
      notes: `zz-call-vol-missed-${runId}`,
    });
    createdLeadIds.push(missedButTalked.id);

    const [answered] = await db.insert('inbound_leads', {
      org_id: orgId,
      source_type: 'call',
      duration_sec: 180,
      spam_flag: false,
      occurred_at: now,
      raw_payload: { answered: true, direction: 'inbound' },
      notes: `zz-call-vol-answered-${runId}`,
    });
    createdLeadIds.push(answered.id);

    const rows = await db.rpc('get_call_volume', { p_start: now.slice(0, 10), p_end: now.slice(0, 10), p_org_id: orgId });
    expect(rows).toHaveLength(1);
    const day = rows[0];

    // If this still used duration_sec > 0, BOTH fixtures (14 and 180) would
    // read as "answered" and missed would be 0 — the exact live bug.
    expect(day.missed).toBeGreaterThanOrEqual(1);
    expect(day.answered).toBeGreaterThanOrEqual(1);
    expect(day.total).toBe(day.answered + day.missed);
  });
});
