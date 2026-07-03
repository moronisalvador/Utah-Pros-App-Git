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
import { describe, it, expect } from 'vitest';
import { resolveAudience, dispatchEvent, handleNotify } from './notify.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' };

// A flexible fake db. `types` maps type_key → catalog row; `prefsByEmp` maps
// employee id → the get_effective_notification_prefs rows; other collections are
// keyed by employee id. Records rpc/delete calls for assertions.
function makeDb(opts = {}) {
  const {
    types = {}, employees = [], prefsByEmp = {}, subsByEmp = {},
    emailByEmp = {}, crewByAppt = {}, webhookSecret = null,
  } = opts;
  const rpcCalls = [];
  const deletes = [];
  return {
    rpcCalls, deletes,
    async select(table, query = '') {
      if (table === 'notification_types') {
        const m = /type_key=eq\.([^&]+)/.exec(query);
        const t = m && types[m[1]];
        return t ? [t] : [];
      }
      if (table === 'employees') {
        const idm = /id=eq\.([^&]+)/.exec(query);
        if (idm) {
          const e = employees.find(x => x.id === idm[1]);
          return e ? [{ email: emailByEmp[idm[1]] ?? null, full_name: e.full_name ?? null }] : [{ email: emailByEmp[idm[1]] ?? null }];
        }
        const rolem = /role=in\.\(([^)]+)\)/.exec(query);
        if (rolem) {
          const roles = rolem[1].split(',');
          return employees.filter(e => roles.includes(e.role));
        }
        return employees;
      }
      if (table === 'appointment_crew') {
        const m = /appointment_id=eq\.([^&]+)/.exec(query);
        return (m && crewByAppt[m[1]]) || [];
      }
      if (table === 'push_subscriptions') {
        const m = /employee_id=eq\.([^&]+)/.exec(query);
        return (m && subsByEmp[m[1]]) || [];
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
    const db = makeDb({});
    const ids = await resolveAudience(db, 'anything', { recipient_ids: ['x', 'x', 'y'] });
    expect(ids.sort()).toEqual(['x', 'y']);
  });

  it('appointment.assigned → the crewed employee', async () => {
    const db = makeDb({});
    const ids = await resolveAudience(db, 'appointment.assigned', { employee_id: 'emp-9' });
    expect(ids).toEqual(['emp-9']);
  });

  it('appointment.updated → the crew of the appointment', async () => {
    const db = makeDb({ crewByAppt: { 'ap-1': [{ employee_id: 'c1' }, { employee_id: 'c2' }] } });
    const ids = await resolveAudience(db, 'appointment.updated', { appointment_id: 'ap-1' });
    expect(ids.sort()).toEqual(['c1', 'c2']);
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

describe('handleNotify — auth', () => {
  function req({ auth, secret, body = { type_key: 'feedback.submitted' } } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = auth;
    if (secret) headers['x-webhook-secret'] = secret;
    return new Request('https://app.test/api/notify', { method: 'POST', headers, body: JSON.stringify(body) });
  }
  const goodFetch = async (url) => String(url).includes('/auth/v1/user') ? { ok: true, status: 200 } : { ok: false, status: 404 };

  it('401 without any credential', async () => {
    const db = makeDb({});
    const res = await handleNotify({ request: req({}), env: ENV, db, fetchImpl: goodFetch });
    expect(res.status).toBe(401);
  });

  it('accepts a matching x-webhook-secret (trigger call)', async () => {
    const db = makeDb({ webhookSecret: 'sekret', types: { 'feedback.submitted': { type_key: 'feedback.submitted', label: 'F', enabled: true } }, employees: [] });
    const res = await handleNotify({ request: req({ secret: 'sekret' }), env: ENV, db, fetchImpl: goodFetch });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong x-webhook-secret', async () => {
    const db = makeDb({ webhookSecret: 'sekret' });
    const res = await handleNotify({ request: req({ secret: 'nope' }), env: ENV, db, fetchImpl: goodFetch });
    expect(res.status).toBe(401);
  });

  it('accepts a valid Bearer token', async () => {
    const db = makeDb({ types: { 'feedback.submitted': { type_key: 'feedback.submitted', label: 'F', enabled: true } }, employees: [] });
    const res = await handleNotify({ request: req({ auth: 'Bearer tok' }), env: ENV, db, fetchImpl: goodFetch });
    expect(res.status).toBe(200);
  });
});
