/**
 * ════════════════════════════════════════════════
 * FILE: feedback-notify.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When someone files a bug report or improvement idea, this quietly tells the
 *   admins. It does two things: drops a notice in the in-app notification bell
 *   (which everyone already sees), and — for each admin who is NOT the person
 *   who just submitted — asks the phone-push worker to buzz their phone. It is
 *   called "fire and forget" right after a feedback row is saved, so a hiccup
 *   here never breaks someone's submit.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/feedback-notify  (Cloudflare Pages Function)
 *   Rendered by:  n/a (worker) — called by TechFeedback.jsx + Feedback.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-key client), ../lib/cors.js,
 *              /api/send-push (called same-origin, never edited)
 *   Data:      reads  → tech_feedback (the just-filed row), employees (admins +
 *                        the submitter's name)
 *              writes → notifications (via create_notification RPC — the bell)
 *
 * NOTES / GOTCHAS:
 *   - Push delivery reaches NOBODY until the owner configures APNS_* env vars
 *     AND iOS devices register device_tokens rows (0 rows exist today). The
 *     send-push worker returns 503 when APNs is unconfigured; we report that
 *     per-admin and STILL return 200 — the request must never fail on it.
 *   - The bell channel (create_notification) works today, but the feed is
 *     GLOBAL (no recipient column) — every employee sees every feedback notice.
 *     Accepted + disclosed (see docs/feedback-media-roadmap.md notify section).
 *   - requireAuth mirrors send-push.js: a valid Bearer token is required. The
 *     apikey used to validate it is the anon key (a valid project key for
 *     /auth/v1/user — service-role is unnecessary here).
 *   - Callers must forward the user's Bearer token; each per-admin send-push
 *     POST re-forwards that same header (send-push requires it too).
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

// ─── SECTION: Pure helpers (node-testable — see feedback-notify.test.js) ───

/**
 * From a list of employee rows, the ids of the admins to notify — every
 * `role === 'admin'` row EXCEPT the submitter (who filed it and needn't be
 * told). Tolerates null/garbage rows and a null list.
 */
export function selectAdminIds(employees, submitterId) {
  return (employees || [])
    .filter(e => e && e.role === 'admin' && e.id && e.id !== submitterId)
    .map(e => e.id);
}

/**
 * The push notification content for a feedback row. Title reflects the type
 * (bug vs improvement), body is "{submitter}: {title}", data carries the id +
 * the in-app route so a tap deep-links to the triage inbox.
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
 * The whole notify flow with { request, env, db, fetchImpl } injected so it
 * runs under vitest with fakes. Returns { status, data } — the Pages entry
 * point below wraps it in a CORS jsonResponse.
 */
export async function handleFeedbackNotify({ request, env, db, fetchImpl = fetch }) {
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

  const admins = await db.select('employees', `role=eq.admin&select=id,role`);
  const adminIds = selectAdminIds(admins, feedback.employee_id);
  const payload = buildPushPayload(feedback, submitterName);

  // Channel 1 — in-app bell (global feed; works today). Independent of push:
  // a failure here is recorded but never fails the request.
  let bell = false;
  try {
    await db.rpc('create_notification', {
      p_type: 'feedback',
      p_title: payload.title,
      p_body: payload.body,
      p_link: '/tech-feedback',
      p_entity_type: 'tech_feedback',
      p_entity_id: feedbackId,
      p_payload: { feedback_type: feedback.type, source: feedback.source ?? null },
    });
    bell = true;
  } catch { /* bell is best-effort — push is a separate channel */ }

  // Channel 2 — per-admin APNs push via the send-push worker (same-origin),
  // forwarding the caller's Bearer token. 503 (APNs unconfigured) is expected
  // today and reported, never thrown.
  const origin = new URL(request.url).origin;
  const results = await Promise.all(adminIds.map(async (id) => {
    try {
      const res = await fetchImpl(`${origin}/api/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': auth.authHeader },
        body: JSON.stringify({
          employee_id: id,
          title: payload.title,
          body: payload.body,
          data: payload.data,
        }),
      });
      return { employee_id: id, status: res.status, ok: !!res.ok };
    } catch (err) {
      return { employee_id: id, status: 0, ok: false, error: err.message };
    }
  }));

  const notified = results.filter(r => r.ok).length;
  return {
    status: 200,
    data: { notified, attempted: results.length, bell, results },
  };
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
