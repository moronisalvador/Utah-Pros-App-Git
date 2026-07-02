/**
 * ════════════════════════════════════════════════
 * FILE: weekly-crm-digest.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Once a week this worker looks back over the last seven days of the CRM and
 *   emails the team a short plain-language summary: how leads moved through the
 *   pipeline, which promising leads have gone quiet, and whether ad spend jumped
 *   or dropped unusually. It hands the raw numbers to Claude to write the summary
 *   in a couple of readable paragraphs (falling back to a plain built-in summary
 *   if the AI key isn't set), then sends it through the same one consent-checked
 *   email door every other automated message uses — so an unsubscribed or
 *   suppressed recipient is never emailed.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: GET/POST /api/weekly-crm-digest   (authenticated — manual trigger)
 *             Also exports scheduled() for Cloudflare's weekly Cron Trigger
 *             (dashboard-configured, no wrangler.toml — per CLAUDE.md).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js, ../lib/cors.js,
 *              ../lib/automated-send.js (sendGatedEmail — the ONLY send path,
 *              import-only per crm-wave-ownership.md),
 *              ../lib/google-drive.js (getActorEmployee — manual-trigger auth)
 *   Data:      reads  → inbound_leads, ad_spend, crm_orgs (+ get_pipeline_movement
 *                       RPC) · writes → worker_runs (one row per run); the send
 *                       itself writes nothing but routes through the email
 *                       consent gate (email_suppressions checked there)
 *
 * NOTES / GOTCHAS:
 *   - The digest is an AUTOMATED email, so it goes through sendGatedEmail() and
 *     nothing else — it must not call sendEmail()/email.js directly (TCPA/CAN-SPAM
 *     consent gate + consent-path-auditor). Recipients that are suppressed get a
 *     {skipped:true} result, counted but not emailed.
 *   - Recipients resolve in order: env.CRM_DIGEST_RECIPIENTS, else env.OWNER_EMAIL,
 *     else the `crm_digest_recipients` row in integration_config (comma-separated).
 *     The DB fallback lets the list be managed without a Cloudflare env var (same
 *     place the other integration secrets live). With none set the worker still
 *     runs and logs, it just sends nothing (recipients: 0).
 *   - AUTH on the HTTP trigger: a logged-in employee (manual UI trigger) OR a
 *     request carrying an `x-webhook-secret` header matching the `crm_digest_secret`
 *     row in integration_config — the secret path is what a server-side scheduler
 *     (Supabase pg_cron + pg_net) uses when there is no user session, same shape as
 *     the CallRail/Encircle webhook secrets. The Cloudflare Cron Trigger path
 *     (scheduled() below) needs no secret — Cloudflare invokes it off the public
 *     request path.
 *   - The gather/format/anomaly logic is factored into pure exported helpers so
 *     the money-adjacent math (week-over-week spend change, div-by-zero guards)
 *     is unit-tested in weekly-crm-digest.test.js.
 *   - Claude (claude-sonnet-5) only ever SUMMARIZES numbers we computed; it never
 *     invents figures and never sends anything. If ANTHROPIC_API_KEY is missing
 *     the deterministic fallback digest is used instead.
 * ════════════════════════════════════════════════
 */

import { handleOptions, jsonResponse } from '../lib/cors.js';
import { supabase } from '../lib/supabase.js';
import { sendGatedEmail } from '../lib/automated-send.js';
import { getActorEmployee } from '../lib/google-drive.js';

const WORKER_NAME = 'weekly-crm-digest';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const DAY_MS = 86400000;

// A promising lead is "stale" once it has sat untouched this long, but we stop
// chasing after the far bound (matches run-automations' no-response guardrails).
const STALE_DAYS = 5;
const STALE_MAX_AGE_DAYS = 45;
const SPEND_ANOMALY_THRESHOLD = 0.4; // ±40% week-over-week

// ─── SECTION: Pure helpers (unit-tested) ──────────────

/** Parse the recipient list: env.CRM_DIGEST_RECIPIENTS (comma) else OWNER_EMAIL. */
export function parseRecipients(env = {}) {
  const raw = env.CRM_DIGEST_RECIPIENTS || env.OWNER_EMAIL || '';
  return String(raw)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Week-over-week ad-spend anomalies. `byPlatform` is
 * { platform: { this: number, prior: number } }. Flags a platform when the
 * change is at least the threshold; a zero prior week with new spend is 'new'
 * (no division), and change_pct is div-by-zero guarded to null there.
 */
export function spendAnomalies(byPlatform = {}, thresholdPct = SPEND_ANOMALY_THRESHOLD) {
  const out = [];
  for (const [platform, v] of Object.entries(byPlatform)) {
    const thisW = Number(v?.this) || 0;
    const priorW = Number(v?.prior) || 0;
    if (priorW <= 0) {
      if (thisW > 0) out.push({ platform, this_spend: thisW, prior_spend: 0, change_pct: null, direction: 'new' });
      continue;
    }
    const change = (thisW - priorW) / priorW;
    if (Math.abs(change) >= thresholdPct) {
      out.push({ platform, this_spend: thisW, prior_spend: priorW, change_pct: change, direction: change > 0 ? 'up' : 'down' });
    }
  }
  return out;
}

/** Is a lead a stale-but-still-worth-chasing follow-up as of `now`? */
export function isStaleLead(lead, now, thresholdDays = STALE_DAYS, maxAgeDays = STALE_MAX_AGE_DAYS) {
  if (!lead || !lead.contact_id) return false;
  if (lead.lead_status !== 'new') return false;
  if (lead.spam_flag) return false;
  const last = new Date(lead.updated_at || lead.occurred_at || lead.created_at).getTime();
  if (!Number.isFinite(last)) return false;
  const age = now.getTime() - last;
  return age >= thresholdDays * DAY_MS && age <= maxAgeDays * DAY_MS;
}

const money = (nRaw) => '$' + Math.round(Number(nRaw) || 0).toLocaleString('en-US');
const pctStr = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

/**
 * Deterministic fallback digest (used when Claude is unavailable). Pure: turns
 * the gathered summary into { subject, html } with no external calls.
 */
export function buildFallbackDigest(summary) {
  const { movement = [], staleCount = 0, staleSample = [], anomalies = [], weekLabel = '' } = summary || {};
  const moved = movement.filter(s => (s.moved_in || 0) + (s.moved_out || 0) > 0);

  const moveLines = moved.length
    ? `<ul>${moved.map(s =>
        `<li><strong>${s.stage_name}</strong>: ${s.moved_in || 0} in, ${s.moved_out || 0} out (net ${s.net > 0 ? '+' : ''}${s.net || 0})</li>`).join('')}</ul>`
    : '<p>No pipeline movement recorded this week.</p>';

  const staleLines = staleCount
    ? `<p><strong>${staleCount}</strong> promising lead${staleCount === 1 ? '' : 's'} have gone quiet (${STALE_DAYS}+ days untouched).</p>` +
      (staleSample.length ? `<ul>${staleSample.map(s => `<li>${s}</li>`).join('')}</ul>` : '')
    : '<p>No stale leads — every open lead has been touched recently.</p>';

  const anomalyLines = anomalies.length
    ? `<ul>${anomalies.map(a => a.direction === 'new'
        ? `<li><strong>${a.platform}</strong>: new spend of ${money(a.this_spend)} (nothing the prior week)</li>`
        : `<li><strong>${a.platform}</strong>: spend ${a.direction} ${pctStr(Math.abs(a.change_pct))} — ${money(a.prior_spend)} → ${money(a.this_spend)}</li>`).join('')}</ul>`
    : '<p>Ad spend was steady week-over-week (no swing beyond ±40%).</p>';

  const html =
    `<p>Here is your weekly CRM digest${weekLabel ? ` for ${weekLabel}` : ''}.</p>` +
    `<h3>Pipeline movement</h3>${moveLines}` +
    `<h3>Stale leads</h3>${staleLines}` +
    `<h3>Ad-spend anomalies</h3>${anomalyLines}`;

  return { subject: `Weekly CRM digest${weekLabel ? ` — ${weekLabel}` : ''}`, html };
}

// ─── SECTION: Recipients + auth ──────────────
// Env list first (parseRecipients — pure/tested), else the DB-managed list in
// integration_config so scheduling needs no Cloudflare env var.
export async function resolveRecipients(db, env) {
  const fromEnv = parseRecipients(env);
  if (fromEnv.length) return fromEnv;
  try {
    const [row] = await db.select('integration_config', 'key=eq.crm_digest_recipients&select=value&limit=1');
    return parseRecipients({ CRM_DIGEST_RECIPIENTS: row?.value || '' });
  } catch {
    return [];
  }
}

// A server-side scheduler (pg_cron/pg_net) authenticates with this header instead
// of a user session — matches the CallRail/Encircle webhook-secret pattern.
async function checkDigestSecret(request, db) {
  const provided = request.headers.get('x-webhook-secret');
  if (!provided) return false;
  try {
    const [row] = await db.select('integration_config', 'key=eq.crm_digest_secret&select=value&limit=1');
    return !!row?.value && row.value === provided;
  } catch {
    return false;
  }
}

// ─── SECTION: Data gathering ──────────────
async function resolveOrgId(db) {
  const rows = await db.select('crm_orgs', 'is_test=eq.false&select=id&order=created_at.asc&limit=1');
  return rows[0]?.id || null;
}

export async function gatherDigest(db, now = new Date(), orgId = null) {
  const org = orgId || await resolveOrgId(db);
  const startDate = new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  const priorStart = new Date(now.getTime() - 14 * DAY_MS).toISOString().slice(0, 10);

  // Pipeline movement over the last 7 days (history-backed RPC).
  let movement = [];
  try {
    movement = await db.rpc('get_pipeline_movement', { p_start: startDate, p_end: endDate, p_org_id: org });
  } catch { movement = []; }

  // Stale open leads.
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString();
  const oldestAllowed = new Date(now.getTime() - STALE_MAX_AGE_DAYS * DAY_MS).toISOString();
  let staleLeads = [];
  try {
    staleLeads = await db.select(
      'inbound_leads',
      `org_id=eq.${org}&lead_status=eq.new&spam_flag=eq.false&contact_id=not.is.null` +
      `&updated_at=lte.${staleBefore}&updated_at=gte.${oldestAllowed}` +
      `&select=id,caller_name,source,updated_at&order=updated_at.asc&limit=100`,
    );
  } catch { staleLeads = []; }

  // Week-over-week ad spend per platform.
  const byPlatform = {};
  try {
    const spendRows = await db.select(
      'ad_spend',
      `org_id=eq.${org}&date=gte.${priorStart}&date=lte.${endDate}&select=platform,spend,date`,
    );
    for (const r of spendRows || []) {
      const bucket = r.date >= startDate ? 'this' : 'prior';
      byPlatform[r.platform] = byPlatform[r.platform] || { this: 0, prior: 0 };
      byPlatform[r.platform][bucket] += Number(r.spend) || 0;
    }
  } catch { /* leave byPlatform empty */ }

  const anomalies = spendAnomalies(byPlatform);
  const staleSample = staleLeads.slice(0, 8).map(l => l.caller_name || l.source || 'Unknown lead');

  return {
    weekLabel: `${startDate} to ${endDate}`,
    movement: (movement || []).map(s => ({
      stage_name: s.stage_name, moved_in: Number(s.moved_in) || 0,
      moved_out: Number(s.moved_out) || 0, net: Number(s.net) || 0,
    })),
    staleCount: staleLeads.length,
    staleSample,
    anomalies,
  };
}

// ─── SECTION: Claude summarization (summarize only — never fabricates/sends) ──
async function summarizeWithClaude(env, summary) {
  if (!env.ANTHROPIC_API_KEY) return buildFallbackDigest(summary);

  const system =
    'You are an operations assistant writing a short weekly CRM digest email for a ' +
    'restoration company\'s office team. You are given the ONLY facts you may use as ' +
    'JSON. Write 2-4 short paragraphs (or tight bullet lists) of clean HTML using only ' +
    '<p>, <h3>, <ul>, <li>, <strong>. Cover: pipeline movement, stale leads that need ' +
    'follow-up, and any ad-spend anomalies. Be factual and concise. NEVER invent numbers ' +
    'not present in the data. Do not include a subject line or greeting header.';

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system,
        messages: [{ role: 'user', content: `Weekly CRM data (JSON):\n${JSON.stringify(summary)}` }],
      }),
    });
    if (!res.ok) return buildFallbackDigest(summary);
    const json = await res.json();
    const html = (json?.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!html) return buildFallbackDigest(summary);
    return { subject: `Weekly CRM digest — ${summary.weekLabel}`, html };
  } catch {
    return buildFallbackDigest(summary);
  }
}

// ─── SECTION: Orchestrator ──────────────
export async function runWeeklyDigest(db, env, now = new Date()) {
  const startedAt = now.toISOString();
  let sent = 0;
  try {
    const recipients = await resolveRecipients(db, env);
    const summary = await gatherDigest(db, now);
    const { subject, html } = await summarizeWithClaude(env, summary);

    for (const email of recipients) {
      // The ONE consent-checked door — suppressed recipients are skipped here.
      const result = await sendGatedEmail(env, { contact: { email, name: null, dnd: false }, subject, html });
      if (result?.ok) sent++;
    }

    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'completed', records_processed: sent,
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: true, recipients: recipients.length, sent, summary };
  } catch (e) {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME, status: 'error', records_processed: sent,
      error_message: String(e.message || e).slice(0, 500),
      started_at: startedAt, completed_at: new Date().toISOString(),
    });
    return { ok: false, error: e.message };
  }
}

// ─── SECTION: HTTP + cron wrappers ──────────────
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  return runAuthenticated(context);
}

export async function onRequestPost(context) {
  return runAuthenticated(context);
}

// Cloudflare invokes this for the weekly Cron Trigger — no HTTP, no auth check.
export async function scheduled(event, env) {
  const db = supabase(env);
  const result = await runWeeklyDigest(db, env);
  console.log('weekly-crm-digest cron:', JSON.stringify({ ok: result.ok, sent: result.sent, error: result.error }));
}

async function runAuthenticated(context) {
  const { request, env } = context;
  const db = supabase(env);
  // Either a logged-in employee (manual UI trigger) or a valid scheduler secret.
  const employee = await getActorEmployee(request, env, db);
  const authorized = employee || await checkDigestSecret(request, db);
  if (!authorized) return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  const result = await runWeeklyDigest(db, env);
  return jsonResponse(result, result.ok ? 200 : 500, request, env);
}
