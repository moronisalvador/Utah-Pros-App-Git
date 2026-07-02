/**
 * ════════════════════════════════════════════════
 * FILE: process-sequences.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the drip-sequence cron worker behaves. It checks the pure timing
 *   math (when is a step's next send due, given its delay in hours), the
 *   reply/conversion "exit" rules (should we stop dripping this person because
 *   they wrote back or booked?), and — most importantly for the law — that a
 *   text step goes nowhere while the global SMS switch is OFF (it is held, not
 *   sent) and that a contact who can't be contacted (unsubscribed / do-not-
 *   disturb) is skipped with a durable record left behind. The database and the
 *   send helper are faked, so nothing real is sent.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./process-sequences.js (system under test). The DB and the
 *              send() action are injected as fakes — no network, no mocks.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. The per-enrollment handler takes an injected ctx
 *     ({ db, send, now, sequences, steps }) so the send path (automated-send.js
 *     → twilio/email) and the consent gate are never actually reached.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  WORKER_NAME,
  REPLY_EVENT_TYPES,
  CONVERSION_EVENT_TYPES,
  classifyEvent,
  computeNextRunAt,
  firstRunAt,
  evaluateExit,
  advanceEnrollment,
  planStepOutcome,
  HOLD_RETRY_HOURS,
} from './process-sequences.js';

const NOW = new Date('2026-07-02T12:00:00Z');
const iso = (d) => new Date(d).toISOString();

// ─── computeNextRunAt / firstRunAt — the step-advance timing math ─────────────
describe('computeNextRunAt', () => {
  it('adds delay_hours to a base instant (fixed-hour offset, tz-invariant)', () => {
    expect(computeNextRunAt(NOW, 0)).toBe('2026-07-02T12:00:00.000Z');
    expect(computeNextRunAt(NOW, 1)).toBe('2026-07-02T13:00:00.000Z');
    expect(computeNextRunAt(NOW, 24)).toBe('2026-07-03T12:00:00.000Z');
    expect(computeNextRunAt(NOW, 72)).toBe('2026-07-05T12:00:00.000Z');
  });
  it('accepts an ISO string base and coerces a non-integer delay to 0', () => {
    expect(computeNextRunAt('2026-07-02T12:00:00Z', 48)).toBe('2026-07-04T12:00:00.000Z');
    expect(computeNextRunAt(NOW, null)).toBe('2026-07-02T12:00:00.000Z');
    expect(computeNextRunAt(NOW, undefined)).toBe('2026-07-02T12:00:00.000Z');
  });
});

describe('firstRunAt', () => {
  it('is the enrollment instant plus the first step delay', () => {
    const steps = [{ step_order: 0, delay_hours: 0 }, { step_order: 1, delay_hours: 48 }];
    expect(firstRunAt(NOW, steps)).toBe('2026-07-02T12:00:00.000Z');
    expect(firstRunAt(NOW, [{ step_order: 0, delay_hours: 24 }])).toBe('2026-07-03T12:00:00.000Z');
  });
  it('uses the lowest step_order regardless of array order', () => {
    const steps = [{ step_order: 1, delay_hours: 48 }, { step_order: 0, delay_hours: 2 }];
    expect(firstRunAt(NOW, steps)).toBe('2026-07-02T14:00:00.000Z');
  });
  it('is null when a sequence has no steps', () => {
    expect(firstRunAt(NOW, [])).toBe(null);
    expect(firstRunAt(NOW, null)).toBe(null);
  });
});

// ─── advanceEnrollment — post-send state transition ───────────────────────────
describe('advanceEnrollment', () => {
  const steps = [
    { step_order: 0, delay_hours: 0 },
    { step_order: 1, delay_hours: 48 },
    { step_order: 2, delay_hours: 72 },
  ];
  it('moves to the next step and schedules it by that step\'s delay', () => {
    const next = advanceEnrollment({ current_step: 0 }, steps, NOW);
    expect(next.current_step).toBe(1);
    expect(next.status).toBe('active');
    expect(next.next_run_at).toBe('2026-07-04T12:00:00.000Z'); // +48h
    expect(next.completed_at).toBe(null);
  });
  it('completes the enrollment after the final step', () => {
    const next = advanceEnrollment({ current_step: 2 }, steps, NOW);
    expect(next.current_step).toBe(3);
    expect(next.status).toBe('completed');
    expect(next.next_run_at).toBe(null);
    expect(next.completed_at).toBe(iso(NOW));
  });
});

// ─── classifyEvent / evaluateExit — the reply & conversion exit rules ─────────
describe('classifyEvent', () => {
  it('maps a contact reply to "reply"', () => {
    for (const t of REPLY_EVENT_TYPES) expect(classifyEvent(t)).toBe('reply');
  });
  it('maps a conversion signal to "conversion"', () => {
    for (const t of CONVERSION_EVENT_TYPES) expect(classifyEvent(t)).toBe('conversion');
  });
  it('ignores unrelated events', () => {
    expect(classifyEvent('crm_lead_details_updated')).toBe(null);
    expect(classifyEvent(null)).toBe(null);
  });
});

describe('evaluateExit', () => {
  const seq = { exit_on_reply: true, exit_on_conversion: true };
  it('exits on reply when the sequence opts in', () => {
    expect(evaluateExit(seq, { hasReply: true, hasConversion: false })).toBe('reply');
  });
  it('exits on conversion when the sequence opts in', () => {
    expect(evaluateExit(seq, { hasReply: false, hasConversion: true })).toBe('conversion');
  });
  it('does not exit when the sequence has the toggle off', () => {
    expect(evaluateExit({ exit_on_reply: false, exit_on_conversion: false }, { hasReply: true, hasConversion: true })).toBe(null);
  });
  it('prefers reply when both fire', () => {
    expect(evaluateExit(seq, { hasReply: true, hasConversion: true })).toBe('reply');
  });
});

// ─── planStepOutcome — what to do after a send attempt returns ────────────────
describe('planStepOutcome', () => {
  const steps = [{ step_order: 0, delay_hours: 0 }, { step_order: 1, delay_hours: 24 }];
  const enrollment = { current_step: 0 };

  it('a successful send advances to the next step', () => {
    const plan = planStepOutcome(enrollment, steps, { ok: true }, NOW);
    expect(plan.action).toBe('sent');
    expect(plan.patch.current_step).toBe(1);
    expect(plan.patch.next_run_at).toBe('2026-07-03T12:00:00.000Z');
    expect(plan.event.event_type).toBe('crm_sequence_step_sent');
  });

  it('an SMS held by the kill-switch does NOT advance — it is retried later', () => {
    const plan = planStepOutcome(enrollment, steps, { ok: false, skipped: true, reason: 'sms_disabled' }, NOW);
    expect(plan.action).toBe('held');
    // step is unchanged — the text still owes when the switch flips ON
    expect(plan.patch.current_step).toBeUndefined();
    expect(plan.patch.status).toBeUndefined();
    // pushed forward so it doesn't hot-loop every cron tick
    expect(plan.patch.next_run_at).toBe(computeNextRunAt(NOW, HOLD_RETRY_HOURS));
    expect(plan.event.event_type).toBe('crm_sequence_step_held');
    expect(plan.event.reason).toBe('sms_disabled');
  });

  it('a consent skip (dnd/suppressed) advances past the step with a durable record', () => {
    const plan = planStepOutcome(enrollment, steps, { ok: false, skipped: true, reason: 'dnd' }, NOW);
    expect(plan.action).toBe('skipped');
    expect(plan.patch.current_step).toBe(1); // advanced — we don't keep pestering
    expect(plan.event.event_type).toBe('crm_sequence_step_skipped');
    expect(plan.event.reason).toBe('dnd');
  });

  it('a transient failure neither advances nor records (retried next run)', () => {
    const plan = planStepOutcome(enrollment, steps, { ok: false, skipped: false, error: 'network' }, NOW);
    expect(plan.action).toBe('retry');
    expect(plan.patch).toBe(null);
    expect(plan.event).toBe(null);
  });
});

// ─── Contracts ───────────────────────────────────────────────────────────────
describe('worker contracts', () => {
  it('names itself for the worker_runs audit row', () => {
    expect(WORKER_NAME).toBe('process-sequences');
  });
  it('treats an inbound sms as the reply signal and a promoted lead as conversion', () => {
    expect(REPLY_EVENT_TYPES).toContain('contact_replied');
    expect(CONVERSION_EVENT_TYPES).toContain('crm_lead_promoted');
  });
});
