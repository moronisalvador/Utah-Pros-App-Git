/**
 * ════════════════════════════════════════════════
 * FILE: transcript.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Takes a call's transcript data and turns it into a readable back-and-forth
 *   list of lines, each one labeled "Utah Pros" or "Customer" instead of the
 *   raw "Speaker 1" / "Speaker 2" a transcription service hands back.
 *
 *   There are two sources, tried in order:
 *   1. turnsFromAnalysis() — the ACCURATE path. Every transcribed call already
 *      gets a separate AI pass (see functions/api/transcribe-call.js) that
 *      actually figures out which speaker is the company rep vs. the caller.
 *      When that's available, we just use it.
 *   2. parseTranscript() — a FALLBACK for a call that predates that pass (or
 *      hit the backfill cap) and only has the flat "Speaker 1: ... Speaker 2:
 *      ..." text. This guesses instead of knowing: it assumes whichever
 *      speaker talks first is Utah Pros (true almost all the time — an
 *      inbound call is answered with a company greeting), which is the same
 *      assumption the backend's own AI-naming prompt documents. It's a
 *      best-effort default, not a verified identity.
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

const AGENT_LABEL = 'Utah Pros';
const CUSTOMER_LABEL = 'Customer';

// The accurate path — turns already role-identified by the backend
// (inbound_leads.transcript_analysis.turns, each { role: 'agent'|'customer',
// text }). Returns null when there's nothing usable, so a caller falls back
// to parseTranscript().
export function turnsFromAnalysis(analysis) {
  const turns = Array.isArray(analysis?.turns) ? analysis.turns : null;
  if (!turns) return null;
  const rows = turns
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .map((t) => ({
      speaker: t.role === 'agent' ? AGENT_LABEL : t.role === 'customer' ? CUSTOMER_LABEL : (t.speaker || 'Unknown'),
      line: t.text.trim(),
    }));
  return rows.length >= 2 ? rows : null;
}

// The fallback path — split a flat "Speaker 1: ... Speaker 2: ..." transcript
// into turns, labeling the first speaker to talk as Utah Pros and the other
// as Customer (a default, not a verified identity — see file header). A
// third+ distinct speaker (rare) keeps a neutral "Speaker N" label since
// there's no reliable default for it. Returns null for anything that isn't a
// real 2+-turn back-and-forth.
export function parseTranscript(text) {
  const matches = [...text.matchAll(/Speaker\s*(\d+)\s*:\s*/gi)];
  if (matches.length < 2) return null;

  const rawTurns = matches
    .map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      return { speakerNum: m[1], line: text.slice(start, end).trim() };
    })
    .filter((t) => t.line);
  if (!rawTurns.length) return null;

  const order = [];
  for (const t of rawTurns) if (!order.includes(t.speakerNum)) order.push(t.speakerNum);
  const labelFor = (num) => {
    const idx = order.indexOf(num);
    if (idx === 0) return AGENT_LABEL;
    if (idx === 1) return CUSTOMER_LABEL;
    return `Speaker ${num}`;
  };

  return rawTurns.map((t) => ({ speaker: labelFor(t.speakerNum), line: t.line }));
}
