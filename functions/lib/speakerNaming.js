/**
 * ════════════════════════════════════════════════
 * FILE: speakerNaming.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure pieces of "name the speakers." After a call is transcribed, we ask
 *   Claude which speaker is the company rep (Agent) vs the caller (Customer) and
 *   what each person's name is. This file: formats the transcript for that ask
 *   (buildSpeakerPrompt), safely reads Claude's JSON answer back
 *   (parseSpeakerIdentities), and applies it to relabel each speaker turn
 *   (applySpeakerIdentities). The Claude API call itself lives in the worker;
 *   everything here is pure and unit-tested.
 *
 * WHERE IT LIVES:
 *   Pure helper — no network, no DB. Imported by functions/api/transcribe-call.js.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   buildSpeakerPrompt(turns) → string
 *              parseSpeakerIdentities(text) → { speakers, caller_name } | null
 *              applySpeakerIdentities(analysis, identities) → analysis
 *
 * NOTES / GOTCHAS:
 *   - Everything degrades safely: a garbage AI answer → parse returns null →
 *     apply returns the analysis unchanged (Speaker 1/2 stays). Naming is a
 *     best-effort enrichment, never a hard dependency of transcription.
 * ════════════════════════════════════════════════
 */

// Format the diarized/channel turns as "<speaker>: <text>" lines for the AI.
export function buildSpeakerPrompt(turns) {
  if (!Array.isArray(turns)) return '';
  return turns
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .map((t) => `${t.speaker}: ${t.text.trim()}`)
    .join('\n');
}

const normRole = (r) => {
  const v = typeof r === 'string' ? r.trim().toLowerCase() : '';
  return v === 'agent' || v === 'customer' ? v : null;
};
const normName = (n) => (typeof n === 'string' && n.trim() ? n.trim() : null);

/**
 * Parse Claude's JSON answer defensively. Accepts raw JSON, JSON in ```fences,
 * or JSON embedded in prose. Returns { speakers: {label:{role,name}}, caller_name }
 * or null if there's no usable speakers object.
 */
export function parseSpeakerIdentities(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  // Pull the outermost {...} so fences / surrounding prose don't break JSON.parse.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || !obj.speakers || typeof obj.speakers !== 'object') return null;

  const speakers = {};
  for (const [label, v] of Object.entries(obj.speakers)) {
    speakers[label] = { role: normRole(v?.role), name: normName(v?.name) };
  }
  return { speakers, caller_name: normName(obj.caller_name) };
}

/**
 * Apply parsed identities to an analysis: relabel each turn's speaker to the
 * detected name (or Agent/Customer role label) and attach a `role`. Pure — returns
 * a new analysis; the original is untouched. Returns the analysis unchanged when
 * identities is null/invalid (so a failed AI pass is a no-op).
 */
export function applySpeakerIdentities(analysis, identities) {
  if (!analysis || !Array.isArray(analysis.turns)) return analysis;
  if (!identities || !identities.speakers) return analysis;

  const turns = analysis.turns.map((t) => {
    const id = identities.speakers[t.speaker];
    if (!id) return { ...t, role: t.role ?? null };
    const display = id.name || (id.role === 'agent' ? 'Agent' : id.role === 'customer' ? 'Customer' : t.speaker);
    return { ...t, speaker: display, role: id.role };
  });

  return { ...analysis, turns };
}
