/**
 * ════════════════════════════════════════════════
 * FILE: process-crm-automations.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the configurable-automation cron worker behaves — the four things
 *   that matter for correctness and the law:
 *     1. Idempotency — one event never spawns two runs for the same rule (the
 *        UNIQUE(automation_id, triggering_event_id) key the engine dedups on,
 *        since the event bus has no cursor). Re-scanning the same event is a
 *        no-op.
 *     2. The S1 trigger-collision guard at FIRE time — a rule whose trigger is
 *        already handled by an enabled fixed automation is skipped by the engine,
 *        so one missed call can never produce two texts.
 *     3. Send outcomes — a text held by the SMS kill-switch or by TCPA
 *        quiet-hours is HELD and retried, never dropped and never advanced past;
 *        a durable consent skip (dnd/suppressed) advances past; a transient
 *        failure is left to retry.
 *     4. The AND-condition evaluator — typed operators, missing-field / null
 *        cases, all null-safe.
 *   The database and the send helper are faked, so nothing real is sent.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./process-crm-automations.js (system under test). The DB is
 *              injected as a fake; the send path is never reached.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. The hold/skip/retry decision is delegated to Phase 8's
 *     frozen planStepOutcome (imported read-only by the engine); these tests lock
 *     the run-level translation of that decision.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  WORKER_NAME,
  FIXED_AUTOMATION_TRIGGERS,
  blockedTriggers,
  isTriggerBlocked,
  getFieldValue,
  evaluateCondition,
  evaluateConditions,
  buildEventContext,
  planRunOutcome,
  matchAutomations,
  HOLD_RETRY_HOURS,
} from './process-crm-automations.js';
import { computeNextRunAt } from './process-sequences.js';

const NOW = new Date('2026-07-02T12:00:00Z');

// ─── 2. S1 trigger-collision guard (fire-time skip) ───────────────────────────
describe('blockedTriggers / isTriggerBlocked (S1)', () => {
  it('blocks nothing when every fixed automation is off', () => {
    expect(blockedTriggers({})).toEqual([]);
    expect(blockedTriggers({ speed_to_lead_enabled: false, review_request_enabled: false })).toEqual([]);
  });

  it('an enabled speed-to-lead blocks the new-lead trigger(s)', () => {
    const blocked = blockedTriggers({ speed_to_lead_enabled: true });
    expect(blocked).toEqual(expect.arrayContaining(FIXED_AUTOMATION_TRIGGERS.speed_to_lead));
    expect(isTriggerBlocked({ speed_to_lead_enabled: true }, 'crm_lead_created')).toBe(true);
    expect(isTriggerBlocked({ speed_to_lead_enabled: true }, 'job.status_changed')).toBe(false);
  });

  it('an enabled review-request blocks the job-completion trigger(s)', () => {
    expect(isTriggerBlocked({ review_request_enabled: true }, 'job.status_changed')).toBe(true);
    expect(isTriggerBlocked({ review_request_enabled: true }, 'job.phase_changed')).toBe(true);
    expect(isTriggerBlocked({ review_request_enabled: true }, 'crm_lead_created')).toBe(false);
  });

  it('no-response-followup is a time-scan with no discrete event → blocks nothing', () => {
    expect(FIXED_AUTOMATION_TRIGGERS.no_response_followup).toEqual([]);
    expect(isTriggerBlocked({ no_response_followup_enabled: true }, 'crm_lead_created')).toBe(false);
  });
});

// ─── 4. AND-condition evaluator (typed, null-safe) ────────────────────────────
describe('getFieldValue', () => {
  it('reads a flat key and a dotted path, null-safe', () => {
    expect(getFieldValue({ a: 1 }, 'a')).toBe(1);
    expect(getFieldValue({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(getFieldValue({ a: { b: 2 } }, 'a.c')).toBeUndefined();
    expect(getFieldValue(null, 'a')).toBeUndefined();
    expect(getFieldValue({ a: 1 }, null)).toBeUndefined();
  });
});

describe('evaluateCondition — typed operators, missing/null safe', () => {
  const ctx = { source_type: 'call', duration_sec: 0, score: 42, tags: ['vip', 'hot'], name: 'Ann' };

  it('eq / ne with present and missing fields', () => {
    expect(evaluateCondition({ field: 'source_type', op: 'eq', value: 'call' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'source_type', op: 'eq', value: 'form' }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'missing', op: 'eq', value: 'x' }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'source_type', op: 'ne', value: 'form' }, ctx)).toBe(true);
    // a missing field is "empty" — equals empty/null, differs from a concrete value
    expect(evaluateCondition({ field: 'missing', op: 'ne', value: 'x' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'missing', op: 'eq', value: null }, ctx)).toBe(true);
  });

  it('numeric ordering coerces numeric strings; missing field is never ordered', () => {
    expect(evaluateCondition({ field: 'score', op: 'gt', value: 40 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'score', op: 'gt', value: '40' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'score', op: 'gte', value: 42 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'score', op: 'lt', value: 42 }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'score', op: 'lte', value: 42 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'duration_sec', op: 'lte', value: 0 }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'missing', op: 'gt', value: 0 }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'missing', op: 'lt', value: 100 }, ctx)).toBe(false);
  });

  it('contains / not_contains on strings and arrays', () => {
    expect(evaluateCondition({ field: 'name', op: 'contains', value: 'nn' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'tags', op: 'contains', value: 'vip' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'tags', op: 'not_contains', value: 'cold' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'missing', op: 'contains', value: 'x' }, ctx)).toBe(false);
  });

  it('in / not_in against a list value', () => {
    expect(evaluateCondition({ field: 'source_type', op: 'in', value: ['call', 'form'] }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'source_type', op: 'in', value: ['form'] }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'source_type', op: 'not_in', value: ['form'] }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'missing', op: 'in', value: ['a'] }, ctx)).toBe(false);
  });

  it('is_empty / is_not_empty null-safe', () => {
    expect(evaluateCondition({ field: 'missing', op: 'is_empty' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'name', op: 'is_empty' }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'name', op: 'is_not_empty' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'missing', op: 'is_not_empty' }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'duration_sec', op: 'is_empty' }, { duration_sec: 0 })).toBe(false); // 0 is a value
  });

  it('an unknown or malformed operator fails closed (does not fire)', () => {
    expect(evaluateCondition({ field: 'name', op: 'wat', value: 'x' }, ctx)).toBe(false);
    expect(evaluateCondition({ op: 'eq', value: 'x' }, ctx)).toBe(false); // no field
    expect(evaluateCondition(null, ctx)).toBe(false);
  });
});

describe('evaluateConditions — AND semantics', () => {
  const ctx = { source_type: 'call', duration_sec: 0 };
  it('an empty condition set always matches', () => {
    expect(evaluateConditions([], ctx)).toBe(true);
    expect(evaluateConditions(null, ctx)).toBe(true);
    expect(evaluateConditions(undefined, ctx)).toBe(true);
  });
  it('all conditions must hold (AND, not OR)', () => {
    expect(evaluateConditions([
      { field: 'source_type', op: 'eq', value: 'call' },
      { field: 'duration_sec', op: 'lte', value: 0 },
    ], ctx)).toBe(true);
    expect(evaluateConditions([
      { field: 'source_type', op: 'eq', value: 'call' },
      { field: 'duration_sec', op: 'gt', value: 0 },
    ], ctx)).toBe(false);
  });
});

// ─── buildEventContext — payload overrides the entity on key collision ────────
describe('buildEventContext', () => {
  it('merges entity (base) under payload (override) and exposes event fields', () => {
    const event = { event_type: 'crm_lead_created', entity_type: 'inbound_lead', entity_id: 'L1', payload: { source_type: 'call', contact_id: 'C1' } };
    const entity = { id: 'L1', source_type: 'form', lead_status: 'new' };
    const ctx = buildEventContext(event, entity);
    expect(ctx.event_type).toBe('crm_lead_created');
    expect(ctx.entity_type).toBe('inbound_lead');
    expect(ctx.lead_status).toBe('new');     // from entity
    expect(ctx.source_type).toBe('call');     // payload wins over entity
    expect(ctx.contact_id).toBe('C1');
  });
  it('tolerates a null entity and an absent payload', () => {
    const ctx = buildEventContext({ event_type: 'x', payload: null }, null);
    expect(ctx.event_type).toBe('x');
  });
});

// ─── 3. planRunOutcome — hold/skip/retry translated to the run's cursor ───────
describe('planRunOutcome — send-outcome semantics (imported from Phase 8)', () => {
  const actions = [{ type: 'send_sms', delay_hours: 0 }, { type: 'send_email', delay_hours: 24 }];
  const run = { current_action: 0 };

  it('a successful send advances to the next action, scheduled by its delay', () => {
    const plan = planRunOutcome(run, actions, { ok: true }, NOW);
    expect(plan.action).toBe('sent');
    expect(plan.patch.current_action).toBe(1);
    expect(plan.patch.status).toBe('active');
    expect(plan.patch.next_run_at).toBe('2026-07-03T12:00:00.000Z'); // +24h
  });

  it('the final action completes the run', () => {
    const plan = planRunOutcome({ current_action: 1 }, actions, { ok: true }, NOW);
    expect(plan.action).toBe('sent');
    expect(plan.patch.current_action).toBe(2);
    expect(plan.patch.status).toBe('completed');
    expect(plan.patch.next_run_at).toBe(null);
  });

  it('an SMS held by the kill-switch is HELD, not advanced — retried later', () => {
    const plan = planRunOutcome(run, actions, { ok: false, skipped: true, reason: 'sms_disabled' }, NOW);
    expect(plan.action).toBe('held');
    expect(plan.patch.status).toBe('held');
    expect(plan.patch.current_action).toBeUndefined();           // cursor unchanged — the text still owes
    expect(plan.patch.next_run_at).toBe(computeNextRunAt(NOW, HOLD_RETRY_HOURS));
  });

  it('an SMS inside TCPA quiet-hours is HELD too — never dropped', () => {
    const plan = planRunOutcome(run, actions, { ok: false, skipped: true, reason: 'quiet_hours' }, NOW);
    expect(plan.action).toBe('held');
    expect(plan.patch.status).toBe('held');
    expect(plan.patch.next_run_at).toBe(computeNextRunAt(NOW, HOLD_RETRY_HOURS));
  });

  it('a durable consent skip (dnd) advances past the action, not held', () => {
    const plan = planRunOutcome(run, actions, { ok: false, skipped: true, reason: 'dnd' }, NOW);
    expect(plan.action).toBe('skipped');
    expect(plan.patch.current_action).toBe(1); // advanced — don't keep pestering
    expect(plan.patch.status).toBe('active');
  });

  it('a transient failure neither advances nor holds (retried next run)', () => {
    const plan = planRunOutcome(run, actions, { ok: false, skipped: false, error: 'network' }, NOW);
    expect(plan.action).toBe('retry');
    expect(plan.patch).toBe(null);
  });
});

// ─── 1. Idempotent run-creation — one event, one run per rule ─────────────────
describe('matchAutomations — idempotent run-creation', () => {
  const automation = {
    id: 'A1', trigger_event_type: 'crm_lead_created', conditions: [], actions: [{ type: 'create_task', delay_hours: 0 }],
  };
  const event = { id: 'E1', event_type: 'crm_lead_created', entity_type: 'inbound_lead', entity_id: 'L1', payload: { contact_id: 'C1' } };

  // Fake db whose enqueue RPC enforces UNIQUE(automation_id, triggering_event_id).
  function makeDb(store) {
    return {
      select: async () => [],
      rpc: async (fn, p) => {
        if (fn !== 'enqueue_automation_run') return [];
        const key = `${p.p_automation_id}:${p.p_triggering_event_id}`;
        if (store.some((r) => r.key === key)) return null; // ON CONFLICT DO NOTHING
        store.push({ key, ...p });
        return p.p_automation_id;
      },
    };
  }

  it('creates exactly one run for one event, and re-scanning is a no-op', async () => {
    const store = [];
    const ctx = { db: makeDb(store), now: NOW, orgId: 'ORG1', settings: {}, automations: [automation] };
    const first = await matchAutomations(ctx, [event]);
    const second = await matchAutomations({ ...ctx, db: makeDb(store) }, [event]); // same store
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(store.length).toBe(1);
    expect(store[0].p_org_id).toBe('ORG1');
    expect(store[0].p_contact_id).toBe('C1');
  });

  it('skips a rule whose trigger collides with an enabled fixed automation (S1 fire-time)', async () => {
    const store = [];
    const ctx = {
      db: makeDb(store), now: NOW, orgId: 'ORG1',
      settings: { speed_to_lead_enabled: true }, // blocks crm_lead_created
      automations: [automation],
    };
    const created = await matchAutomations(ctx, [event]);
    expect(created).toBe(0);
    expect(store.length).toBe(0);
  });

  it('does not create a run when an AND-condition fails', async () => {
    const store = [];
    const gated = { ...automation, conditions: [{ field: 'source_type', op: 'eq', value: 'form' }] };
    const ctx = { db: makeDb(store), now: NOW, orgId: 'ORG1', settings: {}, automations: [gated] };
    // payload has no source_type and entity is empty → condition fails
    const created = await matchAutomations(ctx, [event]);
    expect(created).toBe(0);
  });
});

// ─── Contracts ────────────────────────────────────────────────────────────────
describe('worker contracts', () => {
  it('names itself distinctly from the fixed-automation worker', () => {
    expect(WORKER_NAME).toBe('process-crm-automations');
  });
});
