// POST /api/analyze-xactimate — AI-read an uploaded Xactimate estimate PDF and pre-fill
// a UPR invoice DRAFT with the amount we bill insurance.
//
// UPR's first AI/LLM integration. It downloads the uploaded PDF from Supabase Storage
// (service role), sends it to Claude (claude-opus-4-8) with a strict extraction tool,
// and inserts ONE summary line on the draft invoice at the insurance-billable total
// (the Replacement Cost Value). The prompt is tailored to the job's work type — mitigation
// (no depreciation/deductible; bill the full total) vs reconstruction (may carry depreciation/
// deductible and "Paid When Incurred" holdbacks, which are surfaced, not subtracted). It does NOT
// push anything to QuickBooks — a human reviews the pre-filled draft + breakdown and clicks Save.
//
// Training surface: the AI's behavior = this prompt + the worked examples + the deterministic
// reconciliation below. There is no fine-tuning (the API is stateless) — to teach it a new rule,
// add guidance / a worked example / a check here and ship.
//
// Auth:  Supabase Bearer (a logged-in admin/manager session — the UI is billing-gated).
// Body:  { invoice_id, file_path }   // file_path = the key WITHIN the job-files bucket
//                                       (e.g. "<job_id>/xactimate/<ts>-<name>.pdf")
// Env:   ANTHROPIC_API_KEY (Cloudflare Pages — Preview + Production), SUPABASE_*.

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { supabase } from '../lib/supabase.js';
import { divisionToQbo, findClassId } from '../lib/quickbooks.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-4-8'; // swap to 'claude-sonnet-4-6' for a cheaper/faster pass
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

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
  await recordWorkerRun(db, {
    workerName: 'analyze-xactimate', status, recordsProcessed: processed,
    errorMessage, startedAt,
  })
}

// Strict schema for the forced extraction tool. All fields required; missing values
// come back as 0 (numbers) or "" (strings) so we never depend on nullable-type support.
const ESTIMATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    claim_number: { type: 'string', description: 'Claim / file number on the estimate, or "" if absent.' },
    date_of_loss: { type: 'string', description: 'Date of loss as YYYY-MM-DD, or "" if absent.' },
    line_items: {
      type: 'array',
      description: 'Every line item on the estimate.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit_price: { type: 'number' },
          category: { type: 'string', description: 'Room / trade group, or "" if none shown.' },
          xactimate_code: { type: 'string', description: 'Xactimate line code, or "" if none.' },
        },
        required: ['description', 'quantity', 'unit_price', 'category', 'xactimate_code'],
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      description: 'Summary totals; use 0 for any figure not present on the document.',
      properties: {
        line_item_total: { type: 'number' },
        overhead: { type: 'number', description: 'Overhead total, or 0 if not listed.' },
        profit: { type: 'number', description: 'Profit total, or 0 if not listed.' },
        sales_tax: { type: 'number' },
        rcv: { type: 'number', description: 'Replacement Cost Value — the gross total.' },
        depreciation: { type: 'number' },
        acv: { type: 'number', description: 'Actual Cash Value — RCV minus depreciation.' },
        deductible: { type: 'number' },
        net_claim: { type: 'number' },
        paid_when_incurred: { type: 'number', description: 'Sum of line items the carrier marks "Paid When Incurred" / holds back until the work is completed (often continuous flooring). 0 if none — normally 0 on mitigation.' },
      },
      required: ['line_item_total', 'overhead', 'profit', 'sales_tax', 'rcv', 'depreciation', 'acv', 'deductible', 'net_claim', 'paid_when_incurred'],
    },
    billable: {
      type: 'object',
      additionalProperties: false,
      description: 'Your determination of the amount the contractor bills the insurance company.',
      properties: {
        amount: { type: 'number' },
        basis: { type: 'string', enum: ['RCV', 'ACV', 'net_claim', 'line_item_total'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        rationale: { type: 'string', description: 'One sentence explaining the choice.' },
      },
      required: ['amount', 'basis', 'confidence', 'rationale'],
    },
  },
  required: ['claim_number', 'date_of_loss', 'line_items', 'totals', 'billable'],
};

// Work-type-specific guidance, injected into the prompt so the model applies the right expectations.
// `workType` is derived from the job's division (mitigation vs reconstruction).
const WORK_TYPE_GUIDANCE = {
  mitigation: `This is a MITIGATION estimate (water/fire/mold cleanup). It is a service with no materials and does not change the home's value, and Utah Pros writes the estimate — so depreciation and a deductible are almost never present. The billable is the full RCV, which equals the estimate total. When the printed totals tie out, be decisive and report "high" confidence; do NOT treat a missing ACV, depreciation, or deductible as a problem. Set paid_when_incurred to 0.`,
  reconstruction: `This is a RECONSTRUCTION estimate (repairs/remodel). Depreciation, ACV, and a deductible may be present. Some carriers mark certain line items "Paid When Incurred" (PWI) — often continuous flooring — and hold back payment until the work is completed and photographed; these may be struck through or labeled "Paid When Incurred". Sum those held-back items into paid_when_incurred. The billable is STILL the full RCV — report the held-back amount separately, do NOT subtract it.`,
};

function buildPrompt(workType) {
  return `You are reading an Xactimate property-insurance estimate for Utah Pros Restoration, a restoration contractor.

${WORK_TYPE_GUIDANCE[workType] || WORK_TYPE_GUIDANCE.mitigation}

Using ONLY what appears in this document (never invent figures):
- Extract every line item (description, quantity, unit price, and its room/trade category + Xactimate code when shown).
- Extract all summary totals: line-item subtotal, overhead, profit, sales tax, RCV (Replacement Cost Value), depreciation, ACV (Actual Cash Value), deductible, net claim, and paid_when_incurred. Use 0 for any figure not present (many estimates have no overhead/profit, depreciation, deductible, or PWI).
- Determine the amount the contractor bills the insurance company ("billable"). For a restoration contractor this is normally the RCV — the full replacement cost: the carrier pays the ACV up front and releases the withheld depreciation once the work is complete, while the homeowner pays the deductible. Prefer RCV unless the document clearly indicates a different billed total. When no depreciation is withheld, RCV equals the net claim — still bill the RCV. Give a one-sentence rationale and your confidence: when the printed totals tie out (RCV = line items + overhead + profit + tax), be decisive and report "high"; reserve "medium"/"low" only for genuinely ambiguous, partial, or unreadable estimates.

## Worked examples
1. Reconstruction — summary reads: Line Item Total 18,200.00 · Material Sales Tax 540.00 · Replacement Cost Value 18,740.00 · Less Depreciation (3,100.00) · Actual Cash Value 15,640.00 · Less Deductible (1,000.00) · Net Claim 14,640.00 → totals = { line_item_total: 18200, overhead: 0, profit: 0, sales_tax: 540, rcv: 18740, depreciation: 3100, acv: 15640, deductible: 1000, net_claim: 14640, paid_when_incurred: 0 }, billable = { amount: 18740, basis: "RCV", confidence: "high", rationale: "Contractor bills the full replacement cost; the carrier pays ACV now and releases depreciation on completion." }.
2. Mitigation — summary reads: Line Item Total 4,287.34 · Material Sales Tax 35.88 · Replacement Cost Value 4,323.22 · Net Claim 4,323.22 (no depreciation, ACV, or deductible) → totals = { line_item_total: 4287.34, overhead: 0, profit: 0, sales_tax: 35.88, rcv: 4323.22, depreciation: 0, acv: 0, deductible: 0, net_claim: 4323.22, paid_when_incurred: 0 }, billable = { amount: 4323.22, basis: "RCV", confidence: "high", rationale: "Mitigation service with no depreciation or deductible; bill the full replacement cost, which equals the net claim." }.

All money values are plain numbers (no "$" and no thousands separators). Call submit_estimate exactly once with the structured result.`;
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = new Date().toISOString();

  if (!(await isAuthorized(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'AI isn’t configured yet — add ANTHROPIC_API_KEY in Cloudflare (Preview + Production).' }, 503, request, env);
  }

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const { invoice_id, file_path } = body;
  if (!invoice_id || !file_path) return jsonResponse({ error: 'Provide invoice_id and file_path' }, 400, request, env);

  const db = supabase(env);
  try {
    const inv = (await db.select('invoices', `id=eq.${invoice_id}&select=id,job_id,qbo_invoice_id&limit=1`))?.[0];
    if (!inv) return jsonResponse({ error: 'Invoice not found' }, 404, request, env);
    if (inv.qbo_invoice_id) return jsonResponse({ error: 'This invoice is already in QuickBooks — import only into a draft.' }, 409, request, env);

    // Work-type drives both the AI's expectations (mitigation vs reconstruction) and the line's QBO
    // Item/Class — derive it once from the job's division via the shared mapping (best-effort).
    let qboMap = null;
    try {
      const division = inv.job_id
        ? (await db.select('jobs', `id=eq.${inv.job_id}&select=division&limit=1`))?.[0]?.division
        : null;
      qboMap = divisionToQbo(division);
    } catch { /* defaults to mitigation + no Item/Class */ }
    const workType = qboMap?.className === 'Reconstruction' ? 'reconstruction' : 'mitigation';

    // 1. Download the uploaded PDF (service role) → base64 (chunked, V8-safe for large files).
    const fileRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/job-files/${file_path}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!fileRes.ok) throw new Error(`Couldn’t read the uploaded file (${fileRes.status})`);
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const pdfB64 = btoa(bin);

    // 2. Ask Claude to extract, forcing the strict tool schema.
    const aiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        tools: [{ name: 'submit_estimate', description: 'Return the structured Xactimate extraction.', strict: true, input_schema: ESTIMATE_SCHEMA }],
        tool_choice: { type: 'tool', name: 'submit_estimate' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } },
            { type: 'text', text: buildPrompt(workType) },
          ],
        }],
      }),
    });
    const aiData = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) throw new Error(`AI error: ${aiData?.error?.message || aiRes.statusText}`);
    const extracted = (aiData.content || []).find((b) => b.type === 'tool_use')?.input;
    const amount = round2(extracted?.billable?.amount);
    if (!extracted?.billable || !(amount > 0)) throw new Error('Couldn’t read a billable amount from this document — check that it’s a complete Xactimate estimate.');

    // Deterministic arithmetic cross-check — the AI's numbers must tie out, or we don't let
    // it claim "high" confidence. Math can't hallucinate, so this catches misreads for free.
    const t = extracted.totals || {};
    const near = (a, b) => Math.abs(round2(a) - round2(b)) <= Math.max(1, Math.abs(round2(b)) * 0.01); // within $1 or 1%
    // Reconcile every figure against RCV (always printed), NOT against ACV — Xactimate omits the
    // ACV line when no depreciation is withheld, so the old "net_claim ≈ acv − deductible" check
    // compared against 0 and falsely failed. Build-up includes overhead & profit when listed.
    const buildUp = (t.line_item_total || 0) + (t.overhead || 0) + (t.profit || 0) + (t.sales_tax || 0);
    const checks = {
      rcv:       t.line_item_total ? near(t.rcv || 0, buildUp) : null,
      acv:       t.acv ? near(t.acv, (t.rcv || 0) - (t.depreciation || 0)) : null,
      net_claim: t.net_claim ? near(t.net_claim, (t.rcv || 0) - (t.depreciation || 0) - (t.deductible || 0)) : null,
    };
    const reconciles = Object.values(checks).every((v) => v !== false); // absent figures (null) don't fail
    const confidence = (!reconciles && extracted.billable.confidence === 'high') ? 'medium' : extracted.billable.confidence;

    // 3. Pre-fill the draft: replace any blank auto-added lines with one summary line.
    const existing = (await db.select('invoice_line_items', `invoice_id=eq.${invoice_id}&select=id,description,unit_price`)) || [];
    for (const l of existing) {
      if (!(l.description || '').trim() && Number(l.unit_price || 0) === 0) {
        await db.delete('invoice_line_items', `id=eq.${l.id}`);
      }
    }
    // Pre-fill the line's QBO Item + Class from the work-type mapping derived above — the SAME mapping
    // the invoice sync uses (functions/lib/quickbooks.js), so the draft shows exactly what will post.
    // Best-effort: a QBO hiccup must never fail the import (sync still falls back).
    const lineExtra = {};
    try {
      if (qboMap) {
        lineExtra.qbo_item_id = qboMap.itemId;
        lineExtra.qbo_item_name = qboMap.itemName;
        if (qboMap.className) {
          const classId = await findClassId(env, qboMap.className);
          if (classId) { lineExtra.qbo_class_id = classId; lineExtra.qbo_class_name = qboMap.className; }
        }
      }
    } catch { /* QBO class lookup is best-effort — leave Item/Class for the user to pick */ }

    const ref = extracted.claim_number ? ` (claim ${extracted.claim_number})` : '';
    await db.insert('invoice_line_items', {
      invoice_id, description: `Restoration per Xactimate estimate${ref}`,
      quantity: 1, unit_price: amount, sort_order: 0, ...lineExtra,
    });

    // The recap is BOTH returned to the UI and persisted on the invoice, so the banner survives a
    // refresh and stays available after the invoice is saved. Persisting is best-effort — a failed
    // write must never fail the import.
    const recap = {
      line_count: Array.isArray(extracted.line_items) ? extracted.line_items.length : 0,
      billable: { ...extracted.billable, amount, confidence },
      totals: extracted.totals,
      paid_when_incurred: round2(extracted.totals?.paid_when_incurred),
      work_type: workType,
      checks, reconciles,
      claim_number: extracted.claim_number || null,
      date_of_loss: extracted.date_of_loss || null,
      imported_at: new Date().toISOString(),
    };
    try { await db.update('invoices', `id=eq.${invoice_id}`, { xactimate_meta: recap }); }
    catch { /* recap persistence is best-effort */ }

    await logRun(db, 'completed', 1, null, startedAt);
    return jsonResponse({ ok: true, ...recap }, 200, request, env);
  } catch (e) {
    await logRun(db, 'error', 0, e.message, startedAt);
    return jsonResponse({ error: e.message || 'Extraction failed' }, 500, request, env);
  }
}
