/**
 * ════════════════════════════════════════════════
 * FILE: inbound-meld.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The doorway for Property Meld work coming into UPR. Our property-manager
 *   client's software emails us every "Meld" (work order); a forwarder sends
 *   those emails here as they arrive. This reads each one, keeps only the
 *   RESTORATION melds (carpet-cleaning goes to a different business and is
 *   dropped), saves/updates it in the database, and — the first time a new meld
 *   shows up — sends the owner a phone/desktop notification.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/inbound-meld  (Cloudflare Pages Function)
 *   Rendered by:  n/a (worker) — called by an email forwarder (see NOTES)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/property-meld.js (parse + classify + RPC mapping),
 *              ../lib/supabase.js (service-key client), ../lib/cors.js,
 *              ./notify.js (dispatchEvent — prefs-driven push/bell)
 *   Data:      reads  → property_meld_melds (new-vs-existing check), employees
 *                        (owner id), notification_types (via dispatcher)
 *              writes → property_meld_melds (via upsert_property_meld_meld RPC),
 *                        notifications + push (via the dispatcher)
 *
 * NOTES / GOTCHAS:
 *   - AUTH is a shared secret: the forwarder must send header
 *     `x-meld-secret: $INBOUND_MELD_SECRET` (set in BOTH Cloudflare env sets).
 *   - TRANSPORT (owner sets up once): forward `from:msg.propertymeld.com` Gmail
 *     to this endpoint. Simplest is a Gmail Apps Script POSTing
 *     `{ from, subject, text, received_at }` (or a batch `{ emails:[…] }`);
 *     a Cloudflare Email Routing worker works too. See docs/property-meld-ingestion.md.
 *   - Classification is by Property Meld vendor account id, never the job title
 *     (functions/lib/property-meld.js). Only account 83074 (restoration) is kept.
 *   - Idempotent: the RPC de-dupes by meld number, so re-delivering the same
 *     email is safe; the push fires only on a meld's FIRST assignment.
 *   - Push is fire-and-forget — a notification failure never fails the ingest.
 */

import { supabase } from '../lib/supabase.js';
import { jsonResponse } from '../lib/cors.js';
import { parseMeldEmail, shouldIngestMeld, meldToUpsertParams } from '../lib/property-meld.js';
import { dispatchEvent } from './notify.js';

const OWNER_EMAIL = 'moroni@utah-pros.com';

// ─── SECTION: Core (node-testable — see inbound-meld.test.js) ───

/**
 * Ingest a batch of raw emails: parse, keep restoration melds only, upsert each.
 * Returns a per-email summary plus the parsed melds that are brand-new
 * assignments (worth notifying about).
 *
 * @param {object} db      supabase(env) client (needs .select and .rpc)
 * @param {Array}  emails  [{ from, subject, text, received_at? }]
 */
export async function ingestMeldEmails(db, emails) {
  const results = [];
  const newMelds = [];

  for (const email of emails) {
    const parsed = parseMeldEmail(email);
    const decision = shouldIngestMeld(parsed);

    if (!decision.ingest) {
      results.push({
        meld_number: parsed.meldNumber,
        event: decision.event,
        ingested: false,
        business: decision.business,
        needs_review: decision.needsReview,
      });
      continue;
    }

    // First sighting? (so we push exactly once, on the meld's first assignment)
    let isNew = false;
    if (parsed.meldNumber) {
      try {
        const existing = await db.select(
          'property_meld_melds',
          `meld_number=eq.${encodeURIComponent(parsed.meldNumber)}&select=id`,
        );
        isNew = !existing || existing.length === 0;
      } catch { isNew = false; }
    }

    const params = meldToUpsertParams(parsed, { receivedAt: email.received_at || email.date || null });
    await db.rpc('upsert_property_meld_meld', params);

    results.push({ meld_number: parsed.meldNumber, event: decision.event, ingested: true, is_new: isNew });
    if (isNew && parsed.event === 'assigned') newMelds.push(parsed);
  }

  return {
    processed: emails.length,
    ingested: results.filter((r) => r.ingested).length,
    new_count: newMelds.length,
    results,
    newMelds,
  };
}

/**
 * Fire a bell + push to the owner for each brand-new meld. Fire-and-forget:
 * a delivery failure is swallowed so it can never fail the ingest.
 */
export async function notifyNewMelds(db, env, newMelds, dispatchImpl = dispatchEvent) {
  if (!newMelds || !newMelds.length) return { notified: 0 };

  let ownerId = null;
  try {
    const rows = await db.select('employees', `email=eq.${encodeURIComponent(OWNER_EMAIL)}&select=id`);
    ownerId = rows?.[0]?.id || null;
  } catch { ownerId = null; }
  if (!ownerId) return { notified: 0, reason: 'owner_not_found' };

  let notified = 0;
  for (const m of newMelds) {
    const addr = (m.address && m.address.full) || '';
    const title = m.isEmergency ? `🚨 EMERGENCY meld — ${m.meldType}` : `New meld — ${m.meldType}`;
    try {
      await dispatchImpl({
        db,
        env,
        typeKey: 'meld.received',
        body: {
          recipient_ids: [ownerId],
          title,
          body: [addr, m.meldNumber ? `#${m.meldNumber}` : ''].filter(Boolean).join(' · '),
          link: '/melds',
          entity_type: 'meld',
          entity_id: m.meldNumber,
        },
      });
      notified += 1;
    } catch { /* fire-and-forget */ }
  }
  return { notified };
}

// ─── SECTION: HTTP handler ───

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Shared-secret auth — the forwarder must present the matching header.
  const secret = env.INBOUND_MELD_SECRET;
  const provided = request.headers.get('x-meld-secret') || '';
  if (!secret || provided !== secret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Accept a single email or a batch.
  const emails = Array.isArray(payload?.emails)
    ? payload.emails
    : (payload && (payload.text || payload.subject) ? [payload] : []);
  if (!emails.length) {
    return jsonResponse({ error: 'No emails in payload (expected { from, subject, text } or { emails: [...] })' }, 400);
  }

  const db = supabase(env);

  let summary;
  try {
    summary = await ingestMeldEmails(db, emails);
  } catch (e) {
    return jsonResponse({ error: 'Ingest failed', detail: String((e && e.message) || e) }, 500);
  }

  // Push is best-effort and must never fail the ingest.
  let notify = { notified: 0 };
  try {
    notify = await notifyNewMelds(db, env, summary.newMelds);
  } catch { /* swallow */ }

  const { newMelds, ...clean } = summary; // eslint-disable-line no-unused-vars
  return jsonResponse({ ok: true, ...clean, notified: notify.notified });
}
