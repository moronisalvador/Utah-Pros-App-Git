// POST /api/homebuilding-plan-tune — "AI Tune" for the New Build simulator.
//
// Takes the deterministic template baseline (current line items + phase durations) plus the
// home spec/submarket and asks Claude to TUNE it to the specific market and finish — adjusting
// each line's total, phase durations, and suggested soft/contingency percentages — and returns
// validated JSON (structured output). It tunes the provided baseline; it does not invent new
// line items, which keeps output bounded and accurate.
//
// Gating: Moroni only (re-checked server-side). Auth: Supabase Bearer → moroni@utah-pros.com.
// Body:  { spec, lineItems: [{key,label,total}], schedule: [{key,name,weeks}] }
// Env:   ANTHROPIC_API_KEY (Cloudflare Pages — Preview + Production), SUPABASE_*.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { supabase } from '../lib/supabase.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6'; // single structured call — fast + reliable under Cloudflare's ~100s timeout
const OWNER_EMAIL = 'moroni@utah-pros.com';

async function getUserEmail(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.email || null;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  await recordWorkerRun(db, {
    workerName: 'homebuilding-plan-tune', status, recordsProcessed: processed,
    errorMessage, startedAt,
  })
}

const ANCHORS = {
  wasatch: 'WASATCH FRONT (Salt Lake & Utah County): all-in hard build ~$150-$200/sf by finish; lots $180k-$450k+; soft costs ~10-14% of hard; strong demand.',
  southern: 'SOUTHERN UTAH (St. George / Washington County, incl. Hurricane, Ivins, Santa Clara): hard build ~$150-$190/sf; lots $120k-$600k+ (red-rock view premium); water/impact fees notable; soft costs ~9-13% of hard.',
};

const SYSTEM_PROMPT = `You are a senior residential construction cost estimator for the Utah market. You are given a STANDARD TEMPLATE baseline for a home build — a list of cost line items (each with a key, label, and current total in USD) and phase durations in weeks — plus the home's spec and submarket. Tune the baseline to this specific home and local market:
- Adjust each line item's total up or down for the finish level, square footage, bathroom count, region and submarket (e.g. a red-rock view lot in Ivins vs a value lot in Hurricane; high-cost vs production submarket on the Wasatch Front). Return an adjusted total for EVERY line key you were given (keep one if it shouldn't change). Keep totals realistic and grounded in the anchors; do not wildly diverge from the baseline without reason.
- Do NOT invent new line items or drop any — only adjust the keys provided.
- Adjust phase durations (weeks) where the spec warrants (bigger/custom homes take longer).
- Suggest a soft-cost % and contingency % of hard cost appropriate for this market.
- Give 2-5 short rationale notes on the most significant changes, and an honest confidence.
All money values are plain numbers (no "$" or separators). Call submit_tuning exactly once.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line_adjustments: {
      type: 'array',
      description: 'Adjusted total (USD) for each line item key provided.',
      items: {
        type: 'object', additionalProperties: false,
        properties: { key: { type: 'string' }, total: { type: 'number' } },
        required: ['key', 'total'],
      },
    },
    schedule_adjustments: {
      type: 'array',
      description: 'Adjusted duration (weeks) for phase keys that should change (may be a subset).',
      items: {
        type: 'object', additionalProperties: false,
        properties: { key: { type: 'string' }, weeks: { type: 'number' } },
        required: ['key', 'weeks'],
      },
    },
    soft_pct: { type: 'number', description: 'Suggested soft-cost % of hard cost.' },
    contingency_pct: { type: 'number', description: 'Suggested contingency % of hard cost.' },
    rationale: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['line_adjustments', 'schedule_adjustments', 'soft_pct', 'contingency_pct', 'rationale', 'confidence'],
};

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'AI isn’t configured yet — add ANTHROPIC_API_KEY in Cloudflare (Preview + Production).' }, 503, request, env);
  }
  const email = await getUserEmail(request, env);
  if (!email) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  if (email.toLowerCase() !== OWNER_EMAIL) return jsonResponse({ error: 'Forbidden' }, 403, request, env);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const spec = body.spec || {};
  const region = spec.region === 'southern' ? 'southern' : 'wasatch';
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems.slice(0, 60) : [];
  const schedule = Array.isArray(body.schedule) ? body.schedule.slice(0, 40) : [];
  if (!lineItems.length) return jsonResponse({ error: 'No baseline line items to tune.' }, 400, request, env);

  const userText = `${ANCHORS[region]}

HOME SPEC:
- Region: ${region === 'southern' ? 'Southern Utah' : 'Wasatch Front'}${spec.submarket ? ` — submarket: ${spec.submarket}` : ''}
- Square footage: ${spec.sqft} · Stories: ${spec.stories} · Bedrooms: ${spec.bedrooms} · Bathrooms: ${spec.bathrooms}
- Finish level: ${spec.finish}${spec.basementSf ? ` · Finished basement: ${spec.basementSf} sf` : ''}
- Features: ${(Array.isArray(spec.features) && spec.features.length) ? spec.features.join(', ') : 'none'}

TEMPLATE BASELINE — LINE ITEMS (key — label — current total USD):
${lineItems.map((l) => `- ${l.key} — ${l.label} — ${Math.round(Number(l.total) || 0)}`).join('\n')}

TEMPLATE BASELINE — PHASE DURATIONS (key — name — weeks):
${schedule.map((s) => `- ${s.key} — ${s.name} — ${s.weeks}`).join('\n')}

Tune every line item's total to this spec + submarket and adjust durations where warranted. Call submit_tuning once.`;

  const db = supabase(env);
  try {
    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: [{ name: 'submit_tuning', description: 'Return the tuned line totals, durations, and percentages.', strict: true, input_schema: SCHEMA }],
        tool_choice: { type: 'tool', name: 'submit_tuning' },
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) throw new Error(`AI error: ${data?.error?.message || aiRes.statusText}`);
    const tuning = (data.content || []).find((b) => b.type === 'tool_use')?.input;
    if (!tuning?.line_adjustments) throw new Error('Couldn’t tune the plan — try again.');

    await logRun(db, 'completed', lineItems.length, null, startedAt);
    return jsonResponse({ ok: true, tuning }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message || 'Tune failed' }, 500, request, env);
  }
}
