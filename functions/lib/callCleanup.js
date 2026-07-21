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
 *   Deepgram's generic one-line summary, and (3) flag whether the call ended
 *   with an actual inspection/appointment agreed to (used to auto-advance the
 *   lead to the "Inspection Scheduled" pipeline stage). This file: formats the
 *   transcript for that ask (buildCleanupPrompt), safely reads Claude's JSON
 *   answer back (parseCleanupResponse), and applies it to the transcript
 *   (applyCleanup). The Claude API call itself lives in the worker; everything
 *   here is pure and unit-tested.
 *
 * WHERE IT LIVES:
 *   Pure helper — no network, no DB. Imported by functions/api/transcribe-call.js.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   buildCleanupPrompt(turns) → string
 *              parseCleanupResponse(text, expectedCount) → { turns, summary, inspectionScheduled } | null
 *              applyCleanup(analysis, cleaned) → analysis
 *
 * NOTES / GOTCHAS:
 *   - Degrades safely like speakerNaming.js: a garbage/missing AI answer, or one
 *     whose turn count doesn't exactly match what was sent, → parse returns null
 *     → apply returns the analysis unchanged (original Deepgram text/summary
 *     stand, inspection_scheduled left as whatever it already was). A turn-count
 *     mismatch means the model merged or dropped a line — we'd rather keep the
 *     untouched original than misattribute cleaned text to the wrong turn.
 *   - Only rewrites TEXT, never the speaker/role — this runs after speaker
 *     naming/resegmentation, which already owns "who said it."
 *   - applyCleanup keeps the original wording on each cleaned turn as `rawText`
 *     (a QA/audit trail), and never mutates the input analysis.
 *   - inspection_scheduled is a signal, not a fact source: a false negative just
 *     means the lead stays wherever it was (no auto-advance, still fixable by
 *     hand); a false positive moves it one stage — nothing destructive either way.
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

/**
 * Parse Claude's JSON answer defensively (raw JSON, fenced, or in prose), same
 * contract as speakerNaming.js's parsers. Returns
 * { turns: string[], summary, inspectionScheduled } or null when there's no
 * usable result — including when `turns.length` doesn't exactly equal
 * `expectedCount` (see file header). `inspectionScheduled` is read leniently
 * (only `=== true` counts) so a model that omits the field entirely just
 * yields `false`, never a parse failure.
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
  return { turns, summary, inspectionScheduled };
}

/**
 * Apply a parsed cleanup result to an analysis: replace each non-empty turn's
 * text with its cleaned counterpart (keeping the original as `rawText`), swap
 * in the new summary, and set `inspection_scheduled`. Pure — returns a new
 * analysis; the original is untouched. Returns the analysis unchanged when
 * `cleaned` is null (so a failed AI pass is a no-op, same contract as
 * applySpeakerIdentities — inspection_scheduled is left as whatever it
 * already was rather than reset to false).
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
  };
}
