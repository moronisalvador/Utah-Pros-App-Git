/**
 * ════════════════════════════════════════════════
 * FILE: feedback-resolved-notify.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "tell the tech their feedback was resolved" worker behaves. It
 *   checks the pure payload/email helpers and that the request handler rejects a
 *   login-less request, 404s a missing feedback row, skips a row with no
 *   submitter, and otherwise hands off to the shared notification dispatcher
 *   aimed STRAIGHT at the submitter (recipient_ids), never the admin role.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./feedback-resolved-notify.js (system under test). The DB, fetch
 *              and the dispatcher are injected as fakes — no network, no dispatch.
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. The dispatcher's own behavior (prefs, push/email) is
 *     covered in notify.test.js; here we only assert the delegation contract.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  buildResolvedPayload,
  buildResolvedEmailHtml,
  handleFeedbackResolvedNotify,
} from './feedback-resolved-notify.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-test-key' };

function makeDb({ feedback } = {}) {
  return {
    async select(table) {
      if (table === 'tech_feedback') return feedback ? [feedback] : [];
      return [];
    },
  };
}

const authFetch = ({ authOk = true } = {}) => async (url) =>
  String(url).includes('/auth/v1/user')
    ? { ok: authOk, status: authOk ? 200 : 401 }
    : { ok: false, status: 404 };

function makeRequest({ auth, body = { feedback_id: 'fb-1' } } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('https://app.test/api/feedback-resolved-notify', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

describe('buildResolvedPayload', () => {
  it('titles a resolved bug and deep-links to the tech feedback screen', () => {
    const p = buildResolvedPayload({ id: 'fb-1', type: 'bug', title: 'Photos wont save' });
    expect(p.title).toBe('Bug report resolved');
    expect(p.body).toContain('Photos wont save');
    expect(p.data).toEqual({ feedback_id: 'fb-1', route: '/tech/feedback' });
  });
  it('titles a resolved improvement idea', () => {
    const p = buildResolvedPayload({ id: 'fb-2', type: 'feature', title: 'Dark mode' });
    expect(p.title).toBe('Feedback resolved');
    expect(p.body).toContain('Dark mode');
  });
  it('falls back to a generic label when the title is blank', () => {
    const p = buildResolvedPayload({ id: 'fb-3', type: 'bug', title: '' });
    expect(p.body).toContain('your feedback');
  });
});

describe('buildResolvedEmailHtml', () => {
  it('includes the feedback title and escapes HTML', () => {
    const html = buildResolvedEmailHtml({ title: 'A <b>bad</b> "bug"' });
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
    expect(html).toContain('&quot;bug&quot;');
    expect(html).not.toContain('<b>bad</b>');
  });
});

describe('handleFeedbackResolvedNotify — delegates to the dispatcher', () => {
  const feedback = { id: 'fb-1', employee_id: 'tech-1', type: 'bug', title: 'Photos wont save', status: 'resolved' };

  it('401s without a Bearer token (before dispatching)', async () => {
    let called = false;
    const dispatchImpl = async () => { called = true; return { recipients: 0 }; };
    const res = await handleFeedbackResolvedNotify({
      request: makeRequest({ auth: null }), env: ENV, db: makeDb({ feedback }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it('404s when the feedback row is missing', async () => {
    const res = await handleFeedbackResolvedNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db: makeDb({ feedback: null }),
      fetchImpl: authFetch(), dispatchImpl: async () => ({ recipients: 0 }),
    });
    expect(res.status).toBe(404);
  });

  it('skips (200) a row with no submitter, without dispatching', async () => {
    let called = false;
    const dispatchImpl = async () => { called = true; return { recipients: 0 }; };
    const res = await handleFeedbackResolvedNotify({
      request: makeRequest({ auth: 'Bearer tok' }),
      env: ENV, db: makeDb({ feedback: { ...feedback, employee_id: null } }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(200);
    expect(res.data.skipped).toBe('no_submitter');
    expect(called).toBe(false);
  });

  it('dispatches feedback.resolved to the SUBMITTER only (recipient_ids)', async () => {
    let captured = null;
    const dispatchImpl = async (args) => { captured = args; return { recipients: 1, results: [] }; };
    const res = await handleFeedbackResolvedNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db: makeDb({ feedback }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(200);
    expect(captured.typeKey).toBe('feedback.resolved');
    expect(captured.body.recipient_ids).toEqual(['tech-1']);
    expect(captured.body.title).toBe('Bug report resolved');
    expect(captured.body.link).toBe('/tech/feedback');
    expect(captured.body.html).toContain('Photos wont save');
  });

  it('still succeeds (200) even if the dispatcher throws — fire-and-forget', async () => {
    const dispatchImpl = async () => { throw new Error('dispatch boom'); };
    const res = await handleFeedbackResolvedNotify({
      request: makeRequest({ auth: 'Bearer tok' }), env: ENV, db: makeDb({ feedback }),
      fetchImpl: authFetch(), dispatchImpl,
    });
    expect(res.status).toBe(200);
  });
});
