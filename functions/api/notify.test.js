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
  enrichEstimateBody,
  enrichInboundMessageBody,
} from './notify.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' };

// A flexible fake db. `types` maps type_key → catalog row; `prefsByEmp` maps
// employee id → the get_effective_notification_prefs rows; other collections are
// keyed by employee id. Records rpc/delete calls for assertions.
function makeDb(opts = {}) {
  const {
    types = {}, employees = [], prefsByEmp = {}, subsByEmp = {},
    emailByEmp = {}, crewByAppt = {}, apptsById = {}, estimatesById = {},
    contactsById = {}, webhookSecret = null, selectErrorTable = null,
  } = opts;
  const rpcCalls = [];
  const deletes = [];
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
          return e ? [{ email: emailByEmp[idm[1]] ?? null, full_name: e.full_name ?? null }] : [{ email: emailByEmp[idm[1]] ?? null }];
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
        const crew = (m && crewByAppt[m[1]]) || [];
        return employee ? crew.filter((row) => row.employee_id === employee[1]) : crew;
      }
      if (table === 'push_subscriptions') {
        const m = /employee_id=eq\.([^&]+)/.exec(query);
        return (m && subsByEmp[m[1]]) || [];
      }
      if (table === 'appointments') {
        const m = /id=eq\.([^&]+)/.exec(query);
        return (m && apptsById[m[1]]) ? [apptsById[m[1]]] : [];
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
    const db = makeDb({ employees: [{ id: 'emp-9' }] });
    const ids = await resolveAudience(db, 'appointment.assigned', { employee_id: 'emp-9' });
    expect(ids).toEqual(['emp-9']);
  });

  it('appointment.updated → the crew of the appointment', async () => {
    const db = makeDb({
      employees: [{ id: 'c1' }, { id: 'c2' }],
      crewByAppt: { 'ap-1': [{ employee_id: 'c1' }, { employee_id: 'c2' }] },
    });
    const ids = await resolveAudience(db, 'appointment.updated', { appointment_id: 'ap-1' });
    expect(ids.sort()).toEqual(['c1', 'c2']);
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

  it('role fallback excludes inactive and external employees', async () => {
    const db = makeDb({ employees: [
      { id: 'active-admin', role: 'admin', is_active: true, is_external: false },
      { id: 'inactive-admin', role: 'admin', is_active: false, is_external: false },
      { id: 'external-admin', role: 'admin', is_active: true, is_external: true },
    ] });
    const ids = await resolveAudience(db, 'message.inbound');
    expect(ids).toEqual(['active-admin']);
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
      employee_id: 'inactive',
    })).toEqual([]);
    expect(await resolveAudience(db, 'appointment.updated', {
      appointment_id: 'ap-1',
    })).toEqual(['active']);
  });
});

describe('dispatchEvent — channel gating by effective prefs', () => {
  const baseType = { type_key: 'feedback.submitted', label: 'Feedback', enabled: true };

  it('skips a disabled type without touching anyone', async () => {
    const db = makeDb({ types: { 'feedback.submitted': { ...baseType, enabled: false } } });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'feedback.submitted', body: {} });
    expect(out.skipped).toBe(true);
    expect(out.reason).toBe('type_disabled');
    expect(db.rpcCalls.filter(c => c.fn === 'create_notification')).toHaveLength(0);
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
      entity_id: 'conversation-1',
      data: { conversation_id: 'conversation-1', route: '/conversations' },
    })).toMatchObject({
      link: '/conversations?c=conversation-1',
      data: {
        conversation_id: 'conversation-1',
        route: '/conversations',
        url: '/tech/conversations?c=conversation-1',
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
    });

    await dispatchEvent({
      db,
      env: ENV,
      typeKey: 'message.inbound',
      body: {
        link: '/conversations',
        entity_type: 'conversation',
        entity_id: 'conversation-1',
        data: { conversation_id: 'conversation-1' },
      },
      sendWebPushImpl: async (_subscription, payload) => {
        pushes.push(JSON.parse(payload));
        return { ok: true, status: 201 };
      },
    });

    const bell = db.rpcCalls.find((call) => call.fn === 'create_notification');
    expect(bell.params.p_link).toBe('/conversations?c=conversation-1');
    expect(pushes[0].url).toBe('/tech/conversations?c=conversation-1');
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

describe('enrichAppointmentBody', () => {
  it('builds a clean title + body + deep link from a bare appointment_id', async () => {
    const db = makeDb({ apptsById: { 'ap-1': { title: 'Water Mitigation', date: '2026-07-04', time_start: '09:00:00', time_end: '11:00:00' } } });
    const out = await enrichAppointmentBody(db, 'appointment.assigned', { appointment_id: 'ap-1' });
    expect(out.title).toBe('New appointment · Water Mitigation');
    expect(out.body).toBe('Sat, Jul 4 · 9:00 AM – 11:00 AM');
    expect(out.link).toBe('/tech/appointment/ap-1');
    expect(out.entity_type).toBe('appointment');
    expect(out.entity_id).toBe('ap-1');
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
    expect(await enrichAppointmentBody(db, 'appointment.updated', body)).toBe(body);
  });
  it('returns the body unchanged when the appointment is not found (never throws)', async () => {
    const db = makeDb({ apptsById: {} });
    const body = { appointment_id: 'missing' };
    expect(await enrichAppointmentBody(db, 'appointment.assigned', body)).toBe(body);
  });
});

describe('dispatchEvent — appointment enrichment end-to-end', () => {
  it('the bell row carries the enriched date/time title + body', async () => {
    const db = makeDb({
      types: { 'appointment.assigned': { type_key: 'appointment.assigned', label: 'Appointment assigned', enabled: true } },
      employees: [{ id: 'emp-9' }],
      apptsById: { 'ap-1': { title: 'Water Mitigation', date: '2026-07-04', time_start: '09:00:00', time_end: '11:00:00' } },
      prefsByEmp: { 'emp-9': prefRows('appointment.assigned', { bell: true }) },
    });
    const out = await dispatchEvent({ db, env: ENV, typeKey: 'appointment.assigned', body: { appointment_id: 'ap-1', employee_id: 'emp-9' } });
    expect(out.recipients).toBe(1);
    const bell = db.rpcCalls.find(c => c.fn === 'create_notification');
    expect(bell.params.p_title).toBe('New appointment · Water Mitigation');
    expect(bell.params.p_body).toBe('Sat, Jul 4 · 9:00 AM – 11:00 AM');
    expect(bell.params.p_link).toBe('/tech/appointment/ap-1');
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
    const expected = { type_key: 'appointment.updated', recipients: 2, results: [] };
    const dispatchImpl = dispatcher(expected);
    const db = makeDb({
      employees: [admin()],
      apptsById: { [APPOINTMENT_ID]: { id: APPOINTMENT_ID, status: 'scheduled' } },
    });
    const res = await handleNotify({
      request: req({ auth: 'Bearer tok' }),
      env: ENV,
      db,
      dispatchImpl,
    });

    expect(res).toEqual({ status: 200, data: expected });
    expect(dispatchImpl).toHaveBeenCalledWith(expect.objectContaining({
      typeKey: 'appointment.updated',
      body: { appointment_id: APPOINTMENT_ID },
    }));
  });

  it.each([
    [
      'assigned appointment',
      {
        type_key: 'appointment.assigned',
        appointment_id: APPOINTMENT_ID,
        employee_id: EMPLOYEE_ID,
      },
      { crewByAppt: { [APPOINTMENT_ID]: [{ appointment_id: APPOINTMENT_ID, employee_id: EMPLOYEE_ID }] } },
      { appointment_id: APPOINTMENT_ID, employee_id: EMPLOYEE_ID },
    ],
    [
      'canceled appointment',
      { type_key: 'appointment.canceled', appointment_id: APPOINTMENT_ID },
      { apptsById: { [APPOINTMENT_ID]: { id: APPOINTMENT_ID, status: 'cancelled' } } },
      { appointment_id: APPOINTMENT_ID },
    ],
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

  it('rejects forged recipients, message copy and links before dispatch', async () => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: {
          type_key: 'appointment.updated',
          appointment_id: APPOINTMENT_ID,
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

  it('requires appointment assignment membership before dispatch', async () => {
    mockAuth();
    const dispatchImpl = dispatcher();
    const res = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: {
          type_key: 'appointment.assigned',
          appointment_id: APPOINTMENT_ID,
          employee_id: EMPLOYEE_ID,
        },
      }),
      env: ENV,
      db: makeDb({ employees: [admin()], crewByAppt: { [APPOINTMENT_ID]: [] } }),
      dispatchImpl,
    });

    expect(res).toEqual({ status: 404, data: { error: 'Notification object not found' } });
    expect(dispatchImpl).not.toHaveBeenCalled();
  });

  it('requires the deployed object state for canceled appointments and accepted estimates', async () => {
    mockAuth();
    const canceledDispatch = dispatcher();
    const canceled = await handleNotify({
      request: req({
        auth: 'Bearer tok',
        body: { type_key: 'appointment.canceled', appointment_id: APPOINTMENT_ID },
      }),
      env: ENV,
      db: makeDb({
        employees: [admin()],
        apptsById: { [APPOINTMENT_ID]: { id: APPOINTMENT_ID, status: 'scheduled' } },
      }),
      dispatchImpl: canceledDispatch,
    });
    expect(canceled).toEqual({ status: 404, data: { error: 'Notification object not found' } });
    expect(canceledDispatch).not.toHaveBeenCalled();

    vi.restoreAllMocks();
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
      request: req({ auth: 'Bearer tok' }),
      env: ENV,
      db: makeDb({
        employees: [admin()],
        selectErrorTable: 'appointments',
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
