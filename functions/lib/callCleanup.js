/**
 * ════════════════════════════════════════════════
 * FILE: callCleanup.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure pieces of the "make the transcript and summary better" step. After
 *   a call is transcribed and its speakers are named, we ask Claude to (1) fix
 *   obvious speech-to-text mistakes in each turn's wording — without changing
 *   what was actually said — (2) write a short, business-aware summary
 *   (damage type, urgency, key details, how the call ended) to replace
 *   Deepgram's generic one-line summary, (3) flag whether the call ended with
 *   an actual inspection/appointment agreed to (used to auto-advance the lead
 *   to the "Inspection Scheduled" pipeline stage), (4) flag whether the agent
 *   spoke but the caller never actually responded (used to auto-flag the lead
 *   as spam), (5) pull out the customer's email/address when they clearly
 *   stated it themselves (used to backfill a blank field on an already-linked
 *   contact), (6) pull out the customer's full name from the ACTUAL
 *   conversation content — not from the speaker labels the turns already carry
 *   — since a re-run can see a turn already labeled with just a first name
 *   from an earlier pass, and the full name (including a last name stated
 *   later in the call) needs to be re-derived from the real content, not
 *   assumed from the existing label, (7) decide whether the call is a real
 *   customer inquiry at all — vs. a vendor/solicitor/compliance call where the
 *   caller spoke but never actually asked for a service (used to auto-flag the
 *   lead as spam the same way caller_never_responded does, just catching the
 *   case where the caller DID say something), and (8) when it is a real
 *   inquiry, whether the requested service is one Utah Pros actually offers
 *   (used to auto-move a wrong-service lead to "Lost" so it doesn't sit in the
 *   pipeline as a live lead). This file: formats the transcript for that ask
 *   (buildCleanupPrompt), safely reads Claude's JSON answer back
 *   (parseCleanupResponse), and applies it to the transcript (applyCleanup).
 *   The Claude API call itself lives in the worker; everything here is pure
 *   and unit-tested.
 *
 * WHERE IT LIVES:
 *   Pure helper — no network, no DB. Imported by functions/api/transcribe-call.js.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   buildCleanupPrompt(turns) → string
 *              parseCleanupResponse(text, expectedCount) → { turns, summary,
 *                inspectionScheduled, callerNeverResponded, customerEmail,
 *                customerAddress, customerFullName, isCustomerInquiry,
 *                serviceMatch } | null
 *              applyCleanup(analysis, cleaned) → analysis
 *              nameExtendsOrMatches(newName, establishedName) → boolean
 *
 * NOTES / GOTCHAS:
 *   - Degrades safely like speakerNaming.js: a garbage/missing AI answer, or one
 *     whose turn count doesn't exactly match what was sent, → parse returns null
 *     → apply returns the analysis unchanged (original Deepgram text/summary and
 *     every new signal left as whatever they already were). A turn-count
 *     mismatch means the model merged or dropped a line — we'd rather keep the
 *     untouched original than misattribute cleaned text to the wrong turn.
 *   - Only rewrites TEXT, never the speaker/role — this runs after speaker
 *     naming/resegmentation, which already owns "who said it."
 *   - applyCleanup keeps the original wording on each cleaned turn as `rawText`
 *     (a QA/audit trail), and never mutates the input analysis.
 *   - inspection_scheduled / caller_never_responded are signals, not fact
 *     sources: a false negative just leaves the lead wherever it was (still
 *     fixable by hand); a false positive moves/flags it once — nothing
 *     destructive either way. customer_email/customer_address are read
 *     leniently too (a garbled or missing value just yields null — no parse
 *     failure), and `parseCleanupResponse` additionally drops an email that
 *     doesn't look like one (basic shape check) so a hallucinated non-email
 *     string can never reach a contact record.
 *   - is_customer_inquiry defaults to true (only a literal `false` flips it) —
 *     the opposite lenient direction from the other booleans, on purpose: a
 *     missing/garbled field must never cause a real customer to get
 *     mis-flagged as spam. service_match only accepts the exact strings
 *     "in_scope"/"out_of_scope" (case-insensitively); anything else — missing,
 *     garbled, or a call that isn't a customer inquiry at all — reads as null,
 *     which is a no-op downstream (never auto-disqualifies a lead on a shaky
 *     signal).
 * ════════════════════════════════════════════════
 */

// Format the (already speaker-labeled) turns as a numbered "<n>. <speaker>: <text>"
// list — numbering lets parseCleanupResponse verify a strict 1:1 turn count on
// the way back, instead of guessing which cleaned line maps to which turn.
export function buildCleanupPrompt(turns) {
  if (!Array.isArray(turns)) return '';
  const usable = turns.filter((t) => t && typeof t.text === 'string' && t.text.trim());
  if (!usable.length) return '';
  return usable.map((t, i) => `${i + 1}. ${t.speaker || 'Speaker'}: ${t.text.trim()}`).join('\n');
}

// Lenient "does this look like a real email" check — not full RFC validation,
// just enough to reject a hallucinated non-email string (a name, a phone
// number, a stray word) before it ever reaches a contact record.
const EMAIL_SHAPE_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse Claude's JSON answer defensively (raw JSON, fenced, or in prose), same
 * contract as speakerNaming.js's parsers. Returns
 * { turns: string[], summary, inspectionScheduled, callerNeverResponded,
 *   customerEmail, customerAddress } or null when there's no usable result —
 * including when `turns.length` doesn't exactly equal `expectedCount` (see
 * file header). The boolean signals are read leniently (only a literal `true`
 * counts) so a model that omits a field entirely just yields `false`/`null`,
 * never a parse failure.
 */
export function parseCleanupResponse(text, expectedCount) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || !Array.isArray(obj.turns)) return null;

  const turns = obj.turns.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
  if (typeof expectedCount === 'number' && turns.length !== expectedCount) return null;
  if (!turns.length) return null;

  const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : null;
  const inspectionScheduled = obj.inspection_scheduled === true;
  const callerNeverResponded = obj.caller_never_responded === true;

  const rawEmail = typeof obj.customer_email === 'string' ? obj.customer_email.trim() : '';
  const customerEmail = rawEmail && EMAIL_SHAPE_RX.test(rawEmail) ? rawEmail.toLowerCase() : null;

  const rawAddress = typeof obj.customer_address === 'string' ? obj.customer_address.trim() : '';
  const customerAddress = rawAddress || null;

  const rawFullName = typeof obj.customer_full_name === 'string' ? obj.customer_full_name.trim() : '';
  const customerFullName = rawFullName || null;

  // Opposite lenient direction from the other booleans on purpose — see file header.
  const isCustomerInquiry = obj.is_customer_inquiry === false ? false : true;

  const rawServiceMatch = typeof obj.service_match === 'string' ? obj.service_match.trim().toLowerCase() : '';
  const serviceMatch = rawServiceMatch === 'in_scope' || rawServiceMatch === 'out_of_scope' ? rawServiceMatch : null;

  return {
    turns, summary, inspectionScheduled, callerNeverResponded, customerEmail, customerAddress, customerFullName,
    isCustomerInquiry, serviceMatch,
  };
}

// Mirrors set_lead_caller_name's SQL "extends" check (word-boundary prefix,
// case-insensitive — see 20260721_crm_caller_name_upgrade.sql) so the JS side
// can judge the SAME way the DB write-guard already does whether a freshly-
// extracted name is trustworthy against a name already established on the
// lead, rather than blindly treating every fresh AI guess as authoritative.
// Returns true when there's nothing to conflict with (either name blank/
// missing), when the names match, or when one is a superset-extension of the
// other (e.g. "Jake" / "Jake Nelson"). Returns false only on a genuine
// mismatch (e.g. established "Jake Nelson", new "Ben") — the caller should
// then treat the new name as low-confidence rather than preferring it,
// exactly the scenario a short/ambiguous call can trigger (a caller asking
// "Is this Ben?" got misread as the caller's own name — see speakerNaming.js).
export function nameExtendsOrMatches(newName, establishedName) {
  const a = typeof newName === 'string' ? newName.trim() : '';
  const b = typeof establishedName === 'string' ? establishedName.trim() : '';
  if (!a || !b) return true;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return true;
  return la.startsWith(`${lb} `) || lb.startsWith(`${la} `);
}

/**
 * Apply a parsed cleanup result to an analysis: replace each non-empty turn's
 * text with its cleaned counterpart (keeping the original as `rawText`), swap
 * in the new summary, and set the four new signal fields. Pure — returns a
 * new analysis; the original is untouched. Returns the analysis unchanged when
 * `cleaned` is null (so a failed AI pass is a no-op, same contract as
 * applySpeakerIdentities — every signal is left as whatever it already was
 * rather than reset).
 */
export function applyCleanup(analysis, cleaned) {
  if (!analysis || !Array.isArray(analysis.turns) || !cleaned) return analysis;

  let i = 0;
  const turns = analysis.turns.map((t) => {
    if (!t || typeof t.text !== 'string' || !t.text.trim()) return t;
    const replacement = cleaned.turns[i];
    i++;
    return replacement ? { ...t, text: replacement, rawText: t.text } : t;
  });

  return {
    ...analysis,
    turns,
    summary: cleaned.summary || analysis.summary,
    inspection_scheduled: cleaned.inspectionScheduled === true,
    caller_never_responded: cleaned.callerNeverResponded === true,
    customer_email: cleaned.customerEmail || null,
    customer_address: cleaned.customerAddress || null,
    customer_full_name: cleaned.customerFullName || null,
    is_customer_inquiry: cleaned.isCustomerInquiry === false ? false : true,
    service_match: cleaned.serviceMatch === 'in_scope' || cleaned.serviceMatch === 'out_of_scope' ? cleaned.serviceMatch : null,
  };
}
