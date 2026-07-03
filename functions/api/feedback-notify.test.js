/**
 * ════════════════════════════════════════════════
 * FILE: feedback-notify.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "tell the admins someone filed feedback" worker behaves. It
 *   checks the two pure helpers (which admins get notified — never the person
 *   who submitted; what the push title/body/data look like) and then runs the
 *   whole request handler with a fake database and fake network to prove it
 *   rejects a request with no login token, fans a push out to every admin, and
 *   still succeeds even when the push service is switched off (returns 503).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./feedback-notify.js (system under test). The DB client and the
 *              fetch() to /api/send-push are injected as fakes — no network.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. handleFeedbackNotify accepts injected { db, fetchImpl }
 *     so neither Supabase nor send-push is ever really called.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  selectAdminIds,
  buildPushPayload,
  handleFeedbackNotify,
  sendWebPushToAdmins,
} from './feedback-notify.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test-key' };

// A fake supabase client: canned feedback row + admins, records rpc calls.
function makeDb({ feedback, admins = [], submitter, rpcThrows = false } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    async select(table, query = '') {
      if (table === 'tech_feedback') return feedback ? [feedback] : [];
      if (table === 'employees') {
        if (query.startsWith('role=eq.admin')) return admins;
        return submitter ? [submitter] : [];
      }
      return [];
    },
    async rpc(fn, params) {
      rpcCalls.push({ fn, params });
      if (rpcThrows) throw new Error('rpc failed');
      return null;
    },
  };
}

// Fake fetch keyed by URL: auth check ok, send-push returns the given status.
function makeFetch({ authOk = true, pushStatus = 200 } = {}) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (String(url).includes('/auth/v1/user')) {
      return { ok: authOk, status: authOk ? 200 : 401 };
    }
    if (String(url).includes('/api/send-push')) {
      return { ok: pushStatus >= 200 && pushStatus < 300, status: pushStatus };
    }
    return { ok: false, status: 404 };
  };
  impl.calls = calls;
  return impl;
}

function makeRequest({ auth, body = { feedback_id: 'fb-1' } } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://app.test/api/feedback-notify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('selectAdminIds', () => {
  const rows = [
    { id: 'admin-1', role: 'admin' },
    { id: 'admin-2', role: 'admin' },
    { id: 'tech-1', role: 'tech' },   // not an admin
    { id: 'admin-3', role: 'admin' },
  ];

  it('returns every admin id', () => {
    expect(selectAdminIds(rows, 'nobody')).toEqual(['admin-1', 'admin-2', 'admin-3']);
  });

  it('excludes the submitter even when they are an admin', () => {
    expect(selectAdminIds(rows, 'admin-2')).toEqual(['admin-1', 'admin-3']);
  });

  it('ignores non-admins and bad rows', () => {
    expect(selectAdminIds([{ id: 'x', role: 'tech' }, null, {}], 'z')).toEqual([]);
  });

  it('tolerates a null/undefined list', () => {
    expect(selectAdminIds(null, 'a')).toEqual([]);
    expect(selectAdminIds(undefined, 'a')).toEqual([]);
  });
});

describe('buildPushPayload', () => {
  it('titles a bug report', () => {
    const p = buildPushPayload({ id: 'fb-1', type: 'bug', title: 'App crashes' }, 'Jane Tech');
    expect(p.title).toBe('New bug report');
    expect(p.body).toBe('Jane Tech: App crashes');
    expect(p.data).toEqual({ feedback_id: 'fb-1', route: '/tech-feedback' });
  });

  it('titles a feature/improvement idea', () => {
    const p = buildPushPayload({ id: 'fb-2', type: 'feature', title: 'Dark mode' }, 'Bob');
    expect(p.title).toBe('New improvement idea');
    expect(p.body).toBe('Bob: Dark mode');
  });

  it('falls back to a generic submitter name', () => {
    const p = buildPushPayload({ id: 'fb-3', type: 'bug', title: 'x' }, '');
    expect(p.body).toBe('Someone: x');
  });
});

describe('handleFeedbackNotify', () => {
  const feedback = { id: 'fb-1', employee_id: 'tech-1', type: 'bug', title: 'Photos wont save', source: 'tech' };
  const admins = [
    { id: 'admin-1', role: 'admin' },
    { id: 'admin-2', role: 'admin' },
    { id: 'tech-1', role: 'admin' }, // also the submitter → must be excluded
  ];
  const submitter = { full_name: 'Jane Tech' };

  it('401s without a Bearer token (before touching the DB)', async () => {
    const db = makeDb({ feedback, admins, submitter });
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: null }), env: ENV, db, fetchImpl: makeFetch(),
    });
    expect(res.status).toBe(401);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('fans a push out to every admin except the submitter', async () => {
    const db = makeDb({ feedback, admins, submitter });
    const fetchImpl = makeFetch({ pushStatus: 200 });
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db, fetchImpl,
    });
    expect(res.status).toBe(200);
    // 3 admins, one is the submitter → 2 attempts
    expect(res.data.attempted).toBe(2);
    expect(res.data.notified).toBe(2);
    // the in-app bell fired once
    expect(db.rpcCalls.filter(c => c.fn === 'create_notification')).toHaveLength(1);
    // every send-push carried the caller's Authorization header
    const pushCalls = fetchImpl.calls.filter(c => String(c.url).includes('/api/send-push'));
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls.every(c => c.opts.headers.Authorization === 'Bearer tok')).toBe(true);
  });

  it('reports a 503 from send-push without failing the request', async () => {
    const db = makeDb({ feedback, admins, submitter });
    const fetchImpl = makeFetch({ pushStatus: 503 }); // APNs unconfigured
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db, fetchImpl,
    });
    expect(res.status).toBe(200);         // request still succeeds
    expect(res.data.attempted).toBe(2);
    expect(res.data.notified).toBe(0);    // none actually delivered
    expect(res.data.results.every(r => r.status === 503)).toBe(true);
    expect(db.rpcCalls.filter(c => c.fn === 'create_notification')).toHaveLength(1); // bell still fired
  });

  it('404s when the feedback row is missing', async () => {
    const db = makeDb({ feedback: null, admins, submitter });
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db, fetchImpl: makeFetch(),
    });
    expect(res.status).toBe(404);
  });

  it('still succeeds if the bell RPC throws (push is independent)', async () => {
    const db = makeDb({ feedback, admins, submitter, rpcThrows: true });
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db, fetchImpl: makeFetch({ pushStatus: 200 }),
    });
    expect(res.status).toBe(200);
    expect(res.data.bell).toBe(false);
    expect(res.data.notified).toBe(2);
  });

  it('carries a web-push summary (no subscriptions in the fake DB → all zero)', async () => {
    const db = makeDb({ feedback, admins, submitter });
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db, fetchImpl: makeFetch(),
    });
    expect(res.data.web).toEqual({ sent: 0, attempted: 0, pruned: 0, skipped: true });
  });
});

// ─── Web Push fan-out (Notification Center Phase F1) ───
describe('sendWebPushToAdmins', () => {
  const payload = { title: 'New bug report', body: 'Jane: x', data: { feedback_id: 'fb-1', route: '/tech-feedback' } };

  // Fake DB with a feature_flags row + per-employee push_subscriptions; records deletes.
  function makeDb({ flag = null, subsByEmployee = {} } = {}) {
    const deletes = [];
    return {
      deletes,
      async select(table, query = '') {
        if (table === 'feature_flags') return flag ? [flag] : [];
        if (table === 'push_subscriptions') {
          const m = /employee_id=eq\.([^&]+)/.exec(query);
          return (m && subsByEmployee[m[1]]) || [];
        }
        return [];
      },
      async delete(table, filter) { deletes.push({ table, filter }); return null; },
    };
  }

  it('skips entirely when the flag is missing', async () => {
    const send = () => { throw new Error('should not send'); };
    const out = await sendWebPushToAdmins({ db: makeDb({ flag: null }), env: {}, adminIds: ['a1'], payload, sendImpl: send });
    expect(out).toEqual({ sent: 0, attempted: 0, pruned: 0, skipped: true });
  });

  it('skips when force_disabled, even if enabled is true', async () => {
    const send = () => { throw new Error('should not send'); };
    const out = await sendWebPushToAdmins({
      db: makeDb({ flag: { enabled: true, force_disabled: true } }), env: {}, adminIds: ['a1'], payload, sendImpl: send,
    });
    expect(out.skipped).toBe(true);
  });

  it('only targets the dev_only user while the flag is globally OFF (owner-gate window)', async () => {
    const calls = [];
    const send = async (sub) => { calls.push(sub.endpoint); return { ok: true, status: 201 }; };
    const db = makeDb({
      flag: { enabled: false, dev_only_user_id: 'owner' },
      subsByEmployee: {
        owner: [{ id: 's1', endpoint: 'https://push/owner', p256dh: 'p', auth: 'a' }],
        other: [{ id: 's2', endpoint: 'https://push/other', p256dh: 'p', auth: 'a' }],
      },
    });
    const out = await sendWebPushToAdmins({ db, env: {}, adminIds: ['owner', 'other'], payload, sendImpl: send });
    expect(out.sent).toBe(1);
    expect(calls).toEqual(['https://push/owner']);
  });

  it('fans out to every device when the flag is globally enabled, and prunes 410s', async () => {
    const db = makeDb({
      flag: { enabled: true, dev_only_user_id: null },
      subsByEmployee: {
        a1: [
          { id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' },
          { id: 's2', endpoint: 'https://push/2', p256dh: 'p', auth: 'a' }, // dead → 410
        ],
      },
    });
    const send = async (sub) => sub.endpoint.endsWith('/2') ? { ok: false, status: 410 } : { ok: true, status: 201 };
    const out = await sendWebPushToAdmins({ db, env: {}, adminIds: ['a1'], payload, sendImpl: send });
    expect(out).toEqual({ sent: 1, attempted: 2, pruned: 1 });
    expect(db.deletes).toEqual([{ table: 'push_subscriptions', filter: 'id=eq.s2' }]);
  });

  it('reports vapidMissing (503-skip) without throwing when VAPID env is unset', async () => {
    const db = makeDb({
      flag: { enabled: true },
      subsByEmployee: { a1: [{ id: 's1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a' }] },
    });
    const send = async () => ({ skipped: true, status: 503 });
    const out = await sendWebPushToAdmins({ db, env: {}, adminIds: ['a1'], payload, sendImpl: send });
    expect(out).toEqual({ sent: 0, attempted: 1, pruned: 0, vapidMissing: true });
  });
});
