/**
 * ════════════════════════════════════════════════
 * FILE: feedback-notify.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When someone files a bug report or improvement idea, this quietly tells the
 *   admins. It looks up the just-filed feedback, works out a friendly title/body,
 *   and hands the whole thing to the shared notification dispatcher
 *   (functions/api/notify.js) as a "feedback.submitted" event — the dispatcher
 *   then picks the admins (never the submitter), checks each one's on/off
 *   preferences, and delivers the in-app bell + phone/desktop push accordingly.
 *   It is called "fire and forget" right after a feedback row is saved, so a
 *   hiccup here never breaks someone's submit.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/feedback-notify  (Cloudflare Pages Function)
 *   Rendered by:  n/a (worker) — called by TechFeedback.jsx + Feedback.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-key client), ../lib/cors.js,
 *              ./notify.js (dispatchEvent — the shared prefs-driven dispatcher)
 *   Data:      reads  → tech_feedback (the just-filed row), employees (submitter
 *                        name). Audience + all channel delivery now happen inside
 *                        the dispatcher (see notify.js for the tables it touches).
 *
 * NOTES / GOTCHAS:
 *   - F2 rewired this: the old hardcoded bell + APNs + Web Push block was replaced
 *     by a single dispatchEvent('feedback.submitted', …) call, so delivery now
 *     honors each admin's notification preferences and per-recipient bell.
 *   - Still fire-and-forget: a dispatcher failure is swallowed and the request
 *     returns 200 — a feedback submit must never fail on the notify path.
 *   - requireAuth mirrors send-push.js: a valid Bearer token is required. The
 *     apikey used to validate it is the anon key (a valid project key for
 *     /auth/v1/user — service-role is unnecessary here).
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { dispatchEvent } from './notify.js';

// ─── SECTION: Pure helpers (node-testable — see feedback-notify.test.js) ───

/**
 * From a list of employee rows, the ids of the admins to notify — every
 * `role === 'admin'` row EXCEPT the submitter. Retained for direct unit tests;
 * the live audience resolution now lives in the dispatcher (notify.js).
 */
export function selectAdminIds(employees, submitterId) {
  return (employees || [])
    .filter(e => e && e.role === 'admin' && e.id && e.id !== submitterId)
    .map(e => e.id);
}

/**
 * The notification content for a feedback row. Title reflects the type (bug vs
 * improvement), body is "{submitter}: {title}", data carries the id + the in-app
 * route so a tap deep-links to the triage inbox.
 */
export function buildPushPayload(feedback, submitterName) {
  const isBug = feedback?.type === 'bug';
  const who = (submitterName && String(submitterName).trim()) || 'Someone';
  return {
    title: isBug ? 'New bug report' : 'New improvement idea',
    body: `${who}: ${feedback?.title || ''}`.trim(),
    data: { feedback_id: feedback?.id, route: '/tech-feedback' },
  };
}

// ─── SECTION: Auth (same shape as send-push.js) ───

async function requireAuth(request, env, fetchImpl) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetchImpl(`${url}/auth/v1/user`, {
    headers: { 'apikey': apiKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true, authHeader };
}

// ─── SECTION: Core handler (injectable deps — no direct globals) ───

/**
 * The whole notify flow with { request, env, db, fetchImpl, dispatchImpl }
 * injected so it runs under vitest with fakes. Returns { status, data } — the
 * Pages entry point below wraps it in a CORS jsonResponse.
 */
export async function handleFeedbackNotify({ request, env, db, fetchImpl = fetch, dispatchImpl = dispatchEvent }) {
  const auth = await requireAuth(request, env, fetchImpl);
  if (auth.error) return { status: auth.status, data: { error: auth.error } };

  let body;
  try { body = await request.json(); }
  catch { return { status: 400, data: { error: 'Invalid JSON body' } }; }

  const feedbackId = body?.feedback_id;
  if (!feedbackId) return { status: 400, data: { error: 'feedback_id is required' } };

  // The just-filed row (id/submitter/type/title is all we need).
  const rows = await db.select(
    'tech_feedback',
    `id=eq.${feedbackId}&select=id,employee_id,type,title,source`,
  );
  const feedback = rows?.[0];
  if (!feedback) return { status: 404, data: { error: 'Feedback not found' } };

  // Submitter's display name (best-effort — a missing name never blocks notify).
  let submitterName = 'Someone';
  try {
    const emp = await db.select('employees', `id=eq.${feedback.employee_id}&select=full_name`);
    if (emp?.[0]?.full_name) submitterName = emp[0].full_name;
  } catch { /* name is cosmetic */ }

  const payload = buildPushPayload(feedback, submitterName);

  // Hand off to the shared dispatcher: it resolves the admin audience (minus the
  // submitter), applies each admin's prefs, and delivers bell + push per channel.
  // Fire-and-forget — a dispatch failure never fails a feedback submit.
  let summary = null;
  try {
    summary = await dispatchImpl({
      db, env, fetchImpl,
      typeKey: 'feedback.submitted',
      body: {
        title: payload.title,
        body: payload.body,
        link: '/tech-feedback',
        entity_type: 'tech_feedback',
        entity_id: feedbackId,
        payload: { feedback_type: feedback.type, source: feedback.source ?? null },
        exclude_employee_id: feedback.employee_id,
        data: payload.data,
      },
    });
  } catch { /* fire-and-forget: notify never fails a feedback submit */ }

  return { status: 200, data: { ok: true, dispatch: summary } };
}

// ─── SECTION: Pages Function entry points ───

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { status, data } = await handleFeedbackNotify({
    request,
    env,
    db: supabase(env),
    fetchImpl: fetch,
  });
  return jsonResponse(data, status, request, env);
}
