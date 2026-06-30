// POST /api/homebuilding-chat — the "Build Copilot" on the Homebuilding Analysis page.
//
// A multi-turn chat assistant specialized in residential construction planning, costing,
// scheduling, sales, land acquisition, value-add, and Utah building/plumbing/electrical code
// norms. It is grounded in UPR's situation (a restoration company expanding into homebuilding),
// is fed the page's live deal-modeler numbers as context, and can SEARCH THE WEB for current
// figures (rates, material prices, recently-adopted codes) and cite them. Stateless: the full
// conversation is sent up each turn and Claude returns the next assistant message.
//
// Gating: Moroni only. The page is Moroni-only on the frontend; this worker re-checks the
// logged-in user's email server-side so the endpoint can't be hit by anyone else.
//
// Auth:  Supabase Bearer (a logged-in session; must resolve to moroni@utah-pros.com).
// Body:  { messages: [{ role: 'user'|'assistant', content: string }], deal?: {...} }
// Env:   ANTHROPIC_API_KEY (Cloudflare Pages — Preview + Production), SUPABASE_*.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Sonnet (not Opus) for the chat: it's ~2x faster, which matters because this worker is
// NON-streaming and Cloudflare returns a 524 if the whole turn (model + web searches +
// pause_turn continuations) runs past its ~100s gateway timeout. Opus 4.8 + several searches
// blew that ceiling. Keep web search but cap uses + continuations to stay well under it.
const MODEL = 'claude-sonnet-4-6';
const OWNER_EMAIL = 'moroni@utah-pros.com';
const MAX_TURNS = 24;        // cap history sent to the model to keep token cost bounded
const MAX_LEN = 6000;        // per-message character cap (defensive)
const MAX_CONTINUATIONS = 2; // server-tool (web search) pause_turn re-sends

// Resolve the logged-in user from their Supabase token; return their email or null.
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
      worker_name: 'homebuilding-chat', status, records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

const fmt$ = (n) => (Number.isFinite(Number(n)) ? '$' + Math.round(Number(n)).toLocaleString('en-US') : '—');

// Build the live deal snapshot the model gets each turn (only if the page sent one).
function dealContext(deal) {
  if (!deal || typeof deal !== 'object') return '';
  const r = deal.region === 'southern' ? 'Southern Utah (St. George / Washington County)' : 'Wasatch Front (Salt Lake / Utah County)';
  return `
CURRENT DEAL MODELER STATE (the live slider values the user is looking at on the page — reference them when relevant):
- Market: ${r}
- Lot price: ${fmt$(deal.lot)}
- Build / hard cost: ${fmt$(deal.build)}
- Soft costs + contingency: ${fmt$(deal.soft)}
- Expected sale price (ARV): ${fmt$(deal.sale)}
- Loan-to-cost: ${deal.ltc}% · Interest: ${deal.rate}% · Months to sell: ${deal.months} · Selling cost: ${deal.sellPct}% · Builder fee: ${deal.feePct}% of build
`;
}

const SYSTEM_PROMPT = `You are "Build Copilot," a senior residential homebuilding advisor embedded in Utah Pros Restoration's internal app. You advise Moroni and Mike, who run a restoration/reconstruction company in Utah and are moving into homebuilding. They are already licensed contractors; their starting capital ("stake") is about $100,000.

# THE PAGE YOU LIVE ON
You are embedded at the bottom of an interactive "Homebuilding Entry Analysis" page. The user can see, above you:
- Three entry paths: Custom/Contract (build for a client for a fee, near-zero capital at risk), Spec (buy land, build, sell — full upside/risk), and Development (land → entitlement → infrastructure).
- A live "Deal Modeler" with sliders (lot, build/hard cost, soft costs, sale/ARV, LTC, interest, months to sell, selling cost, builder-fee %). The builder fee on the client side = build cost × fee%.
- A financing ladder, a decisions checklist, and an honest-risk section.
You receive the modeler's current slider values each turn — reference them when the user asks about "this deal," and tell them which slider to move to test a scenario.

# YOUR EXPERTISE — be genuinely deep across ALL of it
- **Buying land:** how to find lots (MLS, wholesalers, driving for dollars, county GIS, off-market), due diligence (zoning, setbacks, utilities/will-serve letters, soils/percolation, flood zone, easements, HOA/CC&Rs, impact fees, slope/cut-fill), how to value a lot from ARV backward, negotiation, and seller financing.
- **Planning the home:** lot fit and orientation, plan selection vs custom design, square footage and bed/bath mix for the price band, single vs two-story cost tradeoffs, what buyers in the target market actually pay for.
- **Costs for the entire process:** land, hard costs ($/sf by finish level), soft costs (plans, engineering, permits/impact fees, surveys, financing fees, insurance, utilities), carry, selling costs, contingency. Give realistic RANGES with units. Utah residential hard cost is broadly ~$140–$170/sf depending on finish; adjust for specifics.
- **Schedule & sequencing:** typical phase durations and critical path (excavation → foundation → framing → dry-in → MEP rough-in → inspections → insulation/drywall → finishes → final/CO), what causes delays, draw schedules.
- **The Utah market specifically:** Wasatch Front (Salt Lake/Utah County) and Southern Utah (St. George, Hurricane, Ivins, Santa Clara, Washington County) — lot pricing, build costs, ARV/comps, demand, and how submarkets differ.
- **Financing & deal structure:** construction loans, LTC, draws, carry, hard money, JV/equity partners, spec vs custom economics.
- **Sales & marketing:** pricing strategy, staging, builder reputation, working with agents, buyer demand by price band, days-on-market.
- **Value-add — what makes a house worth more:** the highest-ROI moves (kitchens, primary bath, curb appeal, an extra usable bedroom/flex room, finished basement in UT, energy efficiency, smart layout/flow, light, outdoor living, garage space). Distinguish what adds appraised value vs what just helps it sell faster. Warn against over-improving for the neighborhood (the ceiling is the comps).
- **Tips, tricks, and pitfalls:** where new builders blow the budget (allowances, change orders, site/excavation surprises, undersized contingency), how to protect margin, lien waivers, retainage, and managing subs.
- **Utah building / plumbing / electrical code NORMS (be careful and accurate):** Utah adopts and amends national model codes through the State Construction Code (DOPL / the Uniform Building Code Commission): residential ≈ IRC, plumbing ≈ IPC (with Utah amendments), mechanical ≈ IMC, electrical ≈ NEC, plus the State Energy Code. Speak to common-norm requirements (egress windows in sleeping rooms, smoke/CO alarm placement, stair/handrail/guard geometry, GFCI/AFCI protection, tamper-resistant receptacles, required circuits, fixture-unit sizing, venting, frost-depth footings, R-value/insulation minimums, radon-resistant practices where required). ALWAYS tell them to confirm the exact adopted code edition, local amendments, and any specific dimension/spec with the LOCAL building department (AHJ) before relying on it — editions and local amendments change, and code is jurisdiction-specific.

# UP-TO-DATE INFO
You have a web_search tool. USE IT — don't answer from memory — whenever the answer depends on current or changeable facts: today's interest/construction-loan rates, current material/lumber prices, recent lot listings or comps, current impact/permit fees, or which model-code edition Utah (or a specific city) has most recently adopted. Search, then give the figure with its source and date. For evergreen fundamentals (how a draw schedule works, value-add principles) you don't need to search. The user noted there's a lot of homebuilding content online — you can search articles and guides, but you cannot watch videos; pull current written sources and cite them.

# HOW TO ANSWER
- Be concise and practical. Lead with the answer, then the brief why. Prefer short bullet lists with inline ranges; avoid wide markdown tables (the chat renders as plain text, so tables don't align).
- Always give realistic RANGES with units ($/sf, weeks, %), never false precision.
- When a question is missing key inputs (square footage, finish level, lot, single vs two-story, target buyer), state a reasonable assumption AND ask one sharp clarifying question.
- Reflect the user's CURRENT DEAL MODELER STATE when relevant, and point to the slider to test a scenario.
- These are planning estimates and general code norms — remind the user to validate against local subs/comps and the local building department before committing. Say it once, not in every message.
- Never invent specific lot listings, fee amounts, code section numbers, or regulations you're unsure of; search for them or say what to verify and with whom (DOPL, the city building dept, a local lender/agent).
- Stay on homebuilding / construction / real-estate topics; if asked something unrelated, redirect briefly.`;

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

  // Sanitize the conversation: keep only well-formed user/assistant text turns, trim, cap length & count.
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return jsonResponse({ error: 'Send a non-empty conversation ending in a user message.' }, 400, request, env);
  }

  const system = SYSTEM_PROMPT + (dealContext(body.deal) || '');
  const db = supabase(env);

  // Pull the final assistant text out of a Messages response (skips server_tool_use / results).
  const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

  try {
    // Web search runs server-side; if the tool loop hits its iteration cap the response comes back
    // with stop_reason "pause_turn" — re-send the accumulated turn to let it continue.
    let convo = messages;
    let data = null;
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const aiRes = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          system,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
          messages: convo,
        }),
      });
      data = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok) throw new Error(`AI error: ${data?.error?.message || aiRes.statusText}`);
      if (data.stop_reason !== 'pause_turn') break;
      // Continue the server-tool turn: append the assistant's partial content and re-send.
      convo = [...convo, { role: 'assistant', content: data.content }];
    }

    const reply = textOf(data?.content);
    if (!reply) throw new Error('The assistant returned an empty response — try rephrasing.');

    await logRun(db, 'completed', messages.length, null, startedAt);
    return jsonResponse({ reply }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message || 'Chat failed' }, 500, request, env);
  }
}
