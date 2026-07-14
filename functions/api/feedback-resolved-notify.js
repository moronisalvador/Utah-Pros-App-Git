/**
 * ════════════════════════════════════════════════
 * FILE: feedback-resolved-notify.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When an admin marks a technician's feedback as "resolved" in the Feedback
 *   Inbox, this quietly tells the ONE person who filed it — the submitting tech —
 *   that their bug report / idea was taken care of. It looks up the feedback row,
 *   finds who submitted it, writes a friendly "your feedback was resolved"
 *   message, and hands it to the shared notification dispatcher
 *   (functions/api/notify.js) aimed straight at that tech. The dispatcher then
 *   delivers a phone push + email + in-app bell on the channels the tech has left
 *   switched on. It is called "fire and forget" right after the status is saved,
 *   so a hiccup here never breaks marking something resolved.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/feedback-resolved-notify  (Cloudflare Pages Function)
 *   Rendered by:  n/a (worker) — called by FeedbackInbox.jsx on status→resolved
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-key client), ../lib/cors.js,
 *              ./notify.js (dispatchEvent — the shared prefs-driven dispatcher)
 *   Data:      reads  → tech_feedback (the resolved row), employees (submitter
 *                        name). Channel delivery happens inside the dispatcher
 *                        (see notify.js for the tables it touches).
 *
 * NOTES / GOTCHAS:
 *   - Audience is the SUBMITTER only, passed as recipient_ids so it can't fall
 *     back to the admin role default. If the row has no employee_id we skip.
 *   - Reception depends on the 'feedback.resolved' notification type existing +
 *     enabled (migration 20260714_feedback_resolved_notification_type.sql). Until
 *     it exists the dispatcher returns { skipped } — inert, never an error.
 *   - Fire-and-forget: a dispatcher failure is swallowed and the request returns
 *     200 — marking feedback resolved must never fail on the notify path.
 *   - requireAuth mirrors feedback-notify.js: a valid Bearer token is required;
 *     the apikey used to validate it is the anon key (a valid project key for
 *     /auth/v1/user — service-role is unnecessary here).
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { dispatchEvent } from './notify.js';

// ─── SECTION: Pure helpers (node-testable — see feedback-resolved-notify.test.js) ───

/**
 * The notification content for a resolved feedback row. Title reflects the type
 * (bug vs improvement), body names the item, data carries the id + the tech-app
 * route so a tap deep-links to the tech's own feedback screen.
 */
export function buildResolvedPayload(feedback) {
  const isBug = feedback?.type === 'bug';
  const title = isBug ? 'Bug report resolved' : 'Feedback resolved';
  const what = (feedback?.title && String(feedback.title).trim()) || 'your feedback';
  return {
    title,
    body: `"${what}" has been resolved. Thanks for flagging it!`,
    data: { feedback_id: feedback?.id, route: '/tech/feedback' },
  };
}

/** A simple, inline-styled HTML body for the email channel. */
export function buildResolvedEmailHtml(feedback) {
  const what = (feedback?.title && String(feedback.title).trim()) || 'your feedback';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">
    <p>Good news — the feedback you submitted has been resolved:</p>
    <p style="padding:12px 16px;background:#f4f6f8;border-radius:8px;font-weight:600">${esc(what)}</p>
    <p>Thanks for taking the time to flag it. Keep the feedback coming!</p>
    <p style="color:#6b7280;font-size:13px">— Utah Pros Restoration</p>
  </div>`;
}

// ─── SECTION: Auth (same shape as feedback-notify.js) ───

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
export async function handleFeedbackResolvedNotify({ request, env, db, fetchImpl = fetch, dispatchImpl = dispatchEvent }) {
  const auth = await requireAuth(request, env, fetchImpl);
  if (auth.error) return { status: auth.status, data: { error: auth.error } };

  let body;
  try { body = await request.json(); }
  catch { return { status: 400, data: { error: 'Invalid JSON body' } }; }

  const feedbackId = body?.feedback_id;
  if (!feedbackId) return { status: 400, data: { error: 'feedback_id is required' } };

  const rows = await db.select(
    'tech_feedback',
    `id=eq.${feedbackId}&select=id,employee_id,type,title,status`,
  );
  const feedback = rows?.[0];
  if (!feedback) return { status: 404, data: { error: 'Feedback not found' } };

  // No submitter → nobody to notify. Return ok so the caller never fails.
  if (!feedback.employee_id) {
    return { status: 200, data: { ok: true, skipped: 'no_submitter' } };
  }

  const payload = buildResolvedPayload(feedback);
  const html = buildResolvedEmailHtml(feedback);

  // Aim the dispatcher STRAIGHT at the submitter (recipient_ids wins over any
  // role default), so only the tech who filed it hears about it — never admins.
  // Fire-and-forget — a dispatch failure never fails the resolve action.
  let summary = null;
  try {
    summary = await dispatchImpl({
      db, env, fetchImpl,
      typeKey: 'feedback.resolved',
      body: {
        title: payload.title,
        body: payload.body,
        html,
        link: '/tech/feedback',
        entity_type: 'tech_feedback',
        entity_id: feedbackId,
        payload: { feedback_type: feedback.type },
        recipient_ids: [feedback.employee_id],
        data: payload.data,
      },
    });
  } catch { /* fire-and-forget: notify never fails the resolve action */ }

  return { status: 200, data: { ok: true, dispatch: summary } };
}

// ─── SECTION: Pages Function entry points ───

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { status, data } = await handleFeedbackResolvedNotify({
    request,
    env,
    db: supabase(env),
    fetchImpl: fetch,
  });
  return jsonResponse(data, status, request, env);
}
