/**
 * ════════════════════════════════════════════════
 * FILE: crm-campaign-ai-design.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Powers the "✨ Design with AI" button in the CRM email campaign builder.
 *   Someone types what they want the email to look like (e.g. "make it feel
 *   festive for a spring sale"), and this asks Claude to rewrite the email's
 *   inner content as nicely-styled HTML — a real-looking marketing email,
 *   not a plain paragraph — while leaving the outer branded shell (header,
 *   footer, unsubscribe link) completely alone.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/crm-campaign-ai-design
 *   Rendered by:  src/pages/crm/CrmCampaigns.jsx (CampaignForm's
 *                 handleAiDesign, passed to RichEmailEditor's onAiDesign)
 *
 * DEPENDS ON:
 *   Packages:  none (raw fetch to the Anthropic Messages API — no
 *              @anthropic-ai/sdk dependency, matching every other AI worker
 *              in this codebase)
 *   Internal:  functions/lib/cors.js (handleOptions, jsonResponse),
 *              functions/lib/supabase.js (supabase — run logging only)
 *   Data:      reads  → none
 *              writes → worker_runs (run log only)
 *
 * NOTES / GOTCHAS:
 *   - Auth is a general "any logged-in session" check (same shape as
 *     send-email-campaign.js's requireAuth), NOT the Homebuilding AI
 *     workers' hardcoded owner-email gate — CRM Campaigns is a shared team
 *     feature behind the page:crm rollout flag, not a personal tool.
 *   - Model is claude-sonnet-5. Unlike claude-sonnet-4-6 (used by the
 *     Homebuilding AI workers), Sonnet 5 defaults extended thinking ON when
 *     the `thinking` param is omitted — and forced tool_choice (required
 *     here for clean structured output) is incompatible with thinking
 *     enabled. `thinking: { type: 'disabled' }` below is load-bearing, not
 *     optional tuning — removing it risks a 400 or a silently-ignored
 *     tool_choice on a future model bump.
 *   - This worker only ever returns the INNER content fragment — never
 *     <html>/<body>/an outer wrapper. The outer branded shell is applied by
 *     wrapEmailBody() (functions/lib/email-template.js /
 *     src/lib/emailTemplate.js) at preview/send time, not here.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const WORKER_NAME = 'crm-campaign-ai-design';
const MAX_INSTRUCTION_LEN = 2000;

// ─── SECTION: Helpers ──────────────
export function isEmptyDraft(html) {
  return String(html || '').replace(/<[^>]*>/g, '').trim().length === 0;
}

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    body_html: {
      type: 'string',
      description: 'Redesigned inner HTML fragment only — no <html>/<head>/<body> wrapper, inline CSS only, preserves every {{variable}} token unchanged, introduces no new {{...}} tokens.',
    },
  },
  required: ['body_html'],
};

const SYSTEM_PROMPT = `You are a professional email designer for Utah Pros Restoration, a licensed restoration company in Utah. You rewrite the INNER CONTENT of a marketing email — never the outer wrapper. The recipient's email client will insert your output inside an existing branded shell that already has a dark header ("Utah Pros Restoration"), a light footer with contact info and an unsubscribe link, and a white content card. Do not include <html>, <head>, <body>, or any outer wrapper table/div — return only the inner fragment that goes inside that content cell.

Brand colors/fonts to use via INLINE styles only (email clients strip <style> blocks and external stylesheets — every element needs its own style attribute):
- Font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- Body text: #334155, line-height 1.6, base size 14-15px
- Headings/emphasis: #1e293b
- Muted/secondary text: #94a3b8
- Accent (links, buttons, callouts): #2563eb
- Use simple, email-safe HTML for layout: p, h1/h2/h3, ul/ol/li, strong, em, a, table/tr/td. Avoid flexbox, CSS grid, or <div> layout tricks — they render unreliably across email clients.

This must look like a genuinely designed, professional marketing email — NOT a plain reformatted paragraph. Concretely, produce:
- A bold, styled heading near the top (larger size, brand dark or accent color — not a default plain heading).
- Visually distinct sections, using spacing and/or a subtle accent-tinted callout block for a promo or key point, e.g.:
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#eff6ff;border-radius:8px;padding:16px 20px;"><p style="margin:0;color:#1e293b;font-weight:600;">Key point or offer here</p></td></tr></table>
- A clear call-to-action styled as an email-safe button when the content implies one (book now, call today, reply, etc.), e.g.:
  <a href="#" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:6px;">Schedule Your Free Inspection</a>
- A styled heading example: <h2 style="margin:0 0 12px;color:#1e293b;font-size:20px;font-weight:700;">Your Spring Refresh Starts Here</h2>
Use bold/color confidently for emphasis and visual hierarchy — the way a real restoration-company newsletter or promo email looks, not a plain unstyled paragraph.

Variable tokens: the ONLY placeholders you may use are {{name}}, {{first_name}}, {{email}}, and {{phone}}. Never invent a new {{...}} token — the send pipeline only fills these four and will leave anything else as literal blank text. If the current draft already contains one of these four tokens, preserve it exactly; do not remove personalization the user already wrote.

If the current draft is empty or near-empty, design a complete, polished email from scratch based on the instruction and the subject line below. Otherwise, redesign the existing draft according to the instruction, applying the same visual-polish bar, while preserving its substantive content and meaning except where the instruction asks you to change it.

Call submit_email_design exactly once with the final HTML fragment.`;

// Same shape as send-email-campaign.js's requireAuth — any valid logged-in
// session, not a hardcoded owner-email gate (see NOTES above).
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const apiKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { 'apikey': apiKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true };
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status, records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

// ─── SECTION: Request handling ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();
  const db = supabase(env);

  const auth = await requireAuth(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'AI isn’t configured yet — add ANTHROPIC_API_KEY in Cloudflare (Preview + Production).' }, 503, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const instruction = String(body.instruction || '').trim().slice(0, MAX_INSTRUCTION_LEN);
  const subject = String(body.subject || '').trim();
  const bodyHtml = String(body.body_html || '');
  if (!instruction) return jsonResponse({ error: 'instruction is required' }, 400, request, env);

  const empty = isEmptyDraft(bodyHtml);
  const userText = `SUBJECT LINE: ${subject || '(none yet)'}

${empty ? 'CURRENT DRAFT: (empty — design a complete email from scratch)' : `CURRENT DRAFT HTML:\n${bodyHtml}`}

INSTRUCTION: ${instruction}`;

  try {
    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        // REQUIRED — see file NOTES: Sonnet 5 defaults thinking on, which is
        // incompatible with the forced tool_choice below.
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        tools: [{ name: 'submit_email_design', description: 'Return the redesigned email body HTML.', strict: true, input_schema: SCHEMA }],
        tool_choice: { type: 'tool', name: 'submit_email_design' },
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) throw new Error(`AI error: ${data?.error?.message || aiRes.statusText}`);
    const design = (data.content || []).find((b) => b.type === 'tool_use')?.input;
    if (!design?.body_html) throw new Error('Couldn’t design the email — try again.');

    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, body_html: design.body_html }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message || 'AI design failed' }, 500, request, env);
  }
}
