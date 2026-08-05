/**
 * ════════════════════════════════════════════════
 * FILE: crm_caller_name_follows_merge.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves a caller's NAME reaches the card you actually see, even when our
 *   AI learns the name from a later call that got merged into an earlier one
 *   (migration 20260722_crm_caller_name_follows_merge).
 *
 *   The name comes from OUR pass (Deepgram transcript → Claude), not from
 *   CallRail, and it usually lands on a LATER call — the first call often goes
 *   unanswered or nobody says a name. Since the repeat-caller dedup shipped,
 *   that later call merges into the earlier one and owns no pipeline card, so
 *   the name was being written to a row that renders nowhere. Owner-caught
 *   live: a Won card showed a bare phone number and the caller looked gone.
 *
 *   Three behaviors are pinned here:
 *     FILL    — a merged call's name fills a canonical that had none.
 *     EXTEND  — a fuller name ("Kelsey Bledgy" over "Kelsey") upgrades both.
 *     PROTECT — an UNRELATED name on a merged call never overwrites the
 *               canonical's established name, even with p_allow_upgrade.
 *   The merged call always keeps its own name (each recording names whoever
 *   actually spoke on it) — propagation ADDS to the canonical, it never
 *   rewrites history on the call row.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → inbound_leads
 *              writes → inbound_leads (upsert_lead_from_callrail +
 *                       set_lead_caller_name RPCs, TEST-org fixtures;
 *                       deleted in afterAll)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the sibling CRM suites. ⚠️ See docs/test-auth-repair-plan.md —
 *     these suites currently cannot authenticate; this file's behavior was
 *     verified live via service-role SQL on 2026-07-22 pending that repair.
 *   - Companion to crm_caller_name_upgrade.test.js, which pins the guard
 *     itself (fill-blank / extend-only) on a single unmerged lead.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('caller name follows the merge to the visible card (integration)', () => {
  const runId = Date.now();
  let orgId;
  const leadIds = [];

  // An earlier call, then a later one that merges into it — the shape the
  // repeat-caller dedup produces for every callback.
  const pair = async (label, phone) => {
    const canonical = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-namemerge-${label}-a-${runId}`,
      p_source_type: 'call', p_org_id: orgId, p_caller_number: phone,
      p_duration_sec: 60, p_occurred_at: new Date(Date.now() - 36e5).toISOString(),
      p_raw_payload: { answered: 'true' },
    });
    leadIds.push(canonical.id);
    const redial = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-namemerge-${label}-b-${runId}`,
      p_source_type: 'call', p_org_id: orgId, p_caller_number: phone,
      p_duration_sec: 90, p_occurred_at: new Date().toISOString(),
      p_raw_payload: { answered: 'true' },
    });
    leadIds.push(redial.id);
    expect(redial.merged_into_lead_id).toBe(canonical.id);
    return { canonical, redial };
  };

  const nameOf = async (id) => {
    const [row] = await db.select('inbound_leads', `id=eq.${id}&select=caller_name`);
    return row?.caller_name ?? null;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
  });

  it('FILL — a name learned on the merged call reaches the canonical card', async () => {
    const { canonical, redial } = await pair('fill', `+1801${String(runId).slice(-7)}`);
    expect(await nameOf(canonical.id)).toBeNull();

    // The AI pass names the row whose recording it read — the merged one.
    await db.rpc('set_lead_caller_name', { p_lead_id: redial.id, p_name: 'Kelsey', p_allow_upgrade: false });

    expect(await nameOf(canonical.id)).toBe('Kelsey'); // the visible card
    expect(await nameOf(redial.id)).toBe('Kelsey');
  });

  it('EXTEND — a fuller name from a later call upgrades the canonical too', async () => {
    const { canonical, redial } = await pair('extend', `+1801${String(runId).slice(-6)}9`);
    await db.rpc('set_lead_caller_name', { p_lead_id: redial.id, p_name: 'Kelsey', p_allow_upgrade: false });
    await db.rpc('set_lead_caller_name', { p_lead_id: redial.id, p_name: 'Kelsey Bledgy', p_allow_upgrade: true });

    expect(await nameOf(canonical.id)).toBe('Kelsey Bledgy');
    expect(await nameOf(redial.id)).toBe('Kelsey Bledgy');
  });

  it('PROTECT — an unrelated name on a merged call never overwrites the canonical', async () => {
    const { canonical, redial } = await pair('protect', `+1801${String(runId).slice(-6)}8`);
    await db.rpc('set_lead_caller_name', { p_lead_id: canonical.id, p_name: 'Alice Anderson', p_allow_upgrade: false });

    // A different person on the callback (wrong number, spouse, transfer) —
    // even asking for an upgrade must not rewrite the canonical's name.
    await db.rpc('set_lead_caller_name', { p_lead_id: redial.id, p_name: 'Bob Smith', p_allow_upgrade: true });

    expect(await nameOf(canonical.id)).toBe('Alice Anderson'); // untouched
    expect(await nameOf(redial.id)).toBe('Bob Smith');         // its own truth
  });

  it('an unmerged lead is unaffected (no canonical to propagate to)', async () => {
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-namemerge-solo-${runId}`,
      p_source_type: 'call', p_org_id: orgId,
      p_caller_number: `+1801${String(runId).slice(-6)}7`,
      p_duration_sec: 60, p_occurred_at: new Date().toISOString(),
      p_raw_payload: { answered: 'true' },
    });
    leadIds.push(lead.id);
    expect(lead.merged_into_lead_id).toBeNull();

    const returned = await db.rpc('set_lead_caller_name', { p_lead_id: lead.id, p_name: 'Solo Caller', p_allow_upgrade: false });
    expect(returned.id).toBe(lead.id);          // contract: returns the row asked for
    expect(returned.caller_name).toBe('Solo Caller');
  });
});
