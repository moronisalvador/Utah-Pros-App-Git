/**
 * ════════════════════════════════════════════════
 * FILE: feedback-notify.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "tell the admins someone filed feedback" worker behaves. It checks
 *   the two pure helpers (which admins get notified — never the person who
 *   submitted; what the push title/body look like) and that the request handler
 *   rejects a login-less request, 404s a missing feedback row, and otherwise
 *   hands off to the shared notification dispatcher with the right event (F2
 *   rewired the old hardcoded channels to go through functions/api/notify.js).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./feedback-notify.js (system under test). The DB, fetch and the
 *              dispatcher are injected as fakes — no network, no real dispatch.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. The dispatcher's own behavior (audience, prefs, push/email)
 *     is covered in notify.test.js; here we only assert the delegation contract.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  selectAdminIds,
  buildPushPayload,
  handleFeedbackNotify,
} from './feedback-notify.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test-key' };

// Fake supabase client: canned feedback row + submitter name.
function makeDb({ feedback, submitter } = {}) {
  return {
    async select(table) {
      if (table === 'tech_feedback') return feedback ? [feedback] : [];
      if (table === 'employees') return submitter ? [submitter] : [];
      return [];
    },
  };
}

const authFetch = ({ authOk = true } = {}) => {
  const impl = async (url) => String(url).includes('/auth/v1/user')
    ? { ok: authOk, status: authOk ? 200 : 401 }
    : { ok: false, status: 404 };
  return impl;
};

function makeRequest({ auth, body = { feedback_id: 'fb-1' } } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://app.test/api/feedback-notify', {
    method: 'POST', headers, body: JSON.stringify(body),
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

describe('handleFeedbackNotify — delegates to the dispatcher', () => {
  const feedback = { id: 'fb-1', employee_id: 'tech-1', type: 'bug', title: 'Photos wont save', source: 'tech' };
  const submitter = { full_name: 'Jane Tech' };

  it('401s without a Bearer token (before dispatching)', async () => {
    let called = false;
    const dispatchImpl = async () => { called = true; return { recipients: 0 }; };
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: null }), env: ENV, db: makeDb({ feedback, submitter }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it('404s when the feedback row is missing', async () => {
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db: makeDb({ feedback: null, submitter }),
      fetchImpl: authFetch(), dispatchImpl: async () => ({ recipients: 0 }),
    });
    expect(res.status).toBe(404);
  });

  it('dispatches feedback.submitted excluding the submitter, with a real title/body', async () => {
    let captured = null;
    const dispatchImpl = async (args) => { captured = args; return { recipients: 2, results: [] }; };
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db: makeDb({ feedback, submitter }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(200);
    expect(captured.typeKey).toBe('feedback.submitted');
    expect(captured.body.exclude_employee_id).toBe('tech-1');
    expect(captured.body.title).toBe('New bug report');
    expect(captured.body.body).toBe('Jane Tech: Photos wont save');
    expect(captured.body.link).toBe('/tech-feedback');
  });

  it('still succeeds (200) even if the dispatcher throws — fire-and-forget', async () => {
    const dispatchImpl = async () => { throw new Error('dispatch boom'); };
    const res = await handleFeedbackNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db: makeDb({ feedback, submitter }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(200);
  });
});
