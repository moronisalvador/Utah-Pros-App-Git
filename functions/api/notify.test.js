/**
 * ════════════════════════════════════════════════
 * FILE: notify.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Notification Center dispatcher behaves, using a fake database and
 *   fake senders (no real network, no real Supabase). It checks: who an event is
 *   sent to (audience resolution), that a person's on/off preferences actually
 *   gate each channel, that a person with no email address is skipped and
 *   reported (never crashes), that push quietly no-ops when the server's VAPID
 *   keys aren't set yet, and that a dead phone subscription (404/410) gets pruned.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./notify.js (system under test) — db, web-push and email senders
 *              are all injected as fakes.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  resolveAudience,
  dispatchEvent,
  handleNotify,
  formatApptWhen,
  enrichAppointmentBody,
  enrichDatabasePresentationContext,
  enrichEstimateBody,
  enrichInboundMessageBody,
  isTechnicianQuietTime,
  nativeNotificationEventKey,
  guardedProducerEntity,
  GUARDED_PRODUCER_TYPES,
} from './notify.js';
import { fetchWithTimeout } from '../lib/http.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' };
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

// A flexible fake db. `types` maps type_key → catalog row; `prefsByEmp` maps
// employee id → the get_effective_notification_prefs rows; other collections are
// keyed by employee id. Records rpc/delete calls for assertions.
function makeDb(opts = {}) {
  const {
    types = {}, employees = [], prefsByEmp = {}, subsByEmp = {},
    emailByEmp = {}, crewByAppt = {}, apptsById = {}, estimatesById = {},
    contactsById = {}, presentationOverrides = {}, webhookSecret = null,
    selectErrorTable = null, conversationRecipients = {},
    conversationRecipientsError = false,
    timeRequestsById = {},
    validProducerDelivery = true,
    validGuardedTargetClaim = true,
    validReminderDelivery = true,
    validReminderTargetClaim = true,
    quietTimeByEmp = {},
  } = opts;
  const rpcCalls = [];
  const deletes = [];
  const deliveryClaims = new Set();
  return {
    rpcCalls, deletes,
    async select(table, query = '') {
      if (table === selectErrorTable) throw new Error('read failed');
      if (table === 'notification_types') {
        const m = /type_key=eq\.([^&]+)/.exec(query);
        const t = m && types[m[1]];
        return t ? [t] : [];
      }
      if (table === 'employees') {
        const authm = /auth_user_id=eq\.([^&]+)/.exec(query);
        if (authm) {
          const e = employees.find(x => x.auth_user_id === authm[1]);
          return e ? [e] : [];
        }
        const idm = /id=eq\.([^&]+)/.exec(query);
        if (idm) {
          const e = employees.find(x => x.id === idm[1]);
          return e
            ? [{
              ...e,
              email: emailByEmp[idm[1]] ?? null,
              full_name: e.full_name ?? null,
            }]
            : [{ email: emailByEmp[idm[1]] ?? null }];
        }
        const rolem = /role=in\.\(([^)]+)\)/.exec(query);
        if (rolem) {
          const roles = rolem[1].split(',');
          return employees.filter(e => roles.includes(e.role)
            && (!query.includes('is_active=eq.true') || e.is_active !== false));
        }
        return employees.filter(e => !query.includes('is_active=eq.true') || e.is_active !== false);
      }
      if (table === 'appointment_crew') {
        const m = /appointment_id=eq\.([^&]+)/.exec(query);
        const employee = /employee_id=eq\.([^&]+)/.exec(query);
        const id = /^id=eq\.([^&]+)/.exec(query);
        if (id) {
          const row = Object.entries(crewByAppt)
            .flatMap(([appointment_id, crew]) => crew.map((member) => ({
              appointment_id,
              ...member,
            })))
            .find((member) => member.id === id[1]);
          return row ? [row] : [];
        }
        const crew = (m && crewByAppt[m[1]]) || [];
        return employee ? crew.filter((row) => row.employee_id === employee[1]) : crew;
      }
      if (table === 'push_subscriptions') {
        const m = /employee_id=eq\.([^&]+)/.exec(query);
        return (m && subsByEmp[m[1]]) || [];
      }
      if (table === 'notification_presentation_overrides') {
        const type = /type_key=eq\.([^&]+)/.exec(query);
        const surface = /surface=eq\.([^&]+)/.exec(query);
        const key = type && surface
          ? `${decodeURIComponent(type[1])}:${surface[1]}`
          : '';
        return presentationOverrides[key] ? [presentationOverrides[key]] : [];
      }
      if (table === 'notification_quiet_time_preferences') {
        const employee = /employee_id=eq\.([^&]+)/.exec(query);
        return employee && quietTimeByEmp[employee[1]]
          ? [{ employee_id: employee[1] }]
          : [];
      }
      if (table === 'appointments') {
        const m = /id=eq\.([^&]+)/.exec(query);
        return (m && apptsById[m[1]]) ? [apptsById[m[1]]] : [];
      }
      if (table === 'time_entry_change_requests') {
        const m = /id=eq\.([^&]+)/.exec(query);
        const id = m ? decodeURIComponent(m[1]) : null;
        return id && timeRequestsById[id] ? [timeRequestsById[id]] : [];
      }
      if (table === 'estimates') {
        const m = /id=eq\.([^&]+)/.exec(query);
        return (m && estimatesById[m[1]]) ? [estimatesById[m[1]]] : [];
      }
      if (table === 'contacts') {
        const m = /id=eq\.([^&]+)/.exec(query);
        return (m && contactsById[m[1]]) ? [contactsById[m[1]]] : [];
      }
      if (table === 'integration_config') {
        if (query.includes('notify_webhook_secret')) return webhookSecret ? [{ value: webhookSecret }] : [];
        return [];
      }
      return [];
    },
    async rpc(fn, params) {
      rpcCalls.push({ fn, params });
      if (fn === 'get_effective_notification_prefs') return prefsByEmp[params.p_employee_id] || [];
      if (fn === 'get_conversation_notification_recipients') {
        if (conversationRecipientsError) throw new Error('recipient lookup failed');
        return (conversationRecipients[params.p_conversation_id] || [])
          .map((employee_id) => ({ employee_id }));
      }
      if (
        fn === 'claim_notification_delivery'
        || fn === 'claim_guarded_notification_target_delivery'
        || fn === 'claim_appointment_reminder_delivery'
      ) {
        if (
          fn === 'claim_guarded_notification_target_delivery'
          && (
            typeof validGuardedTargetClaim === 'function'
              ? !validGuardedTargetClaim(params)
              : !validGuardedTargetClaim
          )
        ) return false;
        if (
          fn === 'claim_appointment_reminder_delivery'
          && (
            typeof validReminderTargetClaim === 'function'
              ? !validReminderTargetClaim(params)
              : !validReminderTargetClaim
          )
        ) return false;
        if (deliveryClaims.has(params.p_delivery_key)) return false;
        deliveryClaims.add(params.p_delivery_key);
        return true;
      }
      if (
        fn === 'release_notification_delivery_claim'
        || fn === 'release_appointment_reminder_delivery_claim'
      ) {
        return deliveryClaims.delete(params.p_delivery_key);
      }
      if (fn === 'validate_notification_producer_delivery') {
        return typeof validProducerDelivery === 'function'
          ? validProducerDelivery(params)
          : validProducerDelivery;
      }
      if (fn === 'validate_appointment_reminder_delivery') {
        return typeof validReminderDelivery === 'function'
          ? validReminderDelivery(params)
          : validReminderDelivery;
      }
      return null;
    },
    async delete(table, filter) { deletes.push({ table, filter }); return null; },
  };
}

// Effective-prefs rows for one type across the three channels.
function prefRows(typeKey, { bell = false, push = false, email = false } = {}) {
  return [
    { type_key: typeKey, channel: 'bell', enabled: bell },
    { type_key: typeKey, channel: 'push', enabled: push },
    { type_key: typeKey, channel: 'email', enabled: email },
  ];
}

describe('resolveAudience', () => {
  it('feedback.submitted → admins minus the submitter', async () => {
    const db = makeDb({ employees: [
      { id: 'a1', role: 'admin' }, { id: 'a2', role: 'admin' }, { id: 'sub', role: 'admin' },
      { id: 't1', role: 'field_tech' },
    ] });
    const ids = await resolveAudience(db, 'feedback.submitted', { exclude_employee_id: 'sub' });
    expect(ids.sort()).toEqual(['a1', 'a2']);
  });

  it('explicit recipient_ids win and are de-duped', async () => {
    const db = makeDb({ employees: [{ id: 'x' }, { id: 'y' }] });
    const ids = await resolveAudience(db, 'anything', { recipient_ids: ['x', 'x', 'y'] });
    expect(ids.sort()).toEqual(['x', 'y']);
  });

  it('appointment.assigned → the crewed employee', async () => {
    const db = makeDb({
      employees: [{ id: 'emp-9' }, { id: 'other' }],
      crewByAppt: {
        'ap-1': [
          { employee_id: 'emp-9' },
          { employee_id: 'other' },
        ],
      },
    });
    const ids = await resolveAudience(db, 'appointment.assigned', {
      appointment_id: 'ap-1',
      employee_id: 'emp-9',
      recipient_ids: ['other'],
    });
    expect(ids).toEqual(['emp-9']);
  });

  it('appointment.updated → the crew of the appointment', async () => {
    const db = makeDb({
      employees: [{ id: 'c1' }, { id: 'c2' }, { id: 'outsider' }],
      crewByAppt: { 'ap-1': [{ employee_id: 'c1' }, { employee_id: 'c2' }] },
    });
    const ids = await resolveAudience(db, 'appointment.updated', {
      appointment_id: 'ap-1',
      recipient_ids: ['outsider'],
    });
    expect(ids.sort()).toEqual(['c1', 'c2']);
  });

  it('appointment.canceled ignores explicit recipients and keeps current crew', async () => {
    const db = makeDb({
      employees: [{ id: 'crew' }, { id: 'outsider' }],
      crewByAppt: { 'ap-1': [{ employee_id: 'crew' }] },
    });
    await expect(resolveAudience(db, 'appointment.canceled', {
      appointment_id: 'ap-1',
      recipient_ids: ['outsider'],
    })).resolves.toEqual(['crew']);
  });

  it('appointment.assigned fails closed unless the named employee is current crew', async () => {
    const db = makeDb({
      employees: [{ id: 'crew' }, { id: 'outsider' }],
      crewByAppt: { 'ap-1': [{ employee_id: 'crew' }] },
    });
    await expect(resolveAudience(db, 'appointment.assigned', {
      appointment_id: 'ap-1',
      employee_id: 'outsider',
      recipient_ids: ['outsider'],
    })).resolves.toEqual([]);
  });

  it('appointment.reminder targets only the named current active internal crew member', async () => {
    const db = makeDb({
      employees: [
        { id: 'named', role: 'field_tech', is_active: true, is_external: false },
        { id: 'other-crew', role: 'field_tech', is_active: true, is_external: false },
        { id: 'admin', role: 'admin', is_active: true, is_external: false },
        { id: 'inactive', role: 'field_tech', is_active: false, is_external: false },
        { id: 'external', role: 'field_tech', is_active: true, is_external: true },
      ],
      crewByAppt: {
        'ap-1': [
          { employee_id: 'named' },
          { employee_id: 'other-crew' },
          { employee_id: 'inactive' },
          { employee_id: 'external' },
        ],
      },
    });

    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
      employee_id: 'named',
      recipient_ids: ['admin', 'other-crew'],
    })).resolves.toEqual(['named']);
    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
      employee_id: 'admin',
      recipient_ids: ['admin'],
    })).resolves.toEqual([]);
    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
      employee_id: 'inactive',
    })).resolves.toEqual([]);
    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
      employee_id: 'external',
    })).resolves.toEqual([]);
    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
    })).resolves.toEqual([]);
  });

  it('appointment.reminder follows exact crew membership for every internal role', async () => {
    const db = makeDb({
      employees: [
        { id: 'assigned-admin', role: 'admin', is_active: true, is_external: false },
        { id: 'unassigned-office', role: 'office', is_active: true, is_external: false },
      ],
      crewByAppt: {
        'ap-1': [{ employee_id: 'assigned-admin' }],
      },
    });

    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
      employee_id: 'assigned-admin',
      recipient_ids: ['unassigned-office'],
    })).resolves.toEqual(['assigned-admin']);
    await expect(resolveAudience(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
      employee_id: 'unassigned-office',
      recipient_ids: ['unassigned-office'],
    })).resolves.toEqual([]);
  });

  it('clock.abandoned → admins plus the affected tech from the payload', async () => {
    const db = makeDb({ employees: [
      { id: 'a1', role: 'admin' }, { id: 'a2', role: 'admin' },
      { id: 't1', role: 'field_tech' },
    ] });
    const ids = await resolveAudience(db, 'clock.abandoned', { payload: { employee_id: 't1' } });
    expect(ids.sort()).toEqual(['a1', 'a2', 't1']);
  });

  it('fails closed for inactive, external, and unknown explicit recipients', async () => {
    const db = makeDb({ employees: [
      { id: 'active', is_active: true, is_external: false },
      { id: 'inactive', is_active: false, is_external: false },
      { id: 'external', is_active: true, is_external: true },
    ] });
    const ids = await resolveAudience(db, 'anything', {
      recipient_ids: ['active', 'inactive', 'external', 'missing'],
    });
    expect(ids).toEqual(['active']);
  });

  it('message.inbound fails closed without a valid conversation id', async () => {
    const db = makeDb({ employees: [
      { id: 'active-admin', role: 'admin', is_active: true, is_external: false },
    ] });
    await expect(resolveAudience(db, 'message.inbound')).resolves.toEqual([]);
    await expect(resolveAudience(db, 'message.inbound', {
      recipient_ids: ['active-admin'],
    })).resolves.toEqual([]);
    await expect(resolveAudience(db, 'message.inbound', {
      recipient_ids: ['active-admin'],
      data: { conversation_id: 'not-a-uuid' },
    })).resolves.toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it('message.inbound uses only database-scoped active internal recipients', async () => {
    const db = makeDb({
      employees: [
        { id: 'stale-admin', role: 'admin', is_active: true, is_external: false },
        { id: 'tech', role: 'field_tech', is_active: true, is_external: false },
        { id: 'inactive', role: 'field_tech', is_active: false, is_external: false },
        { id: 'external', role: 'field_tech', is_active: true, is_external: true },
      ],
      conversationRecipients: {
        [CONVERSATION_ID]: ['tech', 'inactive', 'external'],
      },
    });

    await expect(resolveAudience(db, 'message.inbound', {
      recipient_ids: ['stale-admin'],
      data: { conversation_id: CONVERSATION_ID },
    })).resolves.toEqual(['tech']);
    expect(db.rpcCalls).toContainEqual({
      fn: 'get_conversation_notification_recipients',
      params: { p_conversation_id: CONVERSATION_ID },
    });
  });

  it('message.inbound fails closed when scoped recipient lookup errors', async () => {
    const db = makeDb({
      employees: [{ id: 'admin', role: 'admin', is_active: true, is_external: false }],
      conversationRecipientsError: true,
    });
    await expect(resolveAudience(db, 'message.inbound', {
      recipient_ids: ['admin'],
      data: { conversation_id: CONVERSATION_ID },
    })).resolves.toEqual([]);
  });

  it('message.outbound alerts the rest of the thread but never its author', async () => {
    const db = makeDb({
      employees: [
        { id: 'sender', role: 'admin', is_active: true, is_external: false },
        { id: 'teammate', role: 'field_tech', is_active: true, is_external: false },
        { id: 'inactive', role: 'field_tech', is_active: false, is_external: false },
        { id: 'external', role: 'field_tech', is_active: true, is_external: true },
      ],
      conversationRecipients: {
        [CONVERSATION_ID]: ['sender', 'teammate', 'inactive', 'external'],
      },
    });

    await expect(resolveAudience(db, 'message.outbound', {
      data: { conversation_id: CONVERSATION_ID },
      exclude_employee_id: 'sender',
    })).resolves.toEqual(['teammate']);
    expect(db.rpcCalls).toContainEqual({
      fn: 'get_conversation_notification_recipients',
      params: { p_conversation_id: CONVERSATION_ID },
    });
  });

  it('message.outbound cannot widen its audience past conversation access', async () => {
    const db = makeDb({
      employees: [
        { id: 'sender', role: 'admin', is_active: true, is_external: false },
        { id: 'outsider', role: 'admin', is_active: true, is_external: false },
        { id: 'teammate', role: 'field_tech', is_active: true, is_external: false },
      ],
      conversationRecipients: { [CONVERSATION_ID]: ['sender', 'teammate'] },
    });

    // A producer-supplied recipient list is not authority for message content:
    // the database predicate still owns the audience.
    await expect(resolveAudience(db, 'message.outbound', {
      recipient_ids: ['outsider'],
      data: { conversation_id: CONVERSATION_ID },
      exclude_employee_id: 'sender',
    })).resolves.toEqual(['teammate']);
  });

  it('message.note uses the same access predicate and author exclusion', async () => {
    const db = makeDb({
      employees: [
        { id: 'author', role: 'admin', is_active: true, is_external: false },
        { id: 'teammate', role: 'field_tech', is_active: true, is_external: false },
        { id: 'external', role: 'field_tech', is_active: true, is_external: true },
      ],
      conversationRecipients: {
        [CONVERSATION_ID]: ['author', 'teammate', 'external'],
      },
    });

    await expect(resolveAudience(db, 'message.note', {
      data: { conversation_id: CONVERSATION_ID },
      exclude_employee_id: 'author',
    })).resolves.toEqual(['teammate']);
  });

  it('message.note fails closed without a valid conversation id', async () => {
    const db = makeDb({
      employees: [{ id: 'admin', role: 'admin', is_active: true, is_external: false }],
    });
    await expect(resolveAudience(db, 'message.note')).resolves.toEqual([]);
    await expect(resolveAudience(db, 'message.note', {
      recipient_ids: ['admin'],
      data: { conversation_id: 'not-a-uuid' },
    })).resolves.toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it('message.outbound fails closed without a valid conversation id or on lookup error', async () => {
    const db = makeDb({
      employees: [{ id: 'admin', role: 'admin', is_active: true, is_external: false }],
    });
    await expect(resolveAudience(db, 'message.outbound')).resolves.toEqual([]);
    await expect(resolveAudience(db, 'message.outbound', {
      data: { conversation_id: 'not-a-uuid' },
      exclude_employee_id: 'someone',
    })).resolves.toEqual([]);
    expect(db.rpcCalls).toEqual([]);

    const errorDb = makeDb({
      employees: [{ id: 'admin', role: 'admin', is_active: true, is_external: false }],
      conversationRecipientsError: true,
    });
    await expect(resolveAudience(errorDb, 'message.outbound', {
      data: { conversation_id: CONVERSATION_ID },
      exclude_employee_id: 'admin',
    })).resolves.toEqual([]);
  });

  it('timesheet.change_requested ignores supplied recipients and targets active internal admins', async () => {
    const requestId = '44444444-4444-4444-8444-444444444444';
    const requesterId = '55555555-5555-4555-8555-555555555555';
    const db = makeDb({
      employees: [
        { id: 'admin', role: 'admin', is_active: true, is_external: false },
        { id: 'inactive-admin', role: 'admin', is_active: false, is_external: false },
        { id: 'external-admin', role: 'admin', is_active: true, is_external: true },
        { id: requesterId, role: 'field_tech', is_active: true, is_external: false },
        { id: 'forged', role: 'field_tech', is_active: true, is_external: false },
      ],
      timeRequestsById: {
        [requestId]: {
          id: requestId,
          entry_id: 'entry-1',
          requested_by: requesterId,
          status: 'pending',
          review_note: null,
        },
      },
    });

    await expect(resolveAudience(db, 'timesheet.change_requested', {
      entity_type: 'time_entry_change_request',
      entity_id: requestId,
      recipient_ids: ['forged'],
      employee_id: 'forged',
    })).resolves.toEqual(['admin']);
  });

  it('timesheet.change_reviewed ignores supplied recipients and targets the canonical requester', async () => {
    const requestId = '44444444-4444-4444-8444-444444444444';
    const requesterId = '55555555-5555-4555-8555-555555555555';
    const db = makeDb({
      employees: [
        { id: requesterId, role: 'field_tech', is_active: true, is_external: false },
        { id: 'forged', role: 'admin', is_active: true, is_external: false },
      ],
      timeRequestsById: {
        [requestId]: {
          id: requestId,
          entry_id: 'entry-1',
          requested_by: requesterId,
          status: 'approved',
          review_note: null,
        },
      },
    });

    await expect(resolveAudience(db, 'timesheet.change_reviewed', {
      entity_type: 'time_entry_change_request',
      entity_id: requestId,
      recipient_ids: ['forged'],
      employee_id: 'forged',
    })).resolves.toEqual([requesterId]);
  });

  it('timesheet audiences fail closed without an exact canonical request', async () => {
    await expect(resolveAudience(
      makeDb({ employees: [{ id: 'admin', role: 'admin' }] }),
      'timesheet.change_requested',
      {
        entity_type: 'time_entry_change_request',
        entity_id: '44444444-4444-4444-8444-444444444444',
        recipient_ids: ['admin'],
      },
    )).resolves.toEqual([]);
  });

  it('assigned and crew audiences exclude inactive and external employees', async () => {
    const db = makeDb({
      employees: [
        { id: 'active', is_active: true, is_external: false },
        { id: 'inactive', is_active: false, is_external: false },
        { id: 'external', is_active: true, is_external: true },
      ],
      crewByAppt: {
        'ap-1': [
          { employee_id: 'active' },
          { employee_id: 'inactive' },
          { employee_id: 'external' },
        ],
      },
    });
    expect(await resolveAudience(db, 'appointment.assigned', {
      appointment_id: 'ap-1',
      employee_id: 'inactive',
    })).toEqual([]);
    expect(await resolveAudience(db, 'appointment.updated', {
      appointment_id: 'ap-1',
    })).toEqual(['active']);
  });
});

describe('dispatchEvent — channel gating by effective prefs', () => {
  const baseType = { type_key: 'feedback.submitted', label: 'Feedback', enabled: true };

  it('uses the exact Denver quiet-time boundaries in summer and winter', () => {
    expect(isTechnicianQuietTime(new Date('2026-08-01T23:29:00Z'))).toBe(false);
    expect(isTechnicianQuietTime(new Date('2026-08-01T23:30:00Z'))).toBe(true);
    expect(isTechnicianQuietTime(new Date('2026-08-01T13:59:00Z'))).toBe(true);
    expect(isTechnicianQuietTime(new Date('2026-08-01T14:00:00Z'))).toBe(false);
    expect(isTechnicianQuietTime(new Date('2026-01-15T00:30:00Z'))).toBe(true);
    expect(isTechnicianQuietTime(new Date('2026-01-15T15:00:00Z'))).toBe(false);
  });

  it('fails closed inside quiet time when the preference lookup errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T23:30:00Z'));
    try {
      const db = makeDb({
        types: { 'feedback.submitted': baseType },
        employees: [{ id: 'a1', role: 'admin' }],
        prefsByEmp: { a1: prefRows('feedback.submitted', { bell: true, push: true }) },
        selectErrorTable: 'notification_quiet_time_preferences',
      });
      const sendWebPushImpl = vi.fn();

      const out = await dispatchEvent({
        db,
        env: ENV,
        typeKey: 'feedback.submitted',
        body: {},
        sendWebPushImpl,
      });

      expect(out.results[0]).toMatchObject({
        skipped: true,
        reason: 'technician_quiet_time_lookup_failed',
      });
      expect(db.rpcCalls.filter((call) => call.fn === 'create_notification')).toHaveLength(0);
      expect(sendWebPushImpl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a disabled type without touching anyone', async () => {
    const db = makeDb({ types: { 'feedback.submitted': { ...baseType, enabled: false } } });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'feedback.submitted', body: {} });
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('type_disabled');
    expect(db.rpcCalls.filter(c => c.fn === 'create_notification')).toHaveLength(0);
  });

  it.each([
    ['appointment.assigned', {
      appointment_id: '22222222-2222-4222-8222-222222222222',
      employee_id: '33333333-3333-4333-8333-333333333333',
    }],
    ['appointment.updated', {
      appointment_id: '22222222-2222-4222-8222-222222222222',
    }],
    ['appointment.canceled', {
      appointment_id: '22222222-2222-4222-8222-222222222222',
    }],
    ['timesheet.change_requested', {
      entity_type: 'time_entry_change_request',
      entity_id: '44444444-4444-4444-8444-444444444444',
    }],
    ['timesheet.change_reviewed', {
      entity_type: 'time_entry_change_request',
      entity_id: '44444444-4444-4444-8444-444444444444',
    }],
  ])('rejects %s without a database-backed occurrence UUID', async (
    typeKey,
    body,
  ) => {
    const type = { type_key: typeKey, label: 'Guarded event', enabled: true };
    const db = makeDb({ types: { [typeKey]: type } });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey,
      body: { ...body, notification_event_id: 'caller-value' },
    });

    expect(out).toMatchObject({
      skipped: true,
      reason: 'missing_notification_event_id',
      recipients: 0,
    });
    expect(db.rpcCalls).toEqual([]);
  });

  it.each([
    ['appointment.assigned', {
      appointment_crew_id: '33333333-3333-4333-8333-333333333333',
    }, {
      crewByAppt: {
        '22222222-2222-4222-8222-222222222222': [{
          id: '33333333-3333-4333-8333-333333333333',
          employee_id: 'employee-1',
        }],
      },
    }],
    ['appointment.updated', {
      appointment_id: '22222222-2222-4222-8222-222222222222',
    }, {}],
    ['appointment.canceled', {
      appointment_id: '22222222-2222-4222-8222-222222222222',
    }, {}],
    ['timesheet.change_requested', {
      entity_type: 'time_entry_change_request',
      entity_id: '44444444-4444-4444-8444-444444444444',
    }, {}],
    ['timesheet.change_reviewed', {
      entity_type: 'time_entry_change_request',
      entity_id: '44444444-4444-4444-8444-444444444444',
    }, {}],
  ])('rejects %s when its occurrence does not match its entity', async (
    typeKey,
    body,
    database,
  ) => {
    const db = makeDb({
      types: {
        [typeKey]: { type_key: typeKey, label: 'Guarded event', enabled: true },
      },
      validProducerDelivery: false,
      ...database,
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey,
      body: {
        ...body,
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(out).toMatchObject({
      skipped: true,
      reason: 'invalid_notification_occurrence',
      recipients: 0,
    });
  });

  it('re-resolves inbound membership on retry instead of reusing a stale audience', async () => {
    const conversationRecipients = { [CONVERSATION_ID]: ['tech'] };
    const db = makeDb({
      types: {
        'message.inbound': {
          type_key: 'message.inbound',
          label: 'New text message',
          enabled: true,
        },
      },
      employees: [{ id: 'tech', role: 'field_tech', is_active: true, is_external: false }],
      prefsByEmp: { tech: prefRows('message.inbound', { bell: true }) },
      conversationRecipients,
    });
    const body = {
      notification_event_id: 'same-inbound-occurrence',
      data: { conversation_id: CONVERSATION_ID },
    };

    await dispatchEvent({ db, env: ENV, typeKey: 'message.inbound', body });
    conversationRecipients[CONVERSATION_ID] = [];
    await dispatchEvent({ db, env: ENV, typeKey: 'message.inbound', body });

    expect(db.rpcCalls.filter((call) => call.fn === 'create_notification')).toHaveLength(1);
    expect(
      db.rpcCalls.filter(
        (call) => call.fn === 'get_conversation_notification_recipients',
      ),
    ).toHaveLength(2);
  });

  it('bell on / push off / email off → one bell row, nothing else', async () => {
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { bell: true }) },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'feedback.submitted', body: { title: 'Hi' } });
    expect(out.recipients).toBe(1);
    const bells = db.rpcCalls.filter(c => c.fn === 'create_notification');
    expect(bells).toHaveLength(1);
    expect(bells[0].params.p_recipient_id).toBe('a1');
    expect(bells[0].params.p_type_key).toBe('feedback.submitted');
    expect(out.results[0].push.attempted).toBe(0);
  });

  it('push on → sends to each subscription and counts a success', async () => {
    const sends = [];
    const sendWebPushImpl = async (sub) => { sends.push(sub.endpoint); return { ok: true, status: 201 }; };
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
      subsByEmp: { a1: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }] },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'feedback.submitted', body: {}, sendWebPushImpl });
    expect(sends).toEqual(['https://push/1']);
    expect(out.results[0].push).toMatchObject({ sent: 1, attempted: 1, pruned: 0 });
  });

  it('defaults in-process Web Push dispatch to the bounded transport', async () => {
    const sendWebPushImpl = vi.fn(async (_subscription, _payload, _env, options) => {
      expect(options.fetchImpl).toBe(fetchWithTimeout);
      return { ok: true, status: 201 };
    });
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
      subsByEmp: {
        a1: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }],
      },
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body: {},
      sendWebPushImpl,
    });

    expect(sendWebPushImpl).toHaveBeenCalledOnce();
    expect(out.results[0].push).toMatchObject({ sent: 1, attempted: 1, pruned: 0 });
  });

  it('makes the validated presentation route authoritative over producer data', async () => {
    const payloads = [];
    const db = makeDb({
      types: {
        'message.inbound': {
          type_key: 'message.inbound',
          label: 'New text message',
          enabled: true,
        },
      },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('message.inbound', { push: true }) },
      subsByEmp: {
        a1: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }],
      },
      presentationOverrides: {
        'message.inbound:pwa_push': {
          title_template: 'Customer message',
          body_template: 'Open Utah Pros to reply.',
          route_id: 'field.home',
          contract_version: 1,
        },
      },
      conversationRecipients: { [CONVERSATION_ID]: ['a1'] },
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'message.inbound',
      body: {
        recipient_ids: ['a1'],
        notification_event_id: 'message-event-1',
        data: {
          conversation_id: CONVERSATION_ID,
          url: '/tech/conversations?c=producer-choice',
          secret_metadata: 'must-not-cross-provider-boundary',
        },
      },
      sendNativePushImpl: async () => ({
        sent: 0,
        attempted: 0,
        pruned: 0,
        skipped: true,
        reason: 'no_tokens',
      }),
      sendWebPushImpl: async (_subscription, payload) => {
        payloads.push(JSON.parse(payload));
        return { ok: true, status: 201 };
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].url).toBe('/tech');
    expect(payloads[0].data).toEqual({ url: '/tech' });
    expect(JSON.stringify(payloads[0])).not.toContain('producer-choice');
    expect(JSON.stringify(payloads[0])).not.toContain('secret_metadata');
  });

  it('routes native APNs through the same preference-gated dispatcher', async () => {
    const nativeSends = [];
    const sendNativePushImpl = vi.fn(async (input) => {
      nativeSends.push(input);
      return { sent: 1, attempted: 1, pruned: 0 };
    });
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
    });
    const body = {
      notification_event_id: 'feedback-event-1',
      title: 'New feedback',
      body: 'A technician sent feedback.',
      entity_type: 'tech_feedback',
      entity_id: 'feedback-1',
      data: { url: '/tech/settings' },
    };

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body,
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).toHaveBeenCalledOnce();
    expect(nativeSends[0]).toMatchObject({
      db,
      env: ENV,
      employeeId: 'a1',
      typeKey: 'feedback.submitted',
      notificationBody: body,
      eventKey: nativeNotificationEventKey(baseType, body, 'a1'),
      fetchImpl: fetchWithTimeout,
    });
    expect(out.results[0].push).toMatchObject({
      sent: 1,
      attempted: 1,
      pruned: 0,
      native: { sent: 1, attempted: 1, pruned: 0 },
    });
  });

  it('does not invoke native APNs when push preference is off', async () => {
    const sendNativePushImpl = vi.fn();
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { bell: true }) },
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body: {},
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).not.toHaveBeenCalled();
  });

  it('uses the source-event occurrence to separate identical notification copy', () => {
    const type = {
      type_key: 'appointment.updated',
      label: 'Appointment updated',
    };
    const first = nativeNotificationEventKey(type, {
      notification_event_id: '11111111-1111-4111-8111-111111111111',
      entity_type: 'appointment',
      entity_id: 'appointment-1',
      title: 'Appointment updated',
      body: 'Tomorrow at 9',
    }, 'employee-1');
    const replay = nativeNotificationEventKey(type, {
      notification_event_id: '11111111-1111-4111-8111-111111111111',
      entity_type: 'appointment',
      entity_id: 'appointment-1',
      title: 'Appointment updated',
      body: 'Tomorrow at 9',
    }, 'employee-1');
    const distinct = nativeNotificationEventKey(type, {
      notification_event_id: '22222222-2222-4222-8222-222222222222',
      entity_type: 'appointment',
      entity_id: 'appointment-1',
      title: 'Appointment updated',
      body: 'Tomorrow at 9',
    }, 'employee-1');

    expect(replay).toBe(first);
    expect(distinct).not.toBe(first);
    expect(nativeNotificationEventKey(type, {
      entity_id: 'appointment-1',
      title: 'Appointment updated',
    }, 'employee-1')).toBeNull();
  });

  it('derives only canonical guarded producer entities', () => {
    expect(guardedProducerEntity('appointment.updated', {
      appointment_id: '11111111-1111-4111-8111-111111111111',
    })).toEqual({
      entityType: 'appointment',
      entityId: '11111111-1111-4111-8111-111111111111',
    });
    expect(guardedProducerEntity('timesheet.change_reviewed', {
      entity_type: 'time_entry_change_request',
      entity_id: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      entityType: 'time_entry_change_request',
      entityId: '22222222-2222-4222-8222-222222222222',
    });
    expect(guardedProducerEntity('timesheet.change_reviewed', {
      entity_type: 'appointment',
      entity_id: '22222222-2222-4222-8222-222222222222',
    })).toBeNull();
  });

  it('keeps appointment reminders outside the exact five guarded producers', () => {
    expect([...GUARDED_PRODUCER_TYPES].sort()).toEqual([
      'appointment.assigned',
      'appointment.canceled',
      'appointment.updated',
      'timesheet.change_requested',
      'timesheet.change_reviewed',
    ]);
    expect(GUARDED_PRODUCER_TYPES.has('appointment.reminder')).toBe(false);
  });

  it('skips native APNs when the producer omits a stable occurrence id', async () => {
    const sendNativePushImpl = vi.fn();
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body: { title: 'No occurrence identity' },
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).not.toHaveBeenCalled();
    expect(out.results[0].push.native).toMatchObject({
      skipped: true,
      reason: 'missing_notification_event_id',
    });
  });

  it('retries native delivery without duplicating bell, Web Push, or email', async () => {
    const sendNativePushImpl = vi.fn(async () => ({
      sent: 1,
      attempted: 1,
      pruned: 0,
    }));
    const sendWebPushImpl = vi.fn(async () => ({ ok: true, status: 201 }));
    const sendEmailImpl = vi.fn(async () => ({ ok: true }));
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: {
        a1: prefRows('feedback.submitted', {
          bell: true,
          push: true,
          email: true,
        }),
      },
      subsByEmp: {
        a1: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }],
      },
      emailByEmp: { a1: 'admin@example.test' },
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body: {
        notification_event_id: 'feedback-native-retry-1',
        title: 'Retry only native',
      },
      nativeRetryOnly: true,
      sendNativePushImpl,
      sendWebPushImpl,
      sendEmailImpl,
    });

    expect(sendNativePushImpl).toHaveBeenCalledOnce();
    expect(sendWebPushImpl).not.toHaveBeenCalled();
    expect(sendEmailImpl).not.toHaveBeenCalled();
    expect(db.rpcCalls.filter((call) => call.fn === 'create_notification')).toHaveLength(0);
    expect(out.results[0]).toMatchObject({
      bell: false,
      email: 'off',
      push: { native: { sent: 1 } },
    });
  });

  it('uses the typed native destination instead of arbitrary producer data', async () => {
    const sendNativePushImpl = vi.fn(async () => ({
      sent: 1,
      attempted: 1,
      pruned: 0,
    }));
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: {
        a1: prefRows('feedback.submitted', { push: true }),
      },
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body: {
        notification_event_id: 'feedback-event-2',
        entity_type: 'tech_feedback',
        entity_id: 'feedback-1',
        data: {
          url: '/tech/settings',
          phone: '+18015550123',
          provider_id: 'private',
        },
      },
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        typeKey: 'feedback.submitted',
        notificationBody: expect.objectContaining({
          entity_type: 'tech_feedback',
          entity_id: 'feedback-1',
        }),
      }),
    );
  });

  it('continues fan-out when one push subscription throws and reports the later success', async () => {
    const sends = [];
    const sendWebPushImpl = async (sub) => {
      sends.push(sub.endpoint);
      if (sub.endpoint.endsWith('/1')) throw new Error('push unavailable');
      return { ok: true, status: 201 };
    };
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
      subsByEmp: {
        a1: [
          { id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' },
          { id: 's2', endpoint: 'https://push/2', p256dh: 'p', auth: 'a' },
        ],
      },
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'feedback.submitted',
      body: {},
      sendWebPushImpl,
    });

    expect(sends).toEqual(['https://push/1', 'https://push/2']);
    expect(out).toMatchObject({
      type_key: 'feedback.submitted',
      recipients: 1,
      results: [{
        recipient_id: 'a1',
        push: { sent: 1, attempted: 2, pruned: 0 },
      }],
    });
  });

  it('prunes a 410 (dead) subscription', async () => {
    const sendWebPushImpl = async () => ({ ok: false, status: 410 });
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
      subsByEmp: { a1: [{ id: 's-dead', endpoint: 'https://push/x', p256dh: 'p', auth: 'a' }] },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'feedback.submitted', body: {}, sendWebPushImpl });
    expect(out.results[0].push.pruned).toBe(1);
    expect(db.deletes).toEqual([{ table: 'push_subscriptions', filter: 'id=eq.s-dead' }]);
  });

  it('reports VAPID-missing (503-skip) without throwing', async () => {
    const sendWebPushImpl = async () => ({ skipped: true, status: 503 });
    const db = makeDb({
      types: { 'feedback.submitted': baseType },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('feedback.submitted', { push: true }) },
      subsByEmp: { a1: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }] },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'feedback.submitted', body: {}, sendWebPushImpl });
    expect(out.results[0].push.vapidMissing).toBe(true);
    expect(out.results[0].push.sent).toBe(0);
  });

  it('email on but recipient has no address → skipped_null (reported, no send)', async () => {
    const emails = [];
    const sendEmailImpl = async (_env, msg) => { emails.push(msg.to); return { ok: true }; };
    const db = makeDb({
      types: { 'estimate.accepted': { type_key: 'estimate.accepted', label: 'Estimate', enabled: true } },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('estimate.accepted', { email: true }) },
      emailByEmp: { a1: null },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'estimate.accepted', body: {}, sendEmailImpl });
    expect(emails).toHaveLength(0);
    expect(out.results[0].email).toBe('skipped_null');
  });

  it('email on with an address → sends via the injected mailer', async () => {
    const emails = [];
    const sendEmailImpl = async (_env, msg) => { emails.push(msg); return { ok: true }; };
    const db = makeDb({
      types: { 'estimate.accepted': { type_key: 'estimate.accepted', label: 'Estimate', enabled: true } },
      employees: [{ id: 'a1', role: 'admin' }],
      prefsByEmp: { a1: prefRows('estimate.accepted', { email: true }) },
      emailByEmp: { a1: 'admin@utahpros.com' },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'estimate.accepted', body: { title: 'Accepted' }, sendEmailImpl });
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('admin@utahpros.com');
    expect(emails[0].from).toMatch(/Notifications <restoration@utahpros\.app>/);
    expect(out.results[0].email).toBe('sent');
  });
});

describe('message.inbound deep links', () => {
  it('keeps bell navigation in the office inbox and sends push to the exact field-PWA thread', async () => {
    expect(enrichInboundMessageBody({
      link: '/conversations',
      entity_type: 'conversation',
      entity_id: CONVERSATION_ID,
      data: { conversation_id: CONVERSATION_ID, route: '/conversations' },
    })).toMatchObject({
      link: `/conversations?c=${CONVERSATION_ID}`,
      data: {
        conversation_id: CONVERSATION_ID,
        route: '/conversations',
        url: `/tech/conversations?c=${CONVERSATION_ID}`,
      },
    });

    const pushes = [];
    const db = makeDb({
      types: {
        'message.inbound': {
          type_key: 'message.inbound',
          label: 'New text message',
          enabled: true,
        },
      },
      employees: [{ id: 'admin-1', role: 'admin' }],
      prefsByEmp: {
        'admin-1': prefRows('message.inbound', { bell: true, push: true }),
      },
      subsByEmp: {
        'admin-1': [{
          id: 'subscription-1',
          endpoint: 'https://push/1',
          p256dh: 'p',
          auth: 'a',
        }],
      },
      conversationRecipients: { [CONVERSATION_ID]: ['admin-1'] },
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'message.inbound',
      body: {
        link: '/conversations',
        entity_type: 'conversation',
        entity_id: CONVERSATION_ID,
        data: { conversation_id: CONVERSATION_ID },
      },
      sendWebPushImpl: async (_subscription, payload) => {
        pushes.push(JSON.parse(payload));
        return { ok: true, status: 201 };
      },
    });

    const bell = db.rpcCalls.find((call) => call.fn === 'create_notification');
    expect(bell.params.p_link).toBe(`/conversations?c=${CONVERSATION_ID}`);
    expect(pushes[0].url).toBe(`/tech/conversations?c=${CONVERSATION_ID}`);
  });
});

describe('formatApptWhen', () => {
  it('formats a date + time range as "Wkd, Mon D · h:mm AM – h:mm PM"', () => {
    expect(formatApptWhen('2026-07-04', '09:00:00', '11:00:00')).toBe('Sat, Jul 4 · 9:00 AM – 11:00 AM');
  });
  it('handles a start with no end (single time)', () => {
    expect(formatApptWhen('2026-07-04', '14:30:00', null)).toBe('Sat, Jul 4 · 2:30 PM');
  });
  it('is off-by-one safe (date anchored at UTC noon)', () => {
    // A date-only value must render as that same calendar day, not the day before.
    expect(formatApptWhen('2026-01-01', '00:00:00', null)).toBe('Thu, Jan 1 · 12:00 AM');
  });
  it('date only, no times', () => {
    expect(formatApptWhen('2026-07-04', null, null)).toBe('Sat, Jul 4');
  });
});

describe('enrichDatabasePresentationContext', () => {
  it('derives a timesheet employee name from typed database rows, not display copy', async () => {
    const db = {
      select: vi.fn(async (table) => {
        if (table === 'time_entry_change_requests') {
          return [{ requested_by: 'employee-1' }];
        }
        if (table === 'employees') {
          return [{
            full_name: 'Alex Morgan',
            is_active: true,
            is_external: false,
          }];
        }
        return [];
      }),
    };
    const body = {
      entity_id: 'request-1',
      body: 'Forged display copy with a secret',
      presentation_context: { employee_name: 'Forged Name' },
    };

    await expect(enrichDatabasePresentationContext(
      db,
      'timesheet.change_requested',
      body,
    )).resolves.toMatchObject({
      presentation_context: { employee_name: 'Alex Morgan' },
    });
  });

  it('uses the typed clock employee id and falls back when the lookup is not active/internal', async () => {
    const db = {
      select: vi.fn(async () => [{
        full_name: 'Should not render',
        is_active: false,
        is_external: false,
      }]),
    };
    const body = {
      title: 'Forged Name may have forgotten to clock out',
      payload: { employee_id: 'employee-1', minutes: 270 },
      presentation_context: { employee_name: 'Forged Name' },
    };

    const enriched = await enrichDatabasePresentationContext(
      db,
      'clock.abandoned',
      body,
    );
    expect(enriched).not.toBe(body);
    expect(enriched.presentation_context).not.toHaveProperty('employee_name');
  });
});

describe('dispatchEvent — canonical timesheet producer context', () => {
  const requestId = '44444444-4444-4444-8444-444444444444';
  const requesterId = '55555555-5555-4555-8555-555555555555';
  const occurrenceId = '66666666-6666-4666-8666-666666666666';

  it('ignores forged request recipients, copy, links, and payload', async () => {
    const db = makeDb({
      types: {
        'timesheet.change_requested': {
          type_key: 'timesheet.change_requested',
          label: 'Timesheet change request',
          enabled: true,
        },
      },
      employees: [
        {
          id: 'admin',
          role: 'admin',
          full_name: 'Office Admin',
          is_active: true,
          is_external: false,
        },
        {
          id: requesterId,
          role: 'field_tech',
          full_name: 'Alex Morgan',
          is_active: true,
          is_external: false,
        },
        { id: 'forged', role: 'field_tech', is_active: true, is_external: false },
      ],
      timeRequestsById: {
        [requestId]: {
          id: requestId,
          entry_id: 'entry-canonical',
          requested_by: requesterId,
          status: 'pending',
          review_note: null,
        },
      },
      prefsByEmp: {
        admin: prefRows('timesheet.change_requested', { bell: true }),
        forged: prefRows('timesheet.change_requested', { bell: true }),
      },
      validProducerDelivery: (params) => (
        params.p_employee_id === null || params.p_employee_id === 'admin'
      ),
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'timesheet.change_requested',
      body: {
        notification_event_id: occurrenceId,
        entity_type: 'time_entry_change_request',
        entity_id: requestId,
        recipient_ids: ['forged'],
        employee_id: 'forged',
        title: 'Forged title',
        body: 'Forged sensitive copy',
        link: 'https://attacker.example',
        payload: { entry_id: 'forged-entry', proposed: { hours: 999 } },
      },
    });

    expect(out.recipients).toBe(1);
    expect(out.results[0].recipient_id).toBe('admin');
    const bell = db.rpcCalls.find((call) => call.fn === 'create_notification');
    expect(bell.params).toMatchObject({
      p_recipient_id: 'admin',
      p_title: 'Timesheet change requested',
      p_body: 'A technician requested a correction to a time entry.',
      p_link: '/time-tracking',
      p_entity_type: 'time_entry_change_request',
      p_entity_id: requestId,
      p_payload: { entry_id: 'entry-canonical' },
    });
  });

  it('uses review status, note, and requester from the canonical row', async () => {
    const db = makeDb({
      types: {
        'timesheet.change_reviewed': {
          type_key: 'timesheet.change_reviewed',
          label: 'Timesheet change reviewed',
          enabled: true,
        },
      },
      employees: [
        {
          id: requesterId,
          role: 'field_tech',
          is_active: true,
          is_external: false,
        },
        { id: 'forged', role: 'admin', is_active: true, is_external: false },
      ],
      timeRequestsById: {
        [requestId]: {
          id: requestId,
          entry_id: 'entry-canonical',
          requested_by: requesterId,
          status: 'rejected',
          review_note: 'Please correct the travel time.',
        },
      },
      prefsByEmp: {
        [requesterId]: prefRows('timesheet.change_reviewed', { bell: true }),
        forged: prefRows('timesheet.change_reviewed', { bell: true }),
      },
      validProducerDelivery: (params) => (
        params.p_employee_id === null || params.p_employee_id === requesterId
      ),
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'timesheet.change_reviewed',
      body: {
        notification_event_id: occurrenceId,
        entity_type: 'time_entry_change_request',
        entity_id: requestId,
        recipient_ids: ['forged'],
        employee_id: 'forged',
        title: 'Timesheet change approved',
        body: 'Forged review note',
        link: 'https://attacker.example',
        payload: { approved: true },
      },
    });

    expect(out.recipients).toBe(1);
    expect(out.results[0].recipient_id).toBe(requesterId);
    const bell = db.rpcCalls.find((call) => call.fn === 'create_notification');
    expect(bell.params).toMatchObject({
      p_recipient_id: requesterId,
      p_title: 'Timesheet change rejected',
      p_body: 'Please correct the travel time.',
      p_link: '/time-tracking',
      p_entity_type: 'time_entry_change_request',
      p_entity_id: requestId,
      p_payload: { entry_id: 'entry-canonical', approved: false },
    });
  });

  it('fails closed when a reviewed occurrence still points at a pending request', async () => {
    const db = makeDb({
      types: {
        'timesheet.change_reviewed': {
          type_key: 'timesheet.change_reviewed',
          label: 'Timesheet change reviewed',
          enabled: true,
        },
      },
      timeRequestsById: {
        [requestId]: {
          id: requestId,
          entry_id: 'entry-canonical',
          requested_by: requesterId,
          status: 'pending',
          review_note: null,
        },
      },
    });

    await expect(dispatchEvent({
      db,
      env: ENV,
      typeKey: 'timesheet.change_reviewed',
      body: {
        notification_event_id: occurrenceId,
        entity_type: 'time_entry_change_request',
        entity_id: requestId,
      },
    })).resolves.toMatchObject({
      skipped: true,
      reason: 'invalid_notification_occurrence',
      recipients: 0,
    });
  });
});

describe('enrichAppointmentBody', () => {
  it('builds clean copy, customer/job variables, and a deep link from a bare appointment_id', async () => {
    const db = makeDb({
      apptsById: {
        'ap-1': {
          title: 'Water Mitigation',
          date: '2026-07-04',
          time_start: '09:00:00',
          time_end: '11:00:00',
          jobs: {
            insured_name: 'Jordan Lee',
            job_number: 'JOB-1042',
            estimated_value: 8500,
            approved_value: 7950,
            invoiced_value: 5250,
            collected_value: 2500,
          },
        },
      },
    });
    const out = await enrichAppointmentBody(db, 'appointment.assigned', { appointment_id: 'ap-1' });
    expect(out.title).toBe('New appointment · Water Mitigation');
    expect(out.body).toBe('Sat, Jul 4 · 9:00 AM – 11:00 AM');
    expect(out.presentation_context).toEqual({
      appointment_title: 'Water Mitigation',
      appointment_when: 'Sat, Jul 4 · 9:00 AM – 11:00 AM',
      customer_name: 'Jordan Lee',
      job_number: 'JOB-1042',
      job_estimated_amount: '$8,500.00',
      job_approved_amount: '$7,950.00',
      job_invoiced_amount: '$5,250.00',
      job_collected_amount: '$2,500.00',
    });
    // Office path, not /tech/appointment/ap-1. A notification does not know who will
    // open it; the reader's shell translates (src/lib/techShellRoutes.js). Storing the
    // field path put desktop dispatchers in the phone UI.
    expect(out.link).toBe('/schedule/appointment/ap-1');
    // PUSH-01: the bell keeps the office path, but Web Push must carry an
    // allowlisted field path — the service worker validates the raw URL and
    // never runs linkForCurrentShell.
    expect(out.data.url).toBe('/tech/appointment/ap-1');
    expect(out.entity_type).toBe('appointment');
    expect(out.entity_id).toBe('ap-1');
  });
  it('builds the reminder wording and client-aware fallback body without overrides', async () => {
    const db = makeDb({
      apptsById: {
        'ap-1': {
          title: 'Moisture check',
          date: '2026-07-31',
          time_start: '09:00:00',
          time_end: '11:00:00',
          jobs: { insured_name: 'Jordan Lee' },
        },
      },
    });
    const out = await enrichAppointmentBody(db, 'appointment.reminder', {
      appointment_id: 'ap-1',
    });
    expect(out).toMatchObject({
      title: 'Appointment in one hour · Moisture check',
      body: 'Jordan Lee · Fri, Jul 31 · 9:00 AM – 11:00 AM',
      link: '/schedule/appointment/ap-1',
      data: { url: '/tech/appointment/ap-1' },
      presentation_context: {
        appointment_title: 'Moisture check',
        appointment_when: 'Fri, Jul 31 · 9:00 AM – 11:00 AM',
        customer_name: 'Jordan Lee',
      },
    });
  });
  it('does not clobber a caller-supplied push destination', async () => {
    const db = makeDb({ apptsById: { 'ap-1': { title: 'X', date: '2026-07-04', time_start: '09:00:00' } } });
    const out = await enrichAppointmentBody(db, 'appointment.assigned', {
      appointment_id: 'ap-1',
      data: { url: '/tech/appointment/ap-1?from=test', keep: 'me' },
    });
    expect(out.data.url).toBe('/tech/appointment/ap-1?from=test');
    expect(out.data.keep).toBe('me');
  });
  it('uses the verb alone when the appointment has no title', async () => {
    const db = makeDb({ apptsById: { 'ap-2': { title: null, date: '2026-07-04', time_start: '08:00:00', time_end: null } } });
    const out = await enrichAppointmentBody(db, 'appointment.canceled', { appointment_id: 'ap-2' });
    expect(out.title).toBe('Appointment canceled');
    expect(out.body).toBe('Sat, Jul 4 · 8:00 AM');
  });
  it('leaves a caller-supplied title untouched', async () => {
    const db = makeDb({ apptsById: { 'ap-1': { title: 'X', date: '2026-07-04', time_start: '09:00:00' } } });
    const body = { appointment_id: 'ap-1', title: 'Already set' };
    expect(await enrichAppointmentBody(db, 'appointment.updated', body)).toMatchObject({
      title: 'Already set',
      presentation_context: {
        appointment_title: 'X',
        appointment_when: 'Sat, Jul 4 · 9:00 AM',
        customer_name: '',
        job_number: '',
        job_estimated_amount: '',
        job_approved_amount: '',
        job_invoiced_amount: '',
        job_collected_amount: '',
      },
    });
  });
  it('returns the body unchanged when the appointment is not found (never throws)', async () => {
    const db = makeDb({ apptsById: {} });
    const body = { appointment_id: 'missing' };
    expect(await enrichAppointmentBody(db, 'appointment.assigned', body)).toBe(body);
  });
});

describe('dispatchEvent — appointment enrichment end-to-end', () => {
  const guardedAppointmentId = '22222222-2222-4222-8222-222222222222';
  const guardedCrewId = '33333333-3333-4333-8333-333333333333';

  it('the bell row carries the enriched date/time title + body', async () => {
    const db = makeDb({
      types: { 'appointment.assigned': { type_key: 'appointment.assigned', label: 'Appointment assigned', enabled: true } },
      employees: [{ id: 'emp-9' }],
      crewByAppt: {
        [guardedAppointmentId]: [{
          id: guardedCrewId,
          employee_id: 'emp-9',
        }],
      },
      apptsById: { [guardedAppointmentId]: { title: 'Water Mitigation', date: '2026-07-04', time_start: '09:00:00', time_end: '11:00:00' } },
      prefsByEmp: { 'emp-9': prefRows('appointment.assigned', { bell: true }) },
    });
    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.assigned',
      body: {
        appointment_id: guardedAppointmentId,
        appointment_crew_id: guardedCrewId,
        employee_id: 'emp-9',
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(out.recipients).toBe(1);
    const bell = db.rpcCalls.find(c => c.fn === 'create_notification');
    expect(bell.params.p_title).toBe('New appointment · Water Mitigation');
    expect(bell.params.p_body).toBe('Sat, Jul 4 · 9:00 AM – 11:00 AM');
    expect(bell.params.p_link).toBe(
      `/schedule/appointment/${guardedAppointmentId}`,
    );
  });

  // PUSH-01 regression guard. Before this, the pushed URL was the office path,
  // which public/sw-target.js does not allowlist for a bare push destination —
  // normalizePushTarget fell back to '/tech', so a tapped appointment push
  // opened the field dashboard with no appointment, for dispatchers as well as
  // field techs. Assert the exact URL handed to the push sender.
  it('pushes an allowlisted field appointment path, not the office bell path', async () => {
    const payloads = [];
    const sendWebPushImpl = async (_sub, payload) => {
      payloads.push(JSON.parse(payload));
      return { ok: true, status: 201 };
    };
    const db = makeDb({
      types: { 'appointment.assigned': { type_key: 'appointment.assigned', label: 'Appointment assigned', enabled: true } },
      employees: [{ id: 'emp-9' }],
      crewByAppt: {
        [guardedAppointmentId]: [{
          id: guardedCrewId,
          employee_id: 'emp-9',
        }],
      },
      apptsById: { [guardedAppointmentId]: { title: 'Water Mitigation', date: '2026-07-04', time_start: '09:00:00', time_end: '11:00:00' } },
      prefsByEmp: { 'emp-9': prefRows('appointment.assigned', { push: true }) },
      subsByEmp: { 'emp-9': [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }] },
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.assigned',
      body: {
        appointment_id: guardedAppointmentId,
        appointment_crew_id: guardedCrewId,
        employee_id: 'emp-9',
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
      sendWebPushImpl,
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].url).toBe(
      `/tech/appointment/${guardedAppointmentId}`,
    );
    expect(payloads[0].url).not.toBe(
      `/schedule/appointment/${guardedAppointmentId}`,
    );
  });

  it('claims guarded bell, PWA, and email delivery once per occurrence', async () => {
    const sendWebPushImpl = vi.fn(async () => ({ ok: true, status: 201 }));
    const sendNativePushImpl = vi.fn(async () => ({
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_not_configured',
    }));
    const sendEmailImpl = vi.fn(async () => ({ ok: true }));
    const db = makeDb({
      types: {
        'appointment.assigned': {
          type_key: 'appointment.assigned',
          label: 'Appointment assigned',
          enabled: true,
        },
      },
      employees: [{ id: 'emp-9' }],
      crewByAppt: {
        [guardedAppointmentId]: [{
          id: guardedCrewId,
          employee_id: 'emp-9',
        }],
      },
      apptsById: {
        [guardedAppointmentId]: {
          title: 'Water Mitigation',
          date: '2026-07-04',
          time_start: '09:00:00',
          time_end: '11:00:00',
        },
      },
      prefsByEmp: {
        'emp-9': prefRows('appointment.assigned', {
          bell: true,
          push: true,
          email: true,
        }),
      },
      subsByEmp: {
        'emp-9': [{
          id: 's1',
          endpoint: 'https://push/1',
          p256dh: 'p',
          auth: 'a',
        }],
      },
      emailByEmp: { 'emp-9': 'tech@example.test' },
    });
    const input = {
      db,
      env: ENV,
      typeKey: 'appointment.assigned',
      body: {
        appointment_id: guardedAppointmentId,
        appointment_crew_id: guardedCrewId,
        employee_id: 'emp-9',
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
      sendWebPushImpl,
      sendNativePushImpl,
      sendEmailImpl,
    };

    await dispatchEvent(input);
    const replay = await dispatchEvent(input);

    expect(sendNativePushImpl.mock.calls[0][0]).toMatchObject({
      employeeId: 'emp-9',
      typeKey: 'appointment.assigned',
      guardedProducerClaim: {
        notificationEventId: '11111111-1111-4111-8111-111111111111',
        typeKey: 'appointment.assigned',
        entityType: 'appointment_crew',
        entityId: guardedCrewId,
      },
    });
    expect(
      db.rpcCalls.filter((call) => call.fn === 'create_notification'),
    ).toHaveLength(1);
    expect(sendWebPushImpl).toHaveBeenCalledOnce();
    expect(sendEmailImpl).toHaveBeenCalledOnce();
    expect(sendEmailImpl.mock.calls[0][1].idempotencyKey).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(replay.results[0]).toMatchObject({
      bell: false,
      email: 'duplicate',
      push: { attempted: 0 },
    });
  });

  it('revalidates the recipient before native or other guarded delivery', async () => {
    const sendNativePushImpl = vi.fn();
    const sendWebPushImpl = vi.fn();
    const db = makeDb({
      types: {
        'appointment.assigned': {
          type_key: 'appointment.assigned',
          label: 'Appointment assigned',
          enabled: true,
        },
      },
      employees: [{ id: 'emp-9' }],
      crewByAppt: {
        [guardedAppointmentId]: [{
          id: guardedCrewId,
          employee_id: 'emp-9',
        }],
      },
      apptsById: {
        [guardedAppointmentId]: {
          title: 'Water Mitigation',
          date: '2026-07-04',
          time_start: '09:00:00',
          time_end: '11:00:00',
        },
      },
      prefsByEmp: {
        'emp-9': prefRows('appointment.assigned', { push: true }),
      },
      validProducerDelivery: (params) => params.p_employee_id === null,
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.assigned',
      body: {
        appointment_id: guardedAppointmentId,
        appointment_crew_id: guardedCrewId,
        employee_id: 'emp-9',
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
      sendNativePushImpl,
      sendWebPushImpl,
    });

    expect(out.results[0]).toMatchObject({
      skipped: true,
      reason: 'invalid_notification_occurrence',
    });
    expect(sendNativePushImpl).not.toHaveBeenCalled();
    expect(sendWebPushImpl).not.toHaveBeenCalled();
  });

  it('refuses stale PWA subscription authority inside the guarded target claim', async () => {
    const sendWebPushImpl = vi.fn();
    const db = makeDb({
      types: {
        'appointment.assigned': {
          type_key: 'appointment.assigned',
          label: 'Appointment assigned',
          enabled: true,
        },
      },
      employees: [{ id: 'emp-9', is_active: true, is_external: false }],
      crewByAppt: {
        [guardedAppointmentId]: [{
          id: guardedCrewId,
          employee_id: 'emp-9',
        }],
      },
      apptsById: {
        [guardedAppointmentId]: {
          title: 'Water Mitigation',
          date: '2026-07-04',
        },
      },
      prefsByEmp: {
        'emp-9': prefRows('appointment.assigned', { push: true }),
      },
      subsByEmp: {
        'emp-9': [{
          id: 'subscription-removed-after-read',
          endpoint: 'https://push/stale',
          p256dh: 'p',
          auth: 'a',
        }],
      },
      validGuardedTargetClaim: false,
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.assigned',
      body: {
        appointment_crew_id: guardedCrewId,
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
      sendWebPushImpl,
      sendNativePushImpl: vi.fn(async () => ({
        sent: 0,
        attempted: 0,
        pruned: 0,
      })),
    });

    expect(db.rpcCalls).toContainEqual({
      fn: 'claim_guarded_notification_target_delivery',
      params: expect.objectContaining({
        p_employee_id: 'emp-9',
        p_channel: 'pwa_push',
        p_source_id: 'subscription-removed-after-read',
        p_target: 'https://push/stale',
      }),
    });
    expect(sendWebPushImpl).not.toHaveBeenCalled();
  });

  it('refuses a stale email address inside the guarded target claim', async () => {
    const sendEmailImpl = vi.fn();
    const db = makeDb({
      types: {
        'appointment.assigned': {
          type_key: 'appointment.assigned',
          label: 'Appointment assigned',
          enabled: true,
        },
      },
      employees: [{ id: 'emp-9', is_active: true, is_external: false }],
      crewByAppt: {
        [guardedAppointmentId]: [{
          id: guardedCrewId,
          employee_id: 'emp-9',
        }],
      },
      apptsById: {
        [guardedAppointmentId]: {
          title: 'Water Mitigation',
          date: '2026-07-04',
        },
      },
      prefsByEmp: {
        'emp-9': prefRows('appointment.assigned', { email: true }),
      },
      emailByEmp: { 'emp-9': 'Old.Address@Example.test ' },
      validGuardedTargetClaim: false,
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.assigned',
      body: {
        appointment_crew_id: guardedCrewId,
        notification_event_id: '11111111-1111-4111-8111-111111111111',
      },
      sendEmailImpl,
    });

    expect(db.rpcCalls).toContainEqual({
      fn: 'claim_guarded_notification_target_delivery',
      params: expect.objectContaining({
        p_employee_id: 'emp-9',
        p_channel: 'email',
        p_source_id: null,
        p_target: 'old.address@example.test',
      }),
    });
    expect(sendEmailImpl).not.toHaveBeenCalled();
  });

  it('keeps reminder copy rich and sends only to the named technician', async () => {
    const appointmentId = '22222222-2222-4222-8222-222222222222';
    const employeeId = '33333333-3333-4333-8333-333333333333';
    const payloads = [];
    const nativeSends = [];
    const db = makeDb({
      types: {
        'appointment.reminder': {
          type_key: 'appointment.reminder',
          label: 'Appointment reminder',
          enabled: true,
        },
      },
      employees: [
        { id: employeeId, role: 'field_tech', is_active: true, is_external: false },
        { id: 'admin', role: 'admin', is_active: true, is_external: false },
      ],
      crewByAppt: { [appointmentId]: [{ employee_id: employeeId }] },
      apptsById: {
        [appointmentId]: {
          title: 'Moisture check',
          date: '2026-07-31',
          time_start: '09:00:00',
          time_end: '11:00:00',
          jobs: { insured_name: 'Jordan Lee' },
        },
      },
      prefsByEmp: {
        [employeeId]: prefRows('appointment.reminder', { bell: true, push: true }),
        admin: prefRows('appointment.reminder', { bell: true, push: true }),
      },
      subsByEmp: {
        [employeeId]: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }],
      },
    });

    const out = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.reminder',
      body: {
        appointment_id: appointmentId,
        employee_id: employeeId,
        recipient_ids: ['admin'],
        notification_event_id: 'reminder-occurrence-1',
      },
      sendWebPushImpl: async (_sub, payload) => {
        payloads.push(JSON.parse(payload));
        return { ok: true, status: 201 };
      },
      sendNativePushImpl: async (input) => {
        nativeSends.push(input);
        return { sent: 1, attempted: 1, pruned: 0 };
      },
    });

    expect(out.recipients).toBe(1);
    const bell = db.rpcCalls.find((call) => call.fn === 'create_notification');
    expect(bell.params).toMatchObject({
      p_title: 'Appointment in one hour · Moisture check',
      p_body: 'Jordan Lee · Fri, Jul 31 · 9:00 AM – 11:00 AM',
      p_recipient_id: employeeId,
      p_link: `/schedule/appointment/${appointmentId}`,
    });
    expect(payloads[0]).toMatchObject({
      title: 'Appointment in one hour · Moisture check',
      body: 'Jordan Lee · Fri, Jul 31 · 9:00 AM – 11:00 AM',
      url: `/tech/appointment/${appointmentId}`,
    });
    expect(nativeSends).toHaveLength(1);
    expect(nativeSends[0]).toMatchObject({
      employeeId,
      typeKey: 'appointment.reminder',
      eventKey: JSON.stringify([
        'appointment.reminder',
        employeeId,
        'reminder-occurrence-1',
      ]),
      notificationBody: {
        presentation_context: {
          customer_name: 'Jordan Lee',
          appointment_when: 'Fri, Jul 31 · 9:00 AM – 11:00 AM',
        },
      },
    });
    expect(db.rpcCalls).toContainEqual({
      fn: 'claim_appointment_reminder_delivery',
      params: expect.objectContaining({
        p_notification_event_id: 'reminder-occurrence-1',
        p_employee_id: employeeId,
        p_appointment_id: appointmentId,
        p_channel: 'bell',
        p_target: employeeId,
      }),
    });
    expect(nativeSends[0]).toMatchObject({
      appointmentReminderClaim: {
        notificationEventId: 'reminder-occurrence-1',
        appointmentId,
      },
    });
  });

  it('fails closed before every reminder channel when the occurrence cannot be validated', async () => {
    const appointmentId = '22222222-2222-4222-8222-222222222222';
    const employeeId = '33333333-3333-4333-8333-333333333333';
    const sendWebPushImpl = vi.fn();
    const sendNativePushImpl = vi.fn();
    const sendEmailImpl = vi.fn();
    const db = makeDb({
      types: {
        'appointment.reminder': {
          type_key: 'appointment.reminder',
          label: 'Appointment reminder',
          enabled: true,
        },
      },
      employees: [{
        id: employeeId,
        role: 'field_tech',
        is_active: true,
        is_external: false,
      }],
      crewByAppt: {
        [appointmentId]: [{ employee_id: employeeId }],
      },
      apptsById: {
        [appointmentId]: { title: 'Moisture check' },
      },
      prefsByEmp: {
        [employeeId]: prefRows('appointment.reminder', {
          bell: true,
          push: true,
          email: true,
        }),
      },
      validReminderDelivery: false,
    });

    const result = await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'appointment.reminder',
      body: {
        appointment_id: appointmentId,
        employee_id: employeeId,
        notification_event_id: 'reminder-occurrence-denied',
      },
      sendWebPushImpl,
      sendNativePushImpl,
      sendEmailImpl,
    });

    expect(result.results[0]).toMatchObject({
      skipped: true,
      reason: 'invalid_notification_occurrence',
    });
    expect(sendWebPushImpl).not.toHaveBeenCalled();
    expect(sendNativePushImpl).not.toHaveBeenCalled();
    expect(sendEmailImpl).not.toHaveBeenCalled();
    expect(db.rpcCalls.some((call) => call.fn === 'create_notification')).toBe(false);
  });

  it('deduplicates reminder bell, Web Push, and email on a replayed occurrence', async () => {
    const appointmentId = '22222222-2222-4222-8222-222222222222';
    const employeeId = '33333333-3333-4333-8333-333333333333';
    const sendWebPushImpl = vi.fn(async () => ({ ok: true, status: 201 }));
    const sendEmailImpl = vi.fn(async () => ({ ok: true }));
    const db = makeDb({
      types: {
        'appointment.reminder': {
          type_key: 'appointment.reminder',
          label: 'Appointment reminder',
          enabled: true,
        },
      },
      employees: [{
        id: employeeId,
        role: 'admin',
        is_active: true,
        is_external: false,
      }],
      emailByEmp: { [employeeId]: 'Crew@example.test' },
      crewByAppt: {
        [appointmentId]: [{ employee_id: employeeId }],
      },
      apptsById: {
        [appointmentId]: { title: 'Moisture check' },
      },
      prefsByEmp: {
        [employeeId]: prefRows('appointment.reminder', {
          bell: true,
          push: true,
          email: true,
        }),
      },
      subsByEmp: {
        [employeeId]: [{
          id: '11111111-1111-4111-8111-111111111111',
          endpoint: 'https://push/replay',
          p256dh: 'p',
          auth: 'a',
        }],
      },
    });
    const input = {
      db,
      env: ENV,
      typeKey: 'appointment.reminder',
      body: {
        appointment_id: appointmentId,
        employee_id: employeeId,
        notification_event_id: 'reminder-occurrence-replay',
      },
      sendWebPushImpl,
      sendNativePushImpl: vi.fn(async () => ({
        sent: 0,
        attempted: 0,
        pruned: 0,
      })),
      sendEmailImpl,
    };

    const first = await dispatchEvent(input);
    const replay = await dispatchEvent(input);

    expect(first.results[0]).toMatchObject({
      bell: true,
      email: 'sent',
    });
    expect(replay.results[0]).toMatchObject({
      bell: false,
      email: 'duplicate',
    });
    expect(db.rpcCalls.filter((call) => call.fn === 'create_notification'))
      .toHaveLength(1);
    expect(sendWebPushImpl).toHaveBeenCalledOnce();
    expect(sendEmailImpl).toHaveBeenCalledOnce();
    expect(sendEmailImpl.mock.calls[0][1].idempotencyKey).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe('enrichEstimateBody', () => {
  it('builds "Estimate {num} accepted" + amount · client + deep link', async () => {
    const db = makeDb({
      estimatesById: { 'e-1': { estimate_number: 'EST-1042', amount: 2500, approved_amount: null, contact_id: 'c-1', job_id: 'j-1' } },
      contactsById: { 'c-1': { name: 'Jane Homeowner' } },
    });
    const out = await enrichEstimateBody(db, { estimate_id: 'e-1' });
    expect(out.title).toBe('Estimate EST-1042 accepted');
    expect(out.body).toBe('$2,500.00 · Jane Homeowner');
    expect(out.link).toBe('/estimates/e-1');
    expect(out.entity_type).toBe('estimate');
    expect(out.job_id).toBe('j-1');
  });
  it('prefers approved_amount and tolerates a missing contact', async () => {
    const db = makeDb({ estimatesById: { 'e-2': { estimate_number: null, amount: 100, approved_amount: 3200.5, contact_id: null, job_id: null } } });
    const out = await enrichEstimateBody(db, { estimate_id: 'e-2' });
    expect(out.title).toBe('Estimate accepted');
    expect(out.body).toBe('$3,200.50');
  });
  it('returns the body unchanged when the estimate is not found', async () => {
    const db = makeDb({ estimatesById: {} });
    const body = { estimate_id: 'missing' };
    expect(await enrichEstimateBody(db, body)).toBe(body);
  });
});

describe('handleNotify — auth', () => {
  const APPOINTMENT_ID = '22222222-2222-4222-8222-222222222222';
  const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
  const ESTIMATE_ID = '44444444-4444-4444-8444-444444444444';

  function req({
    auth,
    secret,
    body = { type_key: 'appointment.updated', appointment_id: APPOINTMENT_ID },
    rawBody,
  } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = auth;
    if (secret !== undefined) headers['x-webhook-secret'] = secret;
    return new Request('https://app.test/api/notify', {
      method: 'POST',
      headers,
      body: rawBody ?? JSON.stringify(body),
    });
  }

  function admin(overrides = {}) {
    return {
      id: 'admin-1',
      auth_user_id: 'user-1',
      role: 'admin',
      is_active: true,
      is_external: false,
      ...overrides,
    };
  }

  function mockAuth({ status = 200 } = {}) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(status === 200 ? JSON.stringify({ id: 'user-1' }) : '', { status }),
    );
  }

  function dispatcher(result = { type_key: 'appointment.updated', recipients: 0, results: [] }) {
    return vi.fn().mockResolvedValue(result);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves 401 without any credential and never dispatches', async () => {
    const db = makeDb({});
    const dispatchImpl = dispatcher();
    const res = await handleNotify({ request: req({}), env: ENV, db, dispatchImpl });

    expect(res.status).toBe(401);
    expect(res.data).toEqual({ error: 'Missing Authorization header' });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when Auth configuration is absent', async () => {
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok' }),
      env: {},
      db: makeDb({ employees: [admin()] }),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 500, data: { error: 'Auth not configured' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the Auth service is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok' }),
      env: ENV,
      db: makeDb({ employees: [admin()] }),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 502, data: { error: 'Auth check failed' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('preserves invalid-session 401 and never dispatches', async () => {
    mockAuth({ status: 401 });
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok' }),
      env: ENV,
      db: makeDb({ employees: [admin()] }),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 401, data: { error: 'Invalid or expired token' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['missing employee', []],
    ['inactive admin', [admin({ is_active: false })]],
    ['external admin', [admin({ is_external: true })]],
    ['denied office role', [admin({ role: 'office' })]],
  ])('denies a %s before dispatch or provider fan-out', async (_label, employees) => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok' }),
      env: ENV,
      db: makeDb({ employees }),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 403, data: { error: 'Forbidden' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the employee lookup fails', async () => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok' }),
      env: ENV,
      db: makeDb({ employees: [admin()], selectErrorTable: 'employees' }),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 500, data: { error: 'Employee lookup failed' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('accepts the exact webhook secret and preserves its full deployed payload', async () => {
    const body = {
      type_key: 'timesheet.change_requested',
      recipient_ids: ['employee-9'],
      title: 'Server-derived title',
      body: 'Server-derived body',
      link: '/time-tracking',
    };
    const dispatchImpl = dispatcher({ type_key: body.type_key, recipients: 1, results: [] });
    const db = makeDb({ webhookSecret: 'sekret' });
    const res = await handleNotify({
      request: req({ secret: 'sekret', body }),
      env: ENV,
      db,
      dispatchImpl,
    });

    expect(res.status).toBe(200);
    expect(dispatchImpl).toHaveBeenCalledWith(expect.objectContaining({
      typeKey: body.type_key,
      body,
    }));
  });

  it('lets a matching secret bypass an expired Bearer without an Auth request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ secret: 'sekret', auth: 'Bearer expired' }),
      env: ENV,
      db: makeDb({ webhookSecret: 'sekret' }),
      dispatchImpl,
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dispatchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong webhook secret before a valid admin Bearer can fall through', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const db = makeDb({ webhookSecret: 'sekret' });
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ secret: 'nope', auth: 'Bearer tok' }),
      env: ENV,
      db,
      dispatchImpl,
    });

    expect(res).toEqual({ status: 401, data: { error: 'Invalid webhook secret' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty webhook secret before a valid admin Bearer can fall through', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const db = makeDb({ webhookSecret: 'sekret' });
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ secret: '', auth: 'Bearer tok' }),
      env: ENV,
      db,
      dispatchImpl,
    });

    expect(res).toEqual({ status: 401, data: { error: 'Invalid webhook secret' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('keeps a supplied secret fail-closed when its expected configuration is absent', async () => {
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ secret: 'sekret' }),
      env: ENV,
      db: makeDb({}),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 401, data: { error: 'Invalid webhook secret' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('preserves invalid JSON and missing type_key responses for an approved admin', async () => {
    mockAuth();
    const db = makeDb({ employees: [admin()] });
    const invalidDispatch = dispatcher();
    const invalid = await handleNotify({
      request: req({ auth: 'Bearer tok', rawBody: '{' }),
      env: ENV,
      db,
      dispatchImpl: invalidDispatch,
    });
    expect(invalid).toEqual({ status: 400, data: { error: 'Invalid JSON body' } });
    expect(invalidDispatch).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    mockAuth();
    const missingDispatch = dispatcher();
    const missing = await handleNotify({
      request: req({ auth: 'Bearer tok', body: {} }),
      env: ENV,
      db,
      dispatchImpl: missingDispatch,
    });
    expect(missing).toEqual({ status: 400, data: { error: 'type_key is required' } });
    expect(missingDispatch).not.toHaveBeenCalled();
  });

  it('allows an approved admin event and passes only its server-derived object scope', async () => {
    mockAuth();
    const expected = { type_key: 'estimate.accepted', recipients: 2, results: [] };
    const dispatchImpl = dispatcher(expected);
    const db = makeDb({
      employees: [admin()],
      estimatesById: { [ESTIMATE_ID]: { id: ESTIMATE_ID, status: 'approved' } },
    });
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: { type_key: 'estimate.accepted', estimate_id: ESTIMATE_ID },
      }),
      env: ENV,
      db,
      dispatchImpl,
    });

    expect(res).toEqual({ status: 200, data: expected });
    expect(dispatchImpl).toHaveBeenCalledWith(expect.objectContaining({
      typeKey: 'estimate.accepted',
      body: { estimate_id: ESTIMATE_ID },
    }));
  });

  it('threads the injected bounded transport through Auth and provider dispatch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
    );
    const dispatchImpl = dispatcher();
    const db = makeDb({
      employees: [admin()],
      estimatesById: { [ESTIMATE_ID]: { id: ESTIMATE_ID, status: 'approved' } },
    });
    const request = req({
      auth: 'Bearer tok',
      body: { type_key: 'estimate.accepted', estimate_id: ESTIMATE_ID },
    });

    const res = await handleNotify({
      request,
      env: ENV,
      db,
      fetchImpl,
      dispatchImpl,
    });

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://db.test/auth/v1/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
    expect(dispatchImpl).toHaveBeenCalledWith(expect.objectContaining({ fetchImpl }));
  });

  it.each([
    [
      'accepted estimate',
      { type_key: 'estimate.accepted', estimate_id: ESTIMATE_ID },
      { estimatesById: { [ESTIMATE_ID]: { id: ESTIMATE_ID, status: 'approved' } } },
      { estimate_id: ESTIMATE_ID },
    ],
  ])('allows an approved admin %s event after exact object proof', async (_label, body, scope, expectedBody) => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok', body }),
      env: ENV,
      db: makeDb({ employees: [admin()], ...scope }),
      dispatchImpl,
    });

    expect(res.status).toBe(200);
    expect(dispatchImpl).toHaveBeenCalledWith(expect.objectContaining({
      typeKey: body.type_key,
      body: expectedBody,
    }));
  });

  it('rejects unsupported human event types before dispatch', async () => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: { type_key: 'payment.received', payment_id: ESTIMATE_ID },
      }),
      env: ENV,
      db: makeDb({ employees: [admin()] }),
      dispatchImpl,
    });

    expect(res).toEqual({
      status: 400,
      data: { error: 'Unsupported type_key for Bearer dispatch' },
    });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'appointment.assigned',
    'appointment.updated',
    'appointment.canceled',
  ])('retires Bearer dispatch for guarded producer %s', async (typeKey) => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: { type_key: typeKey, appointment_id: APPOINTMENT_ID },
      }),
      env: ENV,
      db: makeDb({ employees: [admin()] }),
      dispatchImpl,
    });

    expect(res).toEqual({
      status: 400,
      data: { error: 'Unsupported type_key for Bearer dispatch' },
    });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('rejects forged recipients, message copy and links before dispatch', async () => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: {
          type_key: 'estimate.accepted',
          estimate_id: ESTIMATE_ID,
          recipient_ids: [EMPLOYEE_ID],
          title: 'Forged',
          body: 'Forged',
          link: 'https://example.test',
        },
      }),
      env: ENV,
      db: makeDb({ employees: [admin()] }),
      dispatchImpl,
    });

    expect(res).toEqual({
      status: 400,
      data: { error: 'Unsupported fields for Bearer dispatch' },
    });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('requires the deployed object state for accepted estimates', async () => {
    mockAuth();
    const estimateDispatch = dispatcher();
    const estimate = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: { type_key: 'estimate.accepted', estimate_id: ESTIMATE_ID },
      }),
      env: ENV,
      db: makeDb({
        employees: [admin()],
        estimatesById: { [ESTIMATE_ID]: { id: ESTIMATE_ID, status: 'draft' } },
      }),
      dispatchImpl: estimateDispatch,
    });
    expect(estimate).toEqual({ status: 404, data: { error: 'Notification object not found' } });
    expect(estimateDispatch).not.toHaveBeenCalled();
  });

  it('fails closed on an object-scope lookup error before dispatch', async () => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: { type_key: 'estimate.accepted', estimate_id: ESTIMATE_ID },
      }),
      env: ENV,
      db: makeDb({
        employees: [admin()],
        selectErrorTable: 'estimates',
      }),
      dispatchImpl,
    });

    expect(res).toEqual({
      status: 500,
      data: { error: 'Notification object lookup failed' },
    });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });
});
