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
  // Simulates the UNIQUE(automation_key, entity_id) claim fence. Shared across
  // makeCtx calls when a test passes its own Map, which is how we model "a
  // second cron tick hitting a claim the first tick already took".
  claims = new Map(),
  claimThrows = false, // simulates the claim RPC being unavailable (migration not applied)
} = {}) {
  const inserts = [];
  const sendCalls = [];
  const rpcCalls = [];
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
    async rpc(fn, params = {}) {
      rpcCalls.push({ fn, params });
      const key = `${params.p_automation_key}|${params.p_entity_id}`;
      if (fn === 'claim_fixed_automation') {
        if (claimThrows) throw new Error('function claim_fixed_automation(...) does not exist');
        if (claims.has(key)) return false; // unique violation → another caller owns the send
        claims.set(key, { finalized: false });
        return true;
      }
      if (fn === 'release_fixed_automation_claim') {
        const c = claims.get(key);
        if (!c || c.finalized) return false; // a finalized claim is never re-opened
        claims.delete(key);
        return true;
      }
      if (fn === 'finalize_fixed_automation_claim') {
        const c = claims.get(key);
        if (!c) return false;
        c.finalized = true;
        return true;
      }
      throw new Error(`unexpected rpc: ${fn}`);
    },
  };
  const send = async (...args) => { sendCalls.push(args); return sendResult; };
  // paceMs: 0 keeps the MPS pacer a no-op so tests never sleep.
  const ctx = { db, env: {}, now: NOW, send, orgId: 'org-1', paceMs: 0 };
  return { ctx, inserts, sendCalls, rpcCalls, claims };
}

const freshCall = { id: 'L1', contact_id: 'c1', source_type: 'call', direction: 'inbound', answered: true, duration_sec: 42, spam_flag: false, occurred_at: minsAgo(5), created_at: minsAgo(5) };
const missedCall = { id: 'L2', contact_id: 'c1', source_type: 'call', direction: 'inbound', answered: false, duration_sec: 0, spam_flag: false, occurred_at: minsAgo(5), created_at: minsAgo(5) };
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
  it('fires ONLY on an explicitly unanswered call', () => {
    expect(isMissedCall(missedCall, NOW, 60)).toBe(true);
  });

  it('does not fire for an answered call', () => {
    expect(isMissedCall(freshCall, NOW, 60)).toBe(false);
  });

  it('does not fire when the outcome is UNKNOWN — absent data is never "missed"', () => {
    // The core defect. Under the old duration proxy every one of these was
    // treated as a missed call, because Number(null)===0 and Number(undefined)
    // is NaN, and neither is > 0.
    const noAnsweredKey = { ...missedCall };
    delete noAnsweredKey.answered; // the column absent entirely (pre-migration row)
    expect(isMissedCall(noAnsweredKey, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, answered: null }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, answered: undefined }, NOW, 60)).toBe(false);
    // A non-boolean is a contract violation, not a confirmed miss.
    expect(isMissedCall({ ...missedCall, answered: 'false' }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, answered: 0 }, NOW, 60)).toBe(false);
  });

  it('does not fire for an ANSWERED call whose duration is not populated yet', () => {
    // The regression that would text someone we had just spoken to. Duration is
    // absent mid-window, but the provider already said the call was answered.
    expect(isMissedCall({ ...freshCall, duration_sec: null }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...freshCall, duration_sec: undefined }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...freshCall, duration_sec: 0 }, NOW, 60)).toBe(false);
  });

  it('ignores duration entirely — answered is the only outcome signal', () => {
    // A confirmed miss with ring time recorded still fires...
    expect(isMissedCall({ ...missedCall, duration_sec: 25 }, NOW, 60)).toBe(true);
    // ...and a confirmed answer never does, whatever the duration says.
    expect(isMissedCall({ ...freshCall, duration_sec: 0 }, NOW, 60)).toBe(false);
  });

  it('does not fire for spam', () => {
    expect(isMissedCall({ ...missedCall, spam_flag: true }, NOW, 60)).toBe(false);
  });

  it('keeps the other exclusions: form, outbound, no contact, outside the window', () => {
    expect(isMissedCall({ ...missedCall, source_type: 'form' }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, direction: 'outbound' }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, contact_id: null }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, occurred_at: minsAgo(120), created_at: minsAgo(120) }, NOW, 60)).toBe(false);
    expect(isMissedCall(null, NOW, 60)).toBe(false);
  });

  it('waits for the settling delay before acting on a just-ended call', () => {
    // Still in flight: the provider record is not final yet, so stay silent.
    const justNow = { ...missedCall, occurred_at: minsAgo(1), created_at: minsAgo(1) };
    expect(isMissedCall(justNow, NOW, 60)).toBe(false);
    // Once settled, it fires.
    expect(isMissedCall({ ...missedCall, occurred_at: minsAgo(4), created_at: minsAgo(4) }, NOW, 60)).toBe(true);
    // Explicit override is honoured (0 disables the delay).
    expect(isMissedCall(justNow, NOW, 60, 0)).toBe(true);
  });

  it('treats an unusable timestamp as not settled', () => {
    expect(isMissedCall({ ...missedCall, occurred_at: 'not-a-date', created_at: null }, NOW, 60)).toBe(false);
    expect(isMissedCall({ ...missedCall, occurred_at: null, created_at: null }, NOW, 60)).toBe(false);
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

  // 2026-07-25: no_consent moved from terminal → deferrable. Previously a missed call from an
  // unconsented number wrote a terminal row, so alreadyFired() returned true forever and the
  // textback could never fire even after that person later consented. Consent is a state that
  // changes (admin attestation, or inbound START), so it belongs with quiet_hours, not with dnd.
  it('does NOT write a terminal row for no_consent — consent can arrive later', async () => {
    const { ctx, inserts } = makeCtx({
      leads: [freshCall],
      sendResult: { ok: false, skipped: true, reason: 'no_consent' },
    });
    await runSpeedToLead(ctx);
    expect(inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });

  it('sends on a later run once consent is recorded, instead of being burned forever', async () => {
    // Run 1: refused for no_consent → nothing terminal, so the lead stays a candidate.
    const run1 = makeCtx({ leads: [freshCall], sendResult: { ok: false, skipped: true, reason: 'no_consent' } });
    await runSpeedToLead(run1.ctx);
    expect(run1.inserts.find((i) => i.table === 'system_events')).toBeFalsy();
    // Run 2 (an admin has since attested prior consent): it fires and records terminal.
    const run2 = makeCtx({ leads: [freshCall], firedEvents: [], sendResult: { ok: true, sid: 'SM_consent' } });
    expect(await runSpeedToLead(run2.ctx)).toBe(1);
    expect(run2.inserts.find((i) => i.table === 'system_events')).toBeTruthy();
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

  it('writes a terminal reconciliation row on an AMBIGUOUS failure so it is not resubmitted', async () => {
    const first = makeCtx({
      leads: [freshCall],
      sendResult: {
        ok: false,
        skipped: false,
        error: 'Provider response was not received',
        permanent: false,
        ambiguous: true,
      },
    });
    await runSpeedToLead(first.ctx);
    const ev = first.inserts.find((i) => i.table === 'system_events');
    expect(ev).toBeTruthy();
    expect(ev.data.payload).toMatchObject({
      outcome: 'failed',
      reason: 'ambiguous_provider_outcome',
      reconciliation_required: true,
    });

    // A later worker run sees the terminal event and never reaches the provider.
    const second = makeCtx({ leads: [freshCall], firedEvents: [ev.data] });
    expect(await runSpeedToLead(second.ctx)).toBe(0);
    expect(second.sendCalls).toHaveLength(0);
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

// ─── Claim fence: the duplicate-send window (closed 2026-07-25) ───────────────
// The old ordering was check → send → write marker. A crash between the send
// and the marker meant the text went out unrecorded and the next cron tick sent
// it AGAIN. A duplicate automated text is per-message TCPA exposure, and
// missed-call text-back is aimed at people with no prior relationship.
describe('fixed-automation claim fence', () => {
  it('claims BEFORE sending, then finalizes — never the reverse order', async () => {
    const { ctx, rpcCalls, sendCalls } = makeCtx({ leads: [missedCall] });
    expect(await runMissedCallTextback(ctx)).toBe(1);

    const claimIdx = rpcCalls.findIndex((c) => c.fn === 'claim_fixed_automation');
    const finalIdx = rpcCalls.findIndex((c) => c.fn === 'finalize_fixed_automation_claim');
    expect(claimIdx).toBe(0);              // the claim is the first thing that happens
    expect(sendCalls).toHaveLength(1);     // ...and only then do we send
    expect(finalIdx).toBeGreaterThan(claimIdx);
    expect(rpcCalls[claimIdx].params).toMatchObject({
      p_automation_key: 'missed_call_textback',
      p_entity_type: 'inbound_lead',
      p_entity_id: 'L2',
    });
  });

  it('THE FIX: a crash that loses the system_events marker cannot cause a resend', async () => {
    // Tick 1 sends and takes the claim.
    const claims = new Map();
    const first = makeCtx({ leads: [missedCall], claims });
    expect(await runMissedCallTextback(first.ctx)).toBe(1);
    expect(first.sendCalls).toHaveLength(1);

    // Tick 2: system_events has NO record of it (firedEvents stays empty — this
    // is the crash/failed-insert the old code could not survive). The surviving
    // claim must still block the second text.
    const second = makeCtx({ leads: [missedCall], firedEvents: [], claims });
    expect(await runMissedCallTextback(second.ctx)).toBe(0);
    expect(second.sendCalls).toHaveLength(0);
  });

  it('suppresses a duplicate when two ticks race the same entity', async () => {
    const claims = new Map();
    const a = makeCtx({ leads: [freshCall], claims });
    const b = makeCtx({ leads: [freshCall], claims });
    const [sentA, sentB] = await Promise.all([runSpeedToLead(a.ctx), runSpeedToLead(b.ctx)]);
    // Exactly one of the two ticks may send.
    expect(sentA + sentB).toBe(1);
    expect(a.sendCalls.length + b.sendCalls.length).toBe(1);
  });

  it('releases the claim on a deferrable skip so it retries once the condition lifts', async () => {
    const claims = new Map();
    // Quiet hours: nothing was sent, so the entity must stay a candidate.
    const held = makeCtx({
      leads: [missedCall], claims,
      sendResult: { ok: false, skipped: true, reason: 'quiet_hours' },
    });
    expect(await runMissedCallTextback(held.ctx)).toBe(0);
    expect(held.rpcCalls.some((c) => c.fn === 'release_fixed_automation_claim')).toBe(true);
    expect(claims.size).toBe(0); // released — not stuck
    // No terminal row was written, so it is still eligible.
    expect(held.inserts.find((i) => i.table === 'system_events')).toBeFalsy();

    // Later tick, quiet hours over → it now sends.
    const later = makeCtx({ leads: [missedCall], claims });
    expect(await runMissedCallTextback(later.ctx)).toBe(1);
    expect(later.sendCalls).toHaveLength(1);
  });

  it('releases the claim on a transient send failure so it retries', async () => {
    const claims = new Map();
    const failed = makeCtx({
      leads: [missedCall], claims,
      sendResult: { ok: false, skipped: false, error: 'boom' }, // not permanent, not ambiguous
    });
    expect(await runMissedCallTextback(failed.ctx)).toBe(0);
    expect(claims.size).toBe(0);
    expect(failed.inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });

  it('KEEPS the claim on a durable skip (dnd) — no repeat even if the marker is lost', async () => {
    const claims = new Map();
    const blocked = makeCtx({
      leads: [missedCall], claims,
      sendResult: { ok: false, skipped: true, reason: 'dnd' },
    });
    expect(await runMissedCallTextback(blocked.ctx)).toBe(0);
    expect(claims.size).toBe(1); // durable refusal — do not pester
    expect(blocked.rpcCalls.some((c) => c.fn === 'release_fixed_automation_claim')).toBe(false);

    const retry = makeCtx({ leads: [missedCall], firedEvents: [], claims });
    expect(await runMissedCallTextback(retry.ctx)).toBe(0);
    expect(retry.sendCalls).toHaveLength(0);
  });

  it('KEEPS the claim on an ambiguous provider outcome (may have sent — never resend)', async () => {
    const claims = new Map();
    const amb = makeCtx({
      leads: [missedCall], claims,
      sendResult: { ok: false, skipped: false, ambiguous: true, error: 'timeout after accept' },
    });
    expect(await runMissedCallTextback(amb.ctx)).toBe(0);
    expect(claims.size).toBe(1);
    const ev = amb.inserts.find((i) => i.table === 'system_events');
    expect(ev.data.payload.reconciliation_required).toBe(true);
  });

  it('fails CLOSED when the claim RPC is unavailable (worker deployed before its migration)', async () => {
    const { ctx, sendCalls, inserts } = makeCtx({ leads: [missedCall], claimThrows: true });
    expect(await runMissedCallTextback(ctx)).toBe(0);
    expect(sendCalls).toHaveLength(0); // refuses to send unfenced
    expect(inserts.find((i) => i.table === 'system_events')).toBeFalsy();
  });

  it('releases the claim when send() THROWS, so a network blip cannot strand a lead', async () => {
    // There is deliberately no stale-claim recovery, so an unreleased claim is
    // permanent. A throw upstream of the provider (PostgREST 5xx on the contact
    // or template lookup) sent nothing and must not cost us the lead forever.
    const claims = new Map();
    const boom = makeCtx({ leads: [missedCall], claims });
    boom.ctx.send = async () => { throw new Error('PostgREST 500'); };
    expect(await runMissedCallTextback(boom.ctx)).toBe(0);
    expect(claims.size).toBe(0); // released, not stranded
    expect(boom.inserts.find((i) => i.table === 'system_events')).toBeFalsy();

    // The entity is still a candidate on the next tick.
    const retry = makeCtx({ leads: [missedCall], claims });
    expect(await runMissedCallTextback(retry.ctx)).toBe(1);
  });

  it('does not abort the batch when post-send bookkeeping fails', async () => {
    // Two leads; the first one's system_events insert blows up. The second must
    // still be processed, and the first must keep its claim (blocking a resend).
    const twoLeads = [missedCall, { ...missedCall, id: 'L9' }];
    const claims = new Map();
    const c = makeCtx({ leads: twoLeads, claims });
    c.ctx.db.insert = async (table, data) => {
      if (table === 'system_events' && data.entity_id === 'L2') throw new Error('insert failed');
      return [data];
    };
    expect(await runMissedCallTextback(c.ctx)).toBe(2);
    expect(c.sendCalls).toHaveLength(2);
    expect(claims.has('missed_call_textback|L2')).toBe(true); // still claimed → no resend
  });

  it('checks the terminal system_events history BEFORE taking a claim', async () => {
    // Entities that already fired (pre-migration history) must never re-fire,
    // and must not consume a claim row either.
    const { ctx, rpcCalls, sendCalls } = makeCtx({ leads: [missedCall], firedEvents: [{ id: 'e1' }] });
    expect(await runMissedCallTextback(ctx)).toBe(0);
    expect(sendCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });
});
