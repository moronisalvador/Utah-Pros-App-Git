// POST /api/homebuilding-estimate — the AI "Build & Value Estimator" on the Homebuilding page.
//
// Takes a structured home spec (region, beds, baths, square footage, stories, finish level,
// land size, features) and asks Claude to REASON OUT a build-cost estimate and an approximate
// sale value (ARV) for that Utah submarket, grounded in per-region cost anchors. Returns a
// validated JSON object (structured output) — no free-text parsing on the client.
//
// Gating: Moroni only (re-checked server-side, like the chat worker).
//
// Auth:  Supabase Bearer (must resolve to moroni@utah-pros.com).
// Body:  { inputs: { region, bedrooms, bathrooms, sqft, stories, finish, landAcres, features[] } }
// Env:   ANTHROPIC_API_KEY (Cloudflare Pages — Preview + Production), SUPABASE_*.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Sonnet (single structured-output call, no web search) — fast + reliable inside Cloudflare's
// ~100s gateway timeout. One forced-tool call returns quickly; swap to opus-4-8 for more depth.
const MODEL = 'claude-sonnet-4-6';
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
  try {
    await db.insert('worker_runs', {
      worker_name: 'homebuilding-estimate', status, records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

// Per-region cost anchors the model reasons from. Ballpark current Utah ranges — the model
// adjusts for the specific spec and features and reports a range + confidence.
const ANCHORS = {
  wasatch: `WASATCH FRONT (Salt Lake & Utah County):
- Hard build cost: ~$150–$200/sf depending on finish (production/builder-grade low end, semi-custom high end). Two-story is cheaper per sf than a rambler of the same size.
- Lot/land: buildable lots commonly $180k–$450k+; infill and east-bench/view lots run higher.
- Soft costs (plans, engineering, permits, impact/connection fees, financing, survey): ~$40k–$70k; municipal water/sewer connection + impact fees are a big swing by city.
- ARV/resale: strong, supply-constrained demand; typical new-build sale prices roughly $550k–$1.2M+ depending on size, finish, lot, and submarket (premium on SLC east bench; growth in Lehi/Saratoga Springs/Draper/southern Utah County).`,
  southern: `SOUTHERN UTAH (St. George / Washington County — incl. Hurricane, Ivins, Santa Clara, Washington):
- Hard build cost: ~$150–$190/sf depending on finish.
- Lot/land: Washington/Hurricane lots more affordable (~$120k–$250k); St. George/Ivins/Santa Clara red-rock VIEW lots $250k–$600k+.
- Soft costs: ~$35k–$55k; WATER availability, connection, and impact fees are a notable cost/constraint here.
- ARV/resale: fast-growing, strong second-home/retiree demand; typical new-build sale prices roughly $500k–$950k+, with a large premium for red-rock view lots.`,
};

const SYSTEM_PROMPT = `You are a senior residential cost estimator and appraiser for the Utah homebuilding market, working for Utah Pros Restoration. Given a home specification and a regional cost profile, reason out:
1) the all-in HARD build cost (sticks-and-bricks; excludes land and soft costs), and
2) the approximate finished SALE value (ARV) for that submarket.

Method:
- Start from the region's $/sf anchor, then adjust for square footage, story count (two-story is cheaper per sf), finish level, and the bed/bath count's effect on plumbing/complexity.
- Price each selected FEATURE's incremental BUILD COST and, separately, its effect on VALUE — features add value differently than they add cost (e.g. a finished basement and a 3rd garage bay add cost but often add proportionally less appraised value; a view lot drives value far more than cost). A finished basement in Utah is common and valued.
- Land size is context for site/excavation and lot value, but the build cost you return is the structure only.
- Give realistic RANGES (low / expected / high), not false precision. Hard cost should imply a sensible $/sf for the spec.
- ARV must be anchored to comparable finished homes in that submarket, NOT cost-plus. If the spec would over-improve for the area, cap ARV at the neighborhood ceiling and say so in a note.
- Set confidence honestly (high only when the spec is typical and well-specified).
- Keep assumptions and notes short and concrete. These are planning estimates to validate against local subs and comps.
All money values are plain numbers (no "$", no separators). Call submit_estimate exactly once.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    build_cost: {
      type: 'object', additionalProperties: false,
      description: 'All-in hard build cost (structure only), USD.',
      properties: { low: { type: 'number' }, expected: { type: 'number' }, high: { type: 'number' } },
      required: ['low', 'expected', 'high'],
    },
    cost_per_sf: {
      type: 'object', additionalProperties: false,
      description: 'Implied hard cost per square foot range, USD.',
      properties: { low: { type: 'number' }, high: { type: 'number' } },
      required: ['low', 'high'],
    },
    breakdown: {
      type: 'array',
      description: 'Rough hard-cost breakdown by category (5–9 items) that sums near build_cost.expected.',
      items: {
        type: 'object', additionalProperties: false,
        properties: { label: { type: 'string' }, amount: { type: 'number' } },
        required: ['label', 'amount'],
      },
    },
    arv: {
      type: 'object', additionalProperties: false,
      description: 'Approximate finished sale value (ARV) for the submarket, USD.',
      properties: { low: { type: 'number' }, expected: { type: 'number' }, high: { type: 'number' } },
      required: ['low', 'expected', 'high'],
    },
    feature_notes: {
      type: 'array',
      description: 'One short note per selected feature on its cost vs value impact (empty array if no features).',
      items: { type: 'string' },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assumptions: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['build_cost', 'cost_per_sf', 'breakdown', 'arv', 'feature_notes', 'confidence', 'assumptions', 'notes'],
};

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
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
  const inp = body.inputs || {};
  const region = inp.region === 'southern' ? 'southern' : 'wasatch';
  const spec = {
    region,
    bedrooms: num(inp.bedrooms, 1, 10, 4),
    bathrooms: num(inp.bathrooms, 1, 10, 3),
    sqft: num(inp.sqft, 600, 12000, 2500),
    stories: num(inp.stories, 1, 3, 1),
    finish: ['builder', 'mid', 'semi-custom', 'custom'].includes(inp.finish) ? inp.finish : 'mid',
    landAcres: num(inp.landAcres, 0, 100, 0.25),
    features: Array.isArray(inp.features) ? inp.features.filter((f) => typeof f === 'string').slice(0, 20) : [],
  };

  const userText = `${ANCHORS[region]}

HOME SPEC TO ESTIMATE:
- Region: ${region === 'southern' ? 'Southern Utah (Washington County)' : 'Wasatch Front'}
- Bedrooms: ${spec.bedrooms}
- Bathrooms: ${spec.bathrooms}
- Square footage (finished living): ${spec.sqft}
- Stories: ${spec.stories}
- Finish level: ${spec.finish}
- Land size: ${spec.landAcres} acres
- Features: ${spec.features.length ? spec.features.join(', ') : 'none specified'}

Estimate the hard build cost and the approximate sale value (ARV) for this home in this submarket. Call submit_estimate once.`;

  const db = supabase(env);
  try {
    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [{ name: 'submit_estimate', description: 'Return the structured build-cost and value estimate.', strict: true, input_schema: SCHEMA }],
        tool_choice: { type: 'tool', name: 'submit_estimate' },
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const data = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) throw new Error(`AI error: ${data?.error?.message || aiRes.statusText}`);
    const est = (data.content || []).find((b) => b.type === 'tool_use')?.input;
    if (!est?.build_cost || !est?.arv) throw new Error('Couldn’t produce an estimate — try adjusting the inputs.');

    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, spec, estimate: est }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message || 'Estimate failed' }, 500, request, env);
  }
}
