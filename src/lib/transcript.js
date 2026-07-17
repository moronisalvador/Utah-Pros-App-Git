/**
 * ════════════════════════════════════════════════
 * FILE: transcript.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Takes a call's transcribed text — usually a back-and-forth like
 *   "Speaker 1: ... Speaker 2: ..." — and splits it into a list of
 *   individual lines, one per speaker turn, so the app can show a call
 *   as a readable conversation instead of one giant unbroken paragraph.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *
 * NOTES / GOTCHAS:
 *   - Pure, side-effect-free — kept out of ActivityTimeline.jsx (which
 *     transitively imports AuthContext/realtime.js, both of which touch
 *     env vars at module load) specifically so this can be unit tested
 *     without a Supabase env stub.
 * ════════════════════════════════════════════════
 */

// Split a Deepgram-diarized transcript ("Speaker 1: ... Speaker 2: ...")
// into ordered { speaker, line } turns. Returns null for anything that
// isn't a real back-and-forth (fewer than 2 recognizable speaker changes),
// so a caller falls back to plain text instead of a broken one-turn render.
export function parseTranscript(text) {
  const matches = [...text.matchAll(/Speaker\s*(\d+)\s*:\s*/gi)];
  if (matches.length < 2) return null;
  return matches
    .map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      return { speaker: m[1], line: text.slice(start, end).trim() };
    })
    .filter((t) => t.line);
}
