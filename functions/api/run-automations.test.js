/**
 * ════════════════════════════════════════════════
 * FILE: run-automations.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the four fixed CRM automations behave. It checks the trigger
 *   predicates (is this lead brand-new? a missed call? gone cold? a finished
 *   job?) return the right yes/no, that each automation writes the correct
 *   kind of audit event when it fires, that a blocked (unsubscribed / do-not-
 *   disturb) contact is skipped with a durable record left behind, and that
 *   the same trigger never fires twice for the same lead or job. The database
 *   and the send helper are faked, so nothing real is sent.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./run-automations.js (system under test). The DB and the
 *              send() action are injected as fakes — no network, no mocks.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. Handlers accept an injected ctx ({ db, send, now, ... })
 *     so the send path (automated-send.js → twilio/email) is never reached.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_EVENT_TYPES,
  AUTOMATION_CHANNELS,
  isStale,
  isFreshInboundLead,
  isMissedCall,
  isJobCompletion,
  runSpeedToLead,
  runMissedCallTextback,
  runNoResponseFollowup,
  runReviewRequest,
  runAutomations,
} from './run-automations.js';

const NOW = new Date('2026-07-02T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const minsAgo = (n) => new Date(NOW.getTime() - n * 60000).toISOString();
const hoursAgo = (n) => new Date(NOW.getTime() - n * 3600000).toISOString();

// A minimal fake DB + injected send() so a handler can run with no network.
function makeCtx({
  leads = [],
  phaseRows = [],
  jobs = {},
  contacts = {},
  firedEvents = [],
  sendResult = { ok: true, sid: 'SM_test' },
} = {}) {
  const inserts = [];
  const sendCalls = [];
  const db = {
    async select(table, query = '') {
      if (table === 'inbound_leads') return leads;
      if (table === 'job_phase_history') return phaseRows;
      if (table === 'jobs') {
        const id = /id=eq\.([^&]+)/.exec(query)?.[1];
        return jobs[id] ? [jobs[id]] : [];
      }
      if (table === 'contacts') {
        const id = /id=eq\.([^&]+)/.exec(query)?.[1];
        return [contacts[id] || { name: '' }];
      }
      if (table === 'system_events') return firedEvents; // alreadyFired lookup
      return [];
    },
    async insert(table, data) { inserts.push({ table, data }); return [data]; },
  };
  const send = async (...args) => { sendCalls.push(args); return sendResult; };
  // paceMs: 0 keeps the MPS pacer a no-op so tests never sleep.
  const ctx = { db, env: {}, now: NOW, send, orgId: 'org-1', paceMs: 0 };
  return { ctx, inserts, sendCalls };
}

const freshCall = { id: 'L1', contact_id: 'c1', source_type: 'call', direction: 'inbound', duration_sec: 42, spam_flag: false, occurred_at: minsAgo(5), created_at: minsAgo(5) };
const missedCall = { id: 'L2', contact_id: 'c1', source_type: 'call', direction: 'inbound', duration_sec: 0, spam_flag: false, occurred_at: minsAgo(5), created_at: minsAgo(5) };
const staleLead = { id: 'L3', contact_id: 'c1', lead_status: 'new', updated_at: daysAgo(5), created_at: daysAgo(5) };

// ─── Automation → event-type / channel contracts ──────────────
describe('automation contracts', () => {
  it('maps each automation to its system_events trigger type', () => {
    expect(AUTOMATION_EVENT_TYPES).toEqual({
      speed_to_lead: 'lead_created',
      missed_call_textback: 'call_missed',
      no_response_followup: 'lead_stale',
      review_request: 'job_completed',
    });
  });
  it('maps each automation to its channel (2 sms · 2 email)', () => {
    expect(AUTOMATION_CHANNELS).toEqual({
      speed_to_lead: 'sms',
      missed_call_textback: 'sms',
      no_response_followup: 'email',
      review_request: 'email',
    });
  });
});

// ─── isStale — the no-response follow-up predicate (named in the dispatch) ─────
describe('isStale', () => {
  it('is stale when an open lead has had no activity past the threshold', () => {
    expect(isStale({ contact_id: 'c1', lead_status: 'new', updated_at: daysAgo(5) }, NOW, 3, 30)).toBe(true);
  });
  it('is not stale before the threshold', () => {
    expect(isStale({ contact_id: 'c1', lead_status: 'new', updated_at: daysAgo(1) }, NOW, 3, 30)).toBe(false);
  });
  it('is not stale once a lead is booked (no longer open)', () => {
    expect(isStale({ contact_id: 'c1', lead_status: 'booked', updated_at: daysAgo(5) }, NOW, 3, 30)).toBe(false);
  });
  it('stops following up past the max age', () => {
    expect(isStale({ contact_id: 'c1', lead_status: 'new', updated_at: daysAgo(60) }, NOW, 3, 30)).toBe(false);
  });
  it('needs a contact to text/email', () => {
    expect(isStale({ lead_status: 'new', updated_at: daysAgo(5) }, NOW, 3, 30)).toBe(false);
    expect(isStale(null, NOW, 3, 30)).toBe(false);
  });
});

// ─── isFreshInboundLead — speed-to-lead predicate ─────────────
describe('isFreshInboundLead', () => {
  it('fires for a just-answered inbound call', () => {
    expect(isFreshInboundLead(freshCall, NOW, 60)).toBe(true);
  });
  it('fires for a just-submitted form', () => {
    expect(isFreshInboundLead({ contact_id: 'c1', source_type: 'form', occurred_at: minsAgo(5) }, NOW, 60)).toBe(true);
  });
  it('does not fire for a missed call (that is missed-call text-back)', () => {
    expect(isFreshInboundLead(missedCall, NOW, 60)).toBe(false);
  });
  it('does not fire outside the window, on spam, or without a contact', () => {
    expect(isFreshInboundLead({ ...freshCall, occurred_at: minsAgo(120) }, NOW, 60)).toBe(false);
    expect(isFreshInboundLead({ ...freshCall, spam_flag: true }, NOW, 60)).toBe(false);
    expect(isFreshInboundLead({ ...freshCall, contact_id: null }, NOW, 60)).toBe(false);
  });
});

// ─── isMissedCall — missed-call text-back predicate ───────────
describe('isMissedCall', () => {
  it('fires for an unanswered inbound call (0 / null duration)', () => {
    expect(isMissedCall(missedCall, NOW, 60)).toBe(true);
    expect(isMissedCall({ ...missedCall, duration_sec: null }, NOW, 60)).toBe(true);
  });
  it('does not fire for an answered call or a form', () => {
    expect(isMissedCall(freshCall, NOW, 60)).toBe(false);
    expect(isMissedCall({ contact_id: 'c1', source_type: 'form', occurred_at: minsAgo(5) }, NOW, 60)).toBe(false);
  });
});

// ─── isJobCompletion — review-request predicate ───────────────
describe('isJobCompletion', () => {
  it('fires when a job reaches a completed phase', () => {
    expect(isJobCompletion({ to_phase: 'completed' }, ['completed'])).toBe(true);
  });
  it('does not fire for a non-completing phase change', () => {
    expect(isJobCompletion({ to_phase: 'reconstruction_in_progress' }, ['completed'])).toBe(false);
  });
});

// ─── Each automation fires the correct system_events type ─────
describe('automations fire the correct system_events type', () => {
  it('speed-to-lead → lead_created (sms)', async () => {
    const { ctx, inserts, sendCalls } = makeCtx({ leads: [freshCall] });
    expect(await runSpeedToLead(ctx)).toBe(1);
    expect(sendCalls[0][0]).toBe('sms');
    const ev = inserts.find((i) => i.table === 'system_events');
    expect(ev.data.event_type).toBe('lead_created');
    expect(ev.data.entity_id).toBe('L1');
  });

  it('missed-call text-back → call_missed (sms)', async () => {
    const { ctx, inserts, sendCalls } = makeCtx({ leads: [missedCall] });
    expect(await runMissedCallTextback(ctx)).toBe(1);
    expect(sendCalls[0][0]).toBe('sms');
    expect(inserts.find((i) => i.table === 'system_events').data.event_type).toBe('call_missed');
  });

  it('no-response follow-up → lead_stale (email)', async () => {
    const { ctx, inserts, sendCalls } = makeCtx({ leads: [staleLead] });
    expect(await runNoResponseFollowup(ctx)).toBe(1);
    expect(sendCalls[0][0]).toBe('email');
    expect(inserts.find((i) => i.table === 'system_events').data.event_type).toBe('lead_stale');
  });

  it('review request → job_completed (email)', async () => {
    const { ctx, inserts, sendCalls } = makeCtx({
      phaseRows: [{ job_id: 'J1', to_phase: 'completed', changed_at: hoursAgo(2) }],
      jobs: { J1: { id: 'J1', primary_contact_id: 'c1' } },
    });
    expect(await runReviewRequest(ctx)).toBe(1);
    expect(sendCalls[0][0]).toBe('email');
    const ev = inserts.find((i) => i.table === 'system_events');
    expect(ev.data.event_type).toBe('job_completed');
    expect(ev.data.entity_id).toBe('J1');
  });
});

// ─── Consent gate reused: skip is durable ─────────────────────
describe('consent gate', () => {
  it('records a durable skip when the send is blocked (dnd/suppressed)', async () => {
    const { ctx, inserts } = makeCtx({ leads: [staleLead], sendResult: { ok: false, skipped: true, reason: 'dnd' } });
    await runNoResponseFollowup(ctx);
    const ev = inserts.find((i) => i.table === 'system_events');
    expect(ev).toBeTruthy();
    expect(ev.data.payload.outcome).toBe('skipped');
    expect(ev.data.payload.reason).toBe('dnd');
  });
});

// ─── F-10: a quiet-hours defer is NOT terminal (retried, never dropped) ───────
describe('quiet-hours held-retry (F-10)', () => {
  it('does NOT write a terminal system_events row when the send is deferred (quiet_hours)', async () => {
    const { ctx, inserts } = makeCtx({
      leads: [freshCall],
      sendResult: { ok: false, skipped: true, reason: 'quiet_hours' },
    });
    expect(await runSpeedToLead(ctx)).toBe(0); // not counted as sent
    // No terminal event → the lead stays a candidate and next run retries it.
    expect(inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });

  it('does NOT write a terminal row while the SMS kill-switch is OFF (sms_disabled)', async () => {
    const { ctx, inserts } = makeCtx({
      leads: [missedCall],
      sendResult: { ok: false, skipped: true, reason: 'sms_disabled' },
    });
    await runMissedCallTextback(ctx);
    expect(inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });

  it('STILL writes a terminal row for a durable consent skip (dnd) — not deferrable', async () => {
    const { ctx, inserts } = makeCtx({
      leads: [freshCall],
      sendResult: { ok: false, skipped: true, reason: 'dnd' },
    });
    await runSpeedToLead(ctx);
    const ev = inserts.find((i) => i.table === 'system_events');
    expect(ev).toBeTruthy();
    expect(ev.data.payload.reason).toBe('dnd');
  });

  it('retries after a defer: the same lead sends on a later run once quiet-hours lift', async () => {
    // Run 1: deferred (quiet_hours) → no event written.
    const run1 = makeCtx({ leads: [freshCall], sendResult: { ok: false, skipped: true, reason: 'quiet_hours' } });
    await runSpeedToLead(run1.ctx);
    expect(run1.inserts.find((i) => i.table === 'system_events')).toBeFalsy();
    // Run 2 (window lifted): no prior event exists → it fires and now records terminal.
    const run2 = makeCtx({ leads: [freshCall], firedEvents: [], sendResult: { ok: true, sid: 'SM_x' } });
    expect(await runSpeedToLead(run2.ctx)).toBe(1);
    expect(run2.inserts.find((i) => i.table === 'system_events')).toBeTruthy();
  });
});

// ─── Permanent send failure is terminal (stop infinite-retrying invalid numbers)
describe('permanent-failure terminal (F-10 companion)', () => {
  it('writes a terminal row on a PERMANENT failure so it is not retried forever', async () => {
    const { ctx, inserts } = makeCtx({
      leads: [freshCall],
      sendResult: { ok: false, skipped: false, error: 'Invalid number', permanent: true },
    });
    await runSpeedToLead(ctx);
    const ev = inserts.find((i) => i.table === 'system_events');
    expect(ev).toBeTruthy();
    expect(ev.data.payload.outcome).toBe('failed');
  });

  it('does NOT write a row on a TRANSIENT failure (429/5xx) so the next run retries', async () => {
    const { ctx, inserts } = makeCtx({
      leads: [freshCall],
      sendResult: { ok: false, skipped: false, error: 'Too Many Requests', permanent: false },
    });
    await runSpeedToLead(ctx);
    expect(inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });
});

// ─── Kill-switch: SMS automations are inert while sms_sending_enabled OFF ─────
describe('runAutomations kill-switch gating', () => {
  // A db that records which tables get queried, so we can prove the SMS
  // automations never even look at leads while the global switch is OFF.
  function gateDb(settings) {
    const queried = new Set();
    const inserts = [];
    const db = {
      async select(table) {
        queried.add(table);
        if (table === 'crm_orgs') return [{ id: 'org-1' }];
        if (table === 'automation_settings') return [settings];
        return [];
      },
      async insert(table, data) { inserts.push({ table, data }); return [data]; },
    };
    return { db, queried, inserts };
  }

  it('does not run the SMS automations when sms_sending_enabled is OFF', async () => {
    const { db, queried, inserts } = gateDb({
      sms_sending_enabled: false,
      speed_to_lead_enabled: true, missed_call_textback_enabled: true,
      no_response_followup_enabled: false, review_request_enabled: false,
    });
    const res = await runAutomations(db, {}, NOW);
    expect(res.ok).toBe(true);
    expect(res.smsLive).toBe(false);
    expect(res.processed).toBe(0);
    // No lead scan happened at all — truly inert, no burned idempotency rows.
    expect(queried.has('inbound_leads')).toBe(false);
    // A worker_runs row is still logged for the (empty) run.
    expect(inserts.some((i) => i.table === 'worker_runs' && i.data.status === 'completed')).toBe(true);
  });

  it('does scan for SMS automations once sms_sending_enabled is ON', async () => {
    const { db, queried } = gateDb({
      sms_sending_enabled: true,
      speed_to_lead_enabled: true, missed_call_textback_enabled: false,
      no_response_followup_enabled: false, review_request_enabled: false,
    });
    const res = await runAutomations(db, {}, NOW);
    expect(res.smsLive).toBe(true);
    expect(queried.has('inbound_leads')).toBe(true);
  });
});

// ─── Idempotency: a fired trigger never re-fires ──────────────
describe('idempotency', () => {
  it('does not re-fire (or re-send) when the trigger event already exists', async () => {
    const { ctx, inserts, sendCalls } = makeCtx({ leads: [freshCall], firedEvents: [{ id: 'e1' }] });
    expect(await runSpeedToLead(ctx)).toBe(0);
    expect(sendCalls.length).toBe(0);
    expect(inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });
});
