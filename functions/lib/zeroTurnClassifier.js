/**
 * ════════════════════════════════════════════════
 * FILE: zeroTurnClassifier.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A fallback classification pass for a call Deepgram could not split into
 *   ANY speaker turns at all — genuine dead air, a voicemail greeting that
 *   got no reply, or a recording that cuts off before anyone spoke.
 *   `buildCleanupPrompt(turns)` in callCleanup.js returns "" for these calls
 *   (there is nothing to number), so the normal clean-up/classification pass
 *   never runs and `caller_never_responded` never gets set — the lead sits
 *   in the pipeline forever with spam_flag:false and no signals at all. But
 *   Deepgram still hands back a flat raw transcript string and its own
 *   one-line summary even when it found zero diarized turns, and that raw
 *   text is enough for a human (or an AI) to tell a genuine no-message
 *   hangup apart from a short-but-real voicemail. This file formats that raw
 *   text for the ask (buildZeroTurnPrompt) and safely reads Claude's JSON
 *   answer back (parseZeroTurnResponse) — same pure/degrade-safely split as
 *   callCleanup.js and speakerNaming.js. The Claude API call itself lives in
 *   the worker.
 *
 * WHERE IT LIVES:
 *   Pure helper — no network, no DB. Imported by functions/api/transcribe-call.js.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   buildZeroTurnPrompt(rawText, summary) → string
 *              parseZeroTurnResponse(text) → { callerNeverResponded: boolean } | null
 *
 * NOTES / GOTCHAS:
 *   - Deliberately NOT a duration/keyword heuristic. Verified live against
 *     inbound_leads: a 68-second "voicemail" call from a real customer
 *     ("this is Brynn, requesting a mold inspection... left her callback
 *     number") is a genuine lead, while several 20-30 second calls really
 *     are dead air with no message — length alone can't tell them apart.
 *     Only reading the actual words can.
 *   - Same lenient-boolean contract as callCleanup.js's other booleans: only
 *     a literal JSON `true` sets callerNeverResponded; a garbled/missing/
 *     unparseable AI answer makes parseZeroTurnResponse return null, and the
 *     caller (transcribe-call.js) treats null as a no-op — the lead is left
 *     exactly as it was, never a false spam-flag.
 * ════════════════════════════════════════════════
 */

// Format Deepgram's raw flat transcript + its own one-line summary for the AI.
// Returns "" when there is truly nothing to classify (no raw text AND no
// summary) — the caller treats an empty prompt as "skip the API call".
export function buildZeroTurnPrompt(rawText, summary) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  const sum = typeof summary === 'string' ? summary.trim() : '';
  if (!text && !sum) return '';
  const parts = [];
  if (text) parts.push(`Raw transcript (no speaker turns could be separated):\n${text}`);
  if (sum) parts.push(`Deepgram's own automated one-line summary:\n${sum}`);
  return parts.join('\n\n');
}

/**
 * Parse Claude's JSON answer defensively (raw JSON, fenced, or in prose), same
 * contract as callCleanup.js/speakerNaming.js. Returns
 * { callerNeverResponded: boolean } or null when there's no usable JSON
 * object at all. Reads the boolean leniently — only a literal `true` sets
 * callerNeverResponded; anything else (false, missing, a non-boolean value)
 * yields false, never a parse failure.
 */
export function parseZeroTurnResponse(text) {
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
  if (!obj || typeof obj !== 'object') return null;

  return { callerNeverResponded: obj.caller_never_responded === true };
}
