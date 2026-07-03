/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase5_automations.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the configurable-automation database functions of CRM Phase 5 hold
 *   against the real database:
 *     1. You can create, list, enable/disable and delete an automation rule.
 *     2. Enqueuing a run for the same (rule, event) twice creates ONE run, never
 *        a duplicate — the idempotency the engine relies on because the event bus
 *        has no cursor (UNIQUE(automation_id, triggering_event_id)).
 *     3. The S1 trigger-collision guard: while a fixed automation is enabled, you
 *        cannot SAVE (or enable) a rule whose trigger duplicates it — but you can
 *        still save that same rule DISABLED. This is what stops one event from
 *        producing two texts across the two independent engines.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs, automation_settings, crm_automations/_runs (RPCs)
 *              writes → crm_automations (+ cascade runs), automation_settings
 *              (the TEST org's fixed-automation flags, restored in afterAll).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without creds
 *     like the other CRM suites (CI's `npm test` passes no secrets).
 *   - Runs against the disposable TEST org only (is_test = true). It toggles that
 *     org's automation_settings for the guard test and restores them in afterAll.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 5 — automation CRUD, run idempotency, S1 guard (integration)', () => {
  const runId = Date.now();
  let orgId;
  let settingsBefore;
  const automationIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
    const [s] = await db.select('automation_settings', `org_id=eq.${orgId}&select=*`);
    settingsBefore = s;
    // Start the guard tests from a clean slate — every fixed automation OFF.
    await db.rpc('set_automation_setting', { p_key: 'speed_to_lead_enabled', p_value: false, p_org_id: orgId }).catch(() => {});
    await db.rpc('set_automation_setting', { p_key: 'review_request_enabled', p_value: false, p_org_id: orgId }).catch(() => {});
  });

  afterAll(async () => {
    for (const id of automationIds) {
      try { await db.rpc('delete_crm_automation', { p_automation_id: id }); } catch { /* best effort */ }
    }
    // Restore the TEST org's fixed-automation flags to their prior state.
    if (settingsBefore) {
      for (const key of ['speed_to_lead_enabled', 'review_request_enabled']) {
        try { await db.rpc('set_automation_setting', { p_key: key, p_value: settingsBefore[key] === true, p_org_id: orgId }); } catch { /* best effort */ }
      }
    }
  });

  const mkAutomation = async (extra = {}) => {
    const row = await db.rpc('upsert_crm_automation', {
      p_name: `zz5 auto ${runId}-${automationIds.length}`,
      p_description: 'Phase 5 integration test',
      p_trigger_event_type: 'crm_lead_created',
      p_conditions: [],
      p_actions: [{ type: 'create_task', config: { title: 'Follow up' }, delay_hours: 0 }],
      p_enabled: false,
      p_org_id: orgId,
      ...extra,
    });
    if (row?.id) automationIds.push(row.id);
    return row;
  };

  // ─── 1. CRUD ─────────────────────────────────────────────────────────────────
  it('creates, lists, toggles and deletes an automation', async () => {
    const a = await mkAutomation();
    expect(a.id).toBeTruthy();
    expect(a.enabled).toBe(false);

    const list = await db.rpc('get_crm_automations', { p_org_id: orgId });
    expect(list.find((x) => x.id === a.id)).toBeTruthy();

    const on = await db.rpc('set_automation_enabled', { p_id: a.id, p_enabled: true });
    expect(on.enabled).toBe(true);

    await db.rpc('delete_crm_automation', { p_automation_id: a.id });
    automationIds.splice(automationIds.indexOf(a.id), 1);
    const after = await db.select('crm_automations', `id=eq.${a.id}&select=id`);
    expect(after.length).toBe(0);
  });

  // ─── 2. Run idempotency — UNIQUE(automation_id, triggering_event_id) ──────────
  it('enqueuing the same (rule, event) twice yields exactly one run', async () => {
    const a = await mkAutomation();
    const eventId = crypto.randomUUID();
    const first = await db.rpc('enqueue_automation_run', {
      p_automation_id: a.id, p_org_id: orgId, p_triggering_event_id: eventId,
      p_contact_id: null, p_entity_type: 'inbound_lead', p_entity_id: crypto.randomUUID(), p_next_run_at: new Date().toISOString(),
    });
    const second = await db.rpc('enqueue_automation_run', {
      p_automation_id: a.id, p_org_id: orgId, p_triggering_event_id: eventId,
      p_contact_id: null, p_entity_type: 'inbound_lead', p_entity_id: crypto.randomUUID(), p_next_run_at: new Date().toISOString(),
    });
    expect(first).toBeTruthy();   // inserted
    expect(second).toBeFalsy();   // ON CONFLICT DO NOTHING → nothing returned

    const runs = await db.select('crm_automation_runs', `automation_id=eq.${a.id}&triggering_event_id=eq.${eventId}&select=id`);
    expect(runs.length).toBe(1);

    const log = await db.rpc('get_automation_runs', { p_automation_id: a.id });
    expect(log.length).toBe(1);
  });

  // ─── 3. S1 trigger-collision guard (save + enable) ───────────────────────────
  it('blocks saving an ENABLED rule that collides with an enabled fixed automation', async () => {
    await db.rpc('set_automation_setting', { p_key: 'speed_to_lead_enabled', p_value: true, p_org_id: orgId });

    // Enabled + trigger crm_lead_created collides with speed-to-lead → refused.
    await expect(
      mkAutomation({ p_enabled: true, p_trigger_event_type: 'crm_lead_created' })
    ).rejects.toThrow();

    // The SAME rule saved DISABLED is allowed (it just can't fire).
    const disabled = await mkAutomation({ p_enabled: false, p_trigger_event_type: 'crm_lead_created' });
    expect(disabled.id).toBeTruthy();

    // …and it cannot be enabled while the collision stands.
    await expect(
      db.rpc('set_automation_enabled', { p_id: disabled.id, p_enabled: true })
    ).rejects.toThrow();

    // A non-colliding trigger enables fine.
    const other = await mkAutomation({ p_enabled: false, p_trigger_event_type: 'job.payment_received' });
    const on = await db.rpc('set_automation_enabled', { p_id: other.id, p_enabled: true });
    expect(on.enabled).toBe(true);

    await db.rpc('set_automation_setting', { p_key: 'speed_to_lead_enabled', p_value: false, p_org_id: orgId });
  });
});
