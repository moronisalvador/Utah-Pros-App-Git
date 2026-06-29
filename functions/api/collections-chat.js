// POST /api/collections-chat — the "A/R Copilot" on the Collections page.
//
// A multi-turn chat assistant specialized in accounts receivable for Utah Pros Restoration.
// It helps the office FIND, UNDERSTAND, and prioritize who to bill/chase. It is grounded in a
// LIVE SNAPSHOT of exactly what's on the A/R screen (outstanding/overdue totals, aging buckets,
// ranked top debtors, and the on-screen invoice list) — computed deterministically in the
// browser and sent up each turn — so most questions are answered in one fast model call with no
// lookups. A few READ-ONLY tools (customer contact info, one invoice's detail, the payment
// ledger) handle drill-downs. It is ADVISORY ONLY: it never drafts/sends messages and never
// creates or modifies any record. Stateless: the full conversation + snapshot come up each turn.
//
// "Fast but as smart as a slow model" = context engineering: the deterministic snapshot carries
// the numbers (the model never sums invoices), and Sonnet keeps the turn well under Cloudflare's
// ~100s non-streaming ceiling.
//
// Auth:  Supabase Bearer (any logged-in session — the page is already access-gated).
// Body:  { messages: [{ role:'user'|'assistant', content:string }], snapshot?: {...}, view_state?: {...} }
// Env:   ANTHROPIC_API_KEY (Cloudflare Pages — Preview + Production), SUPABASE_*.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { qboFetch } from '../lib/quickbooks.js';

// ─── SECTION: Config ──────────────
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Sonnet (not Opus) for the chat: ~2x faster, which matters because this worker is NON-streaming
// and Cloudflare 524s if the whole turn (model + tool round-trips) runs past its ~100s gateway.
const MODEL = 'claude-sonnet-4-6';
const MAX_TURNS = 24;      // cap history sent to the model to bound token cost
const MAX_LEN = 6000;      // per-message character cap (defensive)
const MAX_TOOL_ITERS = 5;  // cap the agentic tool loop (speed + cost guard)
const MAX_TOKENS = 1500;   // chat replies are short

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtMoney = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—');

// ─── SECTION: Auth + logging ──────────────
async function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function logRun(db, status, processed, errorMessage, startedAt) {
  try {
    await db.insert('worker_runs', {
      worker_name: 'collections-chat', status, records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

// ─── SECTION: System prompt ──────────────
const SYSTEM_PROMPT = `You are "A/R Copilot," an accounts-receivable assistant embedded in Utah Pros Restoration's Collections page. You help Moroni and the office *find, understand, and decide how to bill/chase people*. You are fast, calm, and precise about money.

# THE PAGE YOU LIVE ON
You sit on the A/R · Outstanding tab: an Outstanding total, an Overdue callout, an aging bar with buckets, and a searchable/filterable table of open invoices (Client, Claim · Job, Sent, Age, Total, Collected, Balance). Each turn you receive a LIVE SNAPSHOT of exactly that view. The user can scroll/filter the page while chatting — when they say "this", "these", "on screen", or "the list", they mean the snapshot's invoices.list.

# HOW MONEY WORKS HERE (be exact)
- Balance = (adjusted_total ?? total) − amount_paid. This is the only correct balance formula; never compute one another way.
- Outstanding = the sum of positive balances on open invoices. The snapshot already gives you this — never re-sum it yourself.
- Overdue / past due = an open invoice whose due date is before today (age_days > 0). An invoice with a balance but NO due date is OPEN but NOT overdue — say so rather than guessing.
- Aging buckets (match the screen): current = not past due (includes undated); b30 = 1–30 days past due; b60 = 31–60; b90 = 61–90; b90p = 90+.
- Invoice status lifecycle: draft (not yet sent) → sent → partial (some paid) → paid; "overdue" is a sent/partial invoice past its due date.

# THE WORK & WHO OWES
- Division = the kind of work: water/mitigation (and "mit"), reconstruction/recon, remodeling/remodel, mold, fire, contents, general.
- Mitigation/water is a cleanup service — billed at the full Replacement Cost Value (RCV), usually with no depreciation or deductible. Reconstruction may carry depreciation/ACV and a deductible, and some line items are "Paid When Incurred" (held back until the work is done) — surface those, don't subtract them.
- Insurance vs out-of-pocket: on an insurance job the carrier owes the RCV and the homeowner owes the deductible; an out-of-pocket job bills the customer directly. So an unpaid balance might be waiting on the carrier OR on the homeowner — flag the distinction when advising who to call.
- An invoice's amount can be explained from its Xactimate recap (xactimate_meta) — billable amount, basis (RCV/ACV/net claim), confidence, and any Paid-When-Incurred holdback. Use get_invoice_detail to see it.

# WHAT YOU CAN DO
- Answer questions about what's on screen straight from the snapshot (totals, overdue, a bucket, "what am I looking at").
- Prioritize collections — "who do I call first" — using the snapshot's top_debtors (ranked by balance × how overdue). Explain the ranking briefly.
- Find a person to reach: use lookup_customer for phone/email and their claims/jobs.
- Explain one invoice: use get_invoice_detail for its line items, payment history, and Xactimate basis.
- Recent cash: use list_payments for the payment ledger (optionally for one customer).
- Small, transparent what-if math on a handful of named invoices is fine (show the steps). For sums across many invoices, rely on the snapshot's totals.

# DEEPER LOOKUPS (beyond the on-screen A/R)
- Estimates: use list_estimates (optionally for one customer or status) — e.g. "is there an open estimate for this customer?".
- Job detail: use get_job_detail for a job's phase, status, division, key dates, and its invoiced/collected/balance + who owes (insurance vs homeowner).
- Claim detail: use lookup_claim (by claim number or id) for carrier, date of loss, loss address, status, and deductible.
- Labor: use list_job_labor for a job's total hours and labor cost (broken down by employee).

# LIVE QUICKBOOKS (read-only)
- qbo_customer gives a customer's REAL-TIME QuickBooks balance + their open QBO invoices; qbo_ar_summary gives the company's live total A/R + aging across all open QBO invoices.
- Your snapshot is UPR's local A/R; QuickBooks is the synced accounting source. They can differ slightly because of sync timing (a payment recorded in one but not yet the other, or an invoice not yet pushed). When they differ, say so and explain the likely reason — don't assume either is "wrong." Reach for the QBO tools when the user wants to check or reconcile against QuickBooks.

# STRICT RULES
1. Never invent numbers. Use only the snapshot and tool results. If a figure isn't available, say so and offer to look it up.
2. Never recompute aggregate totals — the snapshot's totals/buckets are authoritative (computed in code). Don't second-guess them.
3. ADVISORY ONLY. You do NOT draft message copy, do NOT send texts/emails, and do NOT create, edit, send, or delete invoices, payments, estimates, or anything in QuickBooks. You advise *who* to chase, *why*, and *with what info*; the human takes the action in the app. If asked to send or write/send a message, briefly explain you can't send, and instead give the facts they need (who, balance, how overdue, contact info).
4. Cite where a drill-down fact came from ("from the customer record", "from the payment ledger").
5. Stay on A/R / billing / collections. If asked something unrelated, redirect briefly.

# STYLE
Lead with the answer, then a short why. Use short bullet lists; avoid wide markdown tables (this renders as plain text). Use **bold** for key dollar figures and names. Keep a calm tone — a balance is just money owed; reserve urgency for genuinely overdue accounts. Money: write like **$4,320** (whole dollars unless cents matter).`;

// ─── SECTION: Snapshot → prompt context ──────────────
function snapshotContext(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '\n\n(No live A/R snapshot was provided this turn — answer from the conversation, or ask the user to reopen the panel on the A/R tab.)';
  const t = snapshot.totals || {};
  const vs = snapshot.view_state || {};
  let json = JSON.stringify(snapshot);
  // Defensive size guard — if somehow oversized, drop the per-invoice list (keep aggregates + top_debtors).
  if (json.length > 40000 && snapshot.invoices) {
    const trimmed = { ...snapshot, invoices: { ...snapshot.invoices, list: [], note: 'omitted — too large; ask the user to narrow the on-screen filter' } };
    json = JSON.stringify(trimmed);
  }
  return `

LIVE A/R SNAPSHOT — EXACTLY what the user sees on screen right now, computed deterministically in
the browser. Treat every number as ground truth; never recompute or estimate totals. Money is raw dollars.

As of ${snapshot.generated_at} · period filter: ${vs.period || 'All'}
- Total outstanding: $${fmtMoney(t.total_outstanding)} across ${t.open_count || 0} open invoice(s)
- Total overdue (past due): $${fmtMoney(t.total_overdue)} across ${t.overdue_count || 0} invoice(s)
- Invoices failing to sync to QuickBooks: ${t.qbo_error_count || 0}

Full structured snapshot — aging buckets, ranked top_debtors, and the on-screen invoices.list
(already filtered & sorted to match the view; capped — see invoices.shown / total / truncated):
${json}`;
}

// ─── SECTION: Read-only tools ──────────────
const TOOLS = [
  {
    name: 'lookup_customer',
    description: 'Look up ONE customer’s contact info (phone, email, address) and their claims/jobs — use when the user wants to reach or identify a person (e.g. "what’s the number for the Johnson account"). Prefer contact_id (exact, from the snapshot); otherwise pass a free-text query (name / phone / email).',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'The contact_id from the snapshot (preferred).' },
        query: { type: 'string', description: 'Free-text name / phone / email when no contact_id is known.' },
      },
    },
  },
  {
    name: 'get_invoice_detail',
    description: 'Get ONE invoice’s full detail: line items, payment history, and the Xactimate billable recap. Use to explain why an invoice is a certain amount or what has been paid. Pass the invoice id from the snapshot.',
    input_schema: {
      type: 'object',
      properties: { invoice_id: { type: 'string', description: 'The invoice id (from the snapshot).' } },
      required: ['invoice_id'],
    },
  },
  {
    name: 'list_payments',
    description: 'List recent payments received across A/R (cash-in ledger), newest first. Optionally narrow to one customer by contact_id. Use for "what have we collected recently" or a customer’s payment history.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent payments (1–200, default 50).' },
        contact_id: { type: 'string', description: 'Narrow to one customer (optional).' },
      },
    },
  },
  {
    name: 'list_estimates',
    description: 'List estimates (pre-sale quotes), newest first. Optionally narrow to one customer by contact_id and/or a status. Use for "is there an open estimate for this customer?".',
    input_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Narrow to one customer (optional).' },
        status: { type: 'string', description: 'Optional status filter, e.g. draft, submitted, approved, denied.' },
      },
    },
  },
  {
    name: 'get_job_detail',
    description: 'Get ONE job’s operational + financial detail: phase, status, division, address, key dates, and its invoiced/collected/balance + insurance vs homeowner responsibility. Pass the job_id (from a customer lookup or invoice).',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'The job id (uuid).' } },
      required: ['job_id'],
    },
  },
  {
    name: 'lookup_claim',
    description: 'Look up ONE insurance claim: carrier, date of loss, loss address, status, deductible, policy number. Pass a claim_id (uuid) or a claim_number.',
    input_schema: {
      type: 'object',
      properties: {
        claim_id: { type: 'string', description: 'The claim id (uuid).' },
        claim_number: { type: 'string', description: 'The claim number (e.g. as shown on the A/R row).' },
      },
    },
  },
  {
    name: 'list_job_labor',
    description: 'Summarize logged labor for ONE job — total hours and labor cost, broken down by employee. Use for "how many hours / how much labor on this job?". Pass the job_id (uuid).',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'The job id (uuid).' } },
      required: ['job_id'],
    },
  },
  {
    name: 'qbo_customer',
    description: 'LIVE QuickBooks: a customer’s real-time QBO balance and their open QBO invoices. Use to check/reconcile a customer against QuickBooks (e.g. "what’s the Johnson balance in QuickBooks?"). Pass the contact_id from the snapshot.',
    input_schema: {
      type: 'object',
      properties: { contact_id: { type: 'string', description: 'The contact_id from the snapshot.' } },
      required: ['contact_id'],
    },
  },
  {
    name: 'qbo_ar_summary',
    description: 'LIVE QuickBooks: the company’s real-time total A/R and aging across all open QBO invoices. Use to reconcile our on-screen outstanding against QuickBooks (e.g. "does our outstanding match QuickBooks?"). No input.',
    input_schema: { type: 'object', properties: {} },
  },
];

function slimCustomer(d) {
  const c = d?.contact || {};
  const claims = Array.isArray(d?.claims) ? d.claims.slice(0, 8).map((cl) => ({
    claim_number: cl.claim_number, status: cl.status, date_of_loss: cl.date_of_loss,
    carrier: cl.insurance_carrier, deductible: cl.deductible,
    jobs: Array.isArray(cl.jobs) ? cl.jobs.map((j) => ({ job_number: j.job_number, division: j.division, status: j.status, phase: j.phase })) : [],
  })) : [];
  // Note: get_customer_detail's job-level dollar rollups are deprecated/hand-logged and can disagree
  // with the authoritative invoice balances in the snapshot, so we deliberately omit them here.
  return {
    contact: {
      id: c.id, name: c.name, phone: c.phone, email: c.email, company: c.company, role: c.role,
      billing_address: c.billing_address, billing_city: c.billing_city, billing_state: c.billing_state, billing_zip: c.billing_zip,
    },
    job_count: d?.financials?.job_count ?? null,
    claims,
  };
}

const slimContact = (r) => ({
  id: r.id, name: r.name, phone: r.phone, email: r.email, company: r.company,
  role: r.role, city: r.billing_city, job_count: r.job_count,
});

const slimPayment = (r) => ({
  amount: round2(r.amount), date: r.payment_date, method: r.payment_method,
  payer: r.payer_name, payer_type: r.payer_type, source: r.source,
  invoice: r.qbo_doc_number || r.invoice_number || null, client: r.client_name || null,
  claim: r.claim_number || null, contact_id: r.contact_id || null, sync_error: !!r.qbo_sync_error,
});

const slimEstimate = (r) => ({
  number: r.qbo_doc_number || r.estimate_number || null,
  type: r.estimate_type, status: r.status, amount: round2(r.amount),
  division: r.division || null, job_number: r.job_number || null, claim_number: r.claim_number || null,
  client: r.client_name || null, contact_id: r.contact_id || null,
  converted_invoice: r.converted_invoice_number || null,
  created_at: r.created_at, expiration_date: r.expiration_date,
});

// LIVE QUICKBOOKS — the worker builds the read-only /query string (the model never passes raw QQL),
// reusing functions/lib/quickbooks.js qboFetch (auto token-refresh). Returns the QueryResponse object.
async function qboQuery(env, q) {
  const res = await qboFetch(env, `/query?query=${encodeURIComponent(q)}&minorversion=70`, { method: 'GET' });
  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') || null;
    throw new Error(`QuickBooks read failed (${res.status})${tid ? ` [tid ${tid}]` : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  return data.QueryResponse || {};
}

// Bucket live QBO open invoices by days past DueDate — mirror the on-screen aging boundaries.
function qboAging(invoices, todayMs) {
  const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90p: 0 };
  let total = 0;
  for (const inv of invoices) {
    const bal = Number(inv.Balance || 0);
    total += bal;
    const due = inv.DueDate ? new Date(`${inv.DueDate}T00:00:00`).getTime() : null;
    const d = due == null ? null : Math.floor((todayMs - due) / 86400000);
    const key = (d == null || d <= 0) ? 'current' : d <= 30 ? 'b30' : d <= 60 ? 'b60' : d <= 90 ? 'b90' : 'b90p';
    buckets[key] = round2(buckets[key] + bal);
  }
  return { total: round2(total), count: invoices.length, buckets };
}

async function runTool(db, env, name, input = {}) {
  if (name === 'lookup_customer') {
    if (input.contact_id) {
      if (!UUID_RE.test(input.contact_id)) return { error: 'contact_id must be a valid id.' };
      const d = await db.rpc('get_customer_detail', { p_contact_id: input.contact_id });
      if (!d) return { error: 'No customer found for that id.' };
      return slimCustomer(d);
    }
    if (input.query && String(input.query).trim()) {
      const hits = await db.rpc('search_contacts_for_job', { p_query: String(input.query).trim() });
      const list = Array.isArray(hits) ? hits : [];
      return { matches: list.slice(0, 8).map(slimContact), match_count: list.length };
    }
    return { error: 'Provide a contact_id or a query.' };
  }

  if (name === 'get_invoice_detail') {
    const id = input.invoice_id;
    if (!UUID_RE.test(String(id || ''))) return { error: 'invoice_id must be a valid id.' };
    const inv = (await db.select('invoices', `id=eq.${id}&select=id,invoice_number,qbo_doc_number,status,subtotal,tax,total,adjusted_total,amount_paid,due_date,sent_at,invoice_date,paid_at,qbo_invoice_id,qbo_sync_error,xactimate_meta,notes&limit=1`))?.[0];
    if (!inv) return { error: 'Invoice not found.' };
    const lines = (await db.select('invoice_line_items', `invoice_id=eq.${id}&select=description,xactimate_code,quantity,unit,unit_price,line_total,qbo_item_name,qbo_class_name&order=sort_order`)) || [];
    const pays = (await db.select('payments', `invoice_id=eq.${id}&select=amount,payment_date,payment_method,payer_type,reference_number,is_deductible,source,qbo_sync_error&order=payment_date.desc`)) || [];
    const effective_total = round2(inv.adjusted_total ?? inv.total);
    const balance = round2(effective_total - Number(inv.amount_paid || 0));
    return {
      invoice: { ...inv, effective_total, balance },
      line_items: lines,
      payments: pays.map((p) => ({ ...p, amount: round2(p.amount) })),
    };
  }

  if (name === 'list_payments') {
    const limit = clamp(Math.round(Number(input.limit) || 50), 1, 200);
    let rows = (await db.rpc('get_payments_ledger', { p_limit: limit })) || [];
    if (input.contact_id && UUID_RE.test(input.contact_id)) rows = rows.filter((r) => r.contact_id === input.contact_id);
    return { payments: rows.slice(0, limit).map(slimPayment), count: rows.length };
  }

  if (name === 'list_estimates') {
    let rows = (await db.rpc('get_estimates')) || [];
    if (input.contact_id && UUID_RE.test(input.contact_id)) rows = rows.filter((r) => r.contact_id === input.contact_id);
    if (input.status && typeof input.status === 'string') {
      const s = input.status.toLowerCase();
      rows = rows.filter((r) => String(r.status || '').toLowerCase() === s);
    }
    return { estimates: rows.slice(0, 50).map(slimEstimate), count: rows.length };
  }

  if (name === 'get_job_detail') {
    const id = input.job_id;
    if (!UUID_RE.test(String(id || ''))) return { error: 'job_id must be a valid id.' };
    const job = (await db.select('jobs', `id=eq.${id}&select=id,job_number,division,phase,status,ar_status,address,city,state,zip,insured_name,date_of_loss,received_date,target_completion,actual_completion,invoiced_date,estimated_value,approved_value,invoiced_value,collected_value,deductible,supplement_value,claim_id,claim_number&limit=1`))?.[0];
    if (!job) return { error: 'Job not found.' };
    let financials = null;
    try { financials = (await db.rpc('get_job_financials', { p_job_ids: [id] }))?.[0] || null; } catch { /* best-effort */ }
    return { job, financials };
  }

  if (name === 'lookup_claim') {
    let filter = null;
    if (input.claim_id && UUID_RE.test(input.claim_id)) filter = `id=eq.${input.claim_id}`;
    else if (input.claim_number && /^[A-Za-z0-9_-]+$/.test(String(input.claim_number).trim())) filter = `claim_number=eq.${String(input.claim_number).trim()}`;
    if (!filter) return { error: 'Provide a valid claim_id (uuid) or claim_number.' };
    const claim = (await db.select('claims', `${filter}&select=id,claim_number,insurance_claim_number,insurance_carrier,policy_number,date_of_loss,loss_address,loss_city,loss_state,loss_zip,loss_type,status,deductible,contact_id&limit=1`))?.[0];
    if (!claim) return { error: 'Claim not found.' };
    return { claim };
  }

  if (name === 'list_job_labor') {
    const id = input.job_id;
    if (!UUID_RE.test(String(id || ''))) return { error: 'job_id must be a valid id.' };
    const rows = (await db.rpc('get_job_labor_summary', { p_job_id: id })) || [];
    return {
      job_number: rows[0]?.job_number || null,
      total_hours: round2(rows.reduce((a, r) => a + Number(r.total_hours || 0), 0)),
      total_cost: round2(rows.reduce((a, r) => a + Number(r.total_cost || 0), 0)),
      employee_count: rows.length,
      by_employee: rows.map((r) => ({ employee: r.employee_name, hours: round2(r.total_hours), cost: round2(r.total_cost), approved_hours: round2(r.approved_hours), entries: Number(r.entry_count || 0) })),
    };
  }

  if (name === 'qbo_customer') {
    if (!UUID_RE.test(String(input.contact_id || ''))) return { error: 'contact_id must be a valid id.' };
    const c = (await db.select('contacts', `id=eq.${input.contact_id}&select=id,name,qbo_customer_id&limit=1`))?.[0];
    if (!c) return { error: 'Contact not found.' };
    if (!c.qbo_customer_id || !/^\d+$/.test(String(c.qbo_customer_id))) {
      return { synced: false, contact_name: c.name, note: 'This customer is not synced to QuickBooks (no QBO customer id), so there is no live QBO balance.' };
    }
    const qid = String(c.qbo_customer_id);
    const cust = (await qboQuery(env, `SELECT Id, DisplayName, Balance FROM Customer WHERE Id = '${qid}'`)).Customer?.[0] || null;
    const inv = (await qboQuery(env, `SELECT Id, DocNumber, TotalAmt, Balance, DueDate, TxnDate FROM Invoice WHERE Balance > '0' AND CustomerRef = '${qid}' MAXRESULTS 200`)).Invoice || [];
    return {
      synced: true, contact_name: c.name, source: 'QuickBooks (live)',
      qbo_display_name: cust?.DisplayName || null,
      qbo_balance: round2(cust?.Balance),
      open_invoice_count: inv.length,
      open_invoices: inv.map((i) => ({ doc: i.DocNumber || null, total: round2(i.TotalAmt), balance: round2(i.Balance), due_date: i.DueDate || null, txn_date: i.TxnDate || null })),
    };
  }

  if (name === 'qbo_ar_summary') {
    const inv = (await qboQuery(env, `SELECT Id, DocNumber, CustomerRef, TotalAmt, Balance, DueDate, TxnDate FROM Invoice WHERE Balance > '0' MAXRESULTS 1000`)).Invoice || [];
    const aging = qboAging(inv, Date.now());
    return {
      source: 'QuickBooks (live)',
      total_outstanding: aging.total,
      open_invoice_count: aging.count,
      aging_buckets: aging.buckets,
      truncated: inv.length >= 1000,
      note: inv.length >= 1000 ? 'Capped at 1000 open QBO invoices; the live total may be incomplete.' : undefined,
    };
  }

  return { error: `Unknown tool: ${name}` };
}

// Pull the final assistant text out of a Messages response (skips tool_use blocks).
const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// ─── SECTION: Request handlers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'AI isn’t configured yet — add ANTHROPIC_API_KEY in Cloudflare (Preview + Production).' }, 503, request, env);
  }
  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);

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

  const system = SYSTEM_PROMPT + snapshotContext(body.snapshot);
  const db = supabase(env);

  try {
    let convo = messages;
    let data = null;
    for (let i = 0; i < MAX_TOOL_ITERS; i++) {
      const aiRes = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, tools: TOOLS, messages: convo }),
      });
      data = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok) throw new Error(`AI error: ${data?.error?.message || aiRes.statusText}`);
      if (data.stop_reason !== 'tool_use') break;

      // Execute every requested tool and feed the results back, then let the model continue.
      const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
      convo = [...convo, { role: 'assistant', content: data.content }];
      const results = [];
      for (const tu of toolUses) {
        let result;
        try { result = await runTool(db, env, tu.name, tu.input); }
        catch (e) { result = { error: String(e?.message || e).slice(0, 300) }; }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 6000) });
      }
      convo = [...convo, { role: 'user', content: results }];
    }

    const reply = textOf(data?.content)
      || 'I pulled the details but ran a little long — ask me to summarize, or narrow the question.';

    await logRun(db, 'completed', messages.length, null, startedAt);
    return jsonResponse({ reply }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message || 'Chat failed' }, 500, request, env);
  }
}
