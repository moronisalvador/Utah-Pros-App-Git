/**
 * ════════════════════════════════════════════════
 * FILE: property-meld.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Property Meld is the software our property-manager clients use to send us
 *   work ("Melds"). We are just a vendor, so we do not get their API — but we
 *   DO get an email for every Meld. This file reads one of those emails and
 *   pulls out the useful pieces (which property, what work, when it is due, the
 *   message thread, etc.) into a tidy object.
 *
 *   It also decides which of our two businesses the Meld belongs to. In
 *   Property Meld we have two separate vendor accounts under the same property
 *   manager: one for Utah Pros Restoration and one for Utah Pros Carpet
 *   Cleaning. Every email's links contain the account number, so we use THAT
 *   (not the wording of the job) to tell the businesses apart. Only Restoration
 *   work belongs in UPR; carpet cleaning is a different business and is dropped.
 *
 * WHERE IT LIVES:
 *   Route:  n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none (pure string parsing — safe in Cloudflare Workers)
 *   Internal:  intended consumer is a future functions/api/inbound-meld.js
 *              worker that receives forwarded Property Meld emails.
 *   Data:      reads  → none
 *              writes → none (pure functions; the worker does the DB writes)
 *
 * EXPORTS:
 *   parseMeldEmail({ from, subject, text }) → parsed meld object (see shape below)
 *   classifyMeldBusiness(parsed, accounts?) → 'restoration' | 'cleaning' | 'unknown'
 *   shouldIngestMeld(parsed, opts?)         → { ingest, business, event, needsReview }
 *   meldToUpsertParams(parsed, opts?)       → params for the upsert_property_meld_meld RPC
 *   MELD_ACCOUNTS (default account→business map)
 *
 * NOTES / GOTCHAS:
 *   - Classification is by VENDOR ACCOUNT ID in the URL, never by the job
 *     title. Restoration jobs are titled things like "Wet Carpet in Bedroom" /
 *     "Clean Mold Under Stairs" (contain "carpet"/"clean" but ARE restoration),
 *     while a "Carpet repair" once came through the cleaning account. Only the
 *     account number is trustworthy.
 *   - "A2Z Properties" and "Presidio Property Management" are the SAME company
 *     (a rebrand). We deliberately do NOT key off the brand name in the subject.
 *   - Email does NOT carry photos / inspection reports (portal-only) and
 *     truncates long descriptions with "See More" — parsed.descriptionTruncated
 *     flags the latter; portalUrl is the deep link a tech taps for the rest.
 *   - The stable de-dup key is the Meld NUMBER (e.g. "TFTBCQP"), present in
 *     every email type; the internal numeric id is absent from cancel emails.
 */

// ─── SECTION: Helpers ──────────────

const NOREPLY = 'noreply@msg.propertymeld.com';

/** Decode the handful of HTML entities Property Meld leaves in its text part. */
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** First capture group of `re` against `s`, trimmed, or null. */
function grab(s, re) {
  const m = s.match(re);
  return m ? m[1].trim() : null;
}

// Known Meld status phrases always begin with one of these capitalized words.
// Used only as a boundary so we can split "TFTBCQPPending vendor acceptance"
// (Meld number glued to status) — Meld numbers are [A-Z0-9] only, so a
// lowercase-containing status word can never appear inside one.
const STATUS_LEAD = 'Pending|Completed|Complete|Scheduled|Canceled|Cancelled|Closed|In Progress|New|Reopened|On Hold|Awaiting';

// ─── SECTION: Parse ──────────────

/**
 * Parse one Property Meld notification email into a structured object.
 *
 * @param {object} email
 * @param {string} email.from     envelope From (noreply@… or the per-Meld UUID@…)
 * @param {string} email.subject  e.g. "[A2Z Properties] - Meld at 238 N 750 E, Unit 238: Carpet repair"
 * @param {string} email.text     the plain-text body
 * @returns {object} parsed meld
 */
export function parseMeldEmail({ from = '', subject = '', text = '' } = {}) {
  const body = decodeEntities(text);
  const subj = decodeEntities(subject);

  // Event type — the notification's opening verb.
  let event = 'unknown';
  if (/assigned this Meld/i.test(body)) event = 'assigned';
  else if (/canceled this Meld/i.test(body)) event = 'canceled';
  else if (/^You scheduled an appointment/im.test(body) || /You scheduled an appointment/i.test(body)) event = 'appointment_scheduled';
  else if (/appointment in 1-hour/i.test(body)) event = 'appointment_reminder';
  else if (/sent a message/i.test(body)) event = 'message';
  else if (/activity summary/i.test(body) || /activity summary/i.test(subj)) event = 'daily_summary';

  // Org + vendor account — present in EVERY email (at minimum the footer
  // "Manage all notifications" link). This is the classification key.
  const acct = body.match(/app\.propertymeld\.com\/(\d+)\/v\/(\d+)\//);
  const orgId = acct ? acct[1] : null;
  const vendorAccountId = acct ? acct[2] : null;

  // Internal numeric meld id — from a summary/messages link. Absent on cancels.
  const meldId = grab(body, /\/melds?\/(?:incoming\/)?(\d+)\//);

  // Portal deep link (what a tech taps for photos/full report). Null on cancels.
  const portalUrl = grab(body, /(https:\/\/app\.propertymeld\.com\/\d+\/v\/\d+\/melds?(?:\/incoming)?\/\d+\/summary\/)/);

  // Subject: [Brand] - [EMERGENCY ]Meld at {ADDRESS}: {TYPE}
  const subjM = subj.match(/^\[(.+?)\]\s*-\s*(EMERGENCY\s+)?Meld at (.+?):\s*(.+)$/);
  const pmBrand = subjM ? subjM[1].trim() : null;
  const isEmergency = !!(subjM && subjM[2]) || /EMERGENCY/i.test(subj);
  const subjectAddress = subjM ? subjM[3].trim() : null;
  // Meld type — prefer the subject (never truncated); fall back to the body.
  const meldType = (subjM ? subjM[4].trim() : null)
    || grab(body, /Meld Details:\s*\n\s*([^\n#]+?)\s*\n\s*#/);

  // Meld number + status. Non-greedy number up to a status lead word; if no
  // status follows (cancel emails), take the bare number to end-of-token.
  let meldNumber = null;
  let status = null;
  const withStatus = body.match(new RegExp(`#\\s*([A-Z0-9]+?)(${STATUS_LEAD})([^\\n]*)`));
  if (withStatus) {
    meldNumber = withStatus[1];
    status = (withStatus[2] + withStatus[3]).trim();
  } else {
    meldNumber = grab(body, /#\s*([A-Z0-9]+)/);
  }
  if (event === 'canceled') status = 'Canceled';

  const dueDate = grab(body, /Due Date\s*\n\s*([^\n]+)/);
  const appointmentWindow = grab(body, /Appointment Window\s*\n\s*([^\n]+)/);

  // Full address block: after "Unit:" up to the "Manage all notifications" line.
  const address = parseAddress(body, subjectAddress);

  // Description (assignment instructions) — the first quoted block; may span
  // lines. Truncated when Property Meld appended a "See More" link.
  let description = null;
  let descriptionTruncated = false;
  if (event === 'assigned') {
    description = grab(body, /"([\s\S]*?)"/);
    descriptionTruncated = /See More/i.test(body);
  }

  // Message events: who spoke + what they said + the reply-thread address.
  let messageFrom = null;
  let messageText = null;
  let threadReplyAddress = null;
  if (event === 'message') {
    messageFrom = grab(body, /^(.+?) sent a message\./m);
    messageText = grab(body, /sent a message\.\s*\n+\s*"([\s\S]*?)"/);
    if (from && from.toLowerCase() !== NOREPLY && /^[0-9a-f-]{16,}@msg\.propertymeld\.com$/i.test(from.trim())) {
      threadReplyAddress = from.trim();
    }
  }

  return {
    event,
    pmBrand,
    isEmergency,
    orgId,
    vendorAccountId,
    meldId,
    meldNumber,
    meldType,
    status,
    dueDate,
    appointmentWindow,
    address,
    description,
    descriptionTruncated,
    messageFrom,
    messageText,
    threadReplyAddress,
    portalUrl,
  };
}

/** Pull street / unit / city-state-zip out of the body's Unit block. */
function parseAddress(body, subjectAddress) {
  const block = grab(body, /Unit:\s*\n([\s\S]*?)\n\s*\n/);
  let street = null;
  let unit = null;
  let cityStateZip = null;
  if (block) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}/.test(line)) cityStateZip = line;
      else if (/^Unit\b/i.test(line)) unit = line;
      else if (!street) street = line;
    }
  }
  const full = [street, unit, cityStateZip].filter(Boolean).join(', ') || subjectAddress || null;
  return { street, unit, cityStateZip, full };
}

// ─── SECTION: Classify ──────────────

/**
 * Default vendor-account → business map. A2Z Properties (org 2156):
 *   83074 = Utah Pros Restoration     (goes into UPR)
 *   51865 = Utah Pros Carpet Cleaning (different business, excluded)
 * Extend restoration[] as more property managers' restoration accounts surface.
 */
export const MELD_ACCOUNTS = {
  restoration: ['83074'],
  cleaning: ['51865'],
};

/** 'restoration' | 'cleaning' | 'unknown' — decided purely by account id. */
export function classifyMeldBusiness(parsed, accounts = MELD_ACCOUNTS) {
  const id = parsed && parsed.vendorAccountId;
  if (!id) return 'unknown';
  if (accounts.restoration.includes(id)) return 'restoration';
  if (accounts.cleaning.includes(id)) return 'cleaning';
  return 'unknown';
}

/**
 * Map a parsed email to the argument object for the `upsert_property_meld_meld`
 * RPC (the inbound-meld worker calls `db.rpc('upsert_property_meld_meld', …)`).
 * Keys mirror the RPC's `p_*` parameters exactly.
 *
 * @param {object} parsed  output of parseMeldEmail()
 * @param {object} [opts]
 * @param {string} [opts.receivedAt]  ISO timestamp the email arrived
 * @param {string} [opts.business]    override the classified business
 */
export function meldToUpsertParams(parsed, { receivedAt, business } = {}) {
  const a = (parsed && parsed.address) || {};
  return {
    p_meld_number: parsed.meldNumber,
    p_event: parsed.event,
    p_vendor_account_id: parsed.vendorAccountId,
    p_business: business || classifyMeldBusiness(parsed),
    p_org_id: parsed.orgId,
    p_meld_internal_id: parsed.meldId,
    p_pm_brand: parsed.pmBrand,
    p_is_emergency: !!parsed.isEmergency,
    p_meld_type: parsed.meldType,
    p_status: parsed.status,
    p_due_date_text: parsed.dueDate,
    p_appointment_window: parsed.appointmentWindow,
    p_address_street: a.street || null,
    p_address_unit: a.unit || null,
    p_address_city_state_zip: a.cityStateZip || null,
    p_address_full: a.full || null,
    p_description: parsed.description,
    p_description_clipped: !!parsed.descriptionTruncated,
    p_message_from: parsed.messageFrom,
    p_message_text: parsed.messageText,
    p_thread_reply_address: parsed.threadReplyAddress,
    p_portal_url: parsed.portalUrl,
    p_received_at: receivedAt || null,
  };
}

// Events that represent a real Meld we might track (vs. digests/noise).
const MELD_EVENTS = new Set([
  'assigned', 'canceled', 'message', 'appointment_scheduled', 'appointment_reminder',
]);

/**
 * Decide whether a parsed email should flow into UPR.
 *   - Only restoration-account Melds are ingested (owner rule: account 83074).
 *   - daily_summary / unknown events are never ingested.
 *   - An unrecognized account on a real Meld is surfaced (needsReview) rather
 *     than silently dropped, so a new property manager isn't missed.
 *
 * @returns {{ ingest: boolean, business: string, event: string, needsReview: boolean }}
 */
export function shouldIngestMeld(parsed, { accounts = MELD_ACCOUNTS } = {}) {
  const event = parsed ? parsed.event : 'unknown';
  const business = classifyMeldBusiness(parsed, accounts);
  const isMeld = MELD_EVENTS.has(event);
  return {
    ingest: isMeld && business === 'restoration',
    business,
    event,
    needsReview: isMeld && business === 'unknown',
  };
}
