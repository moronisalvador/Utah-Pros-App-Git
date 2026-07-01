/**
 * ════════════════════════════════════════════════
 * FILE: deepgram.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Takes the raw answer Deepgram gives back after it listens to a phone call
 *   and turns it into clean, readable text — with each speaker labeled
 *   ("Speaker 1:", "Speaker 2:") so you can tell the caller apart from our rep.
 *   If Deepgram heard nothing usable, it produces no text at all (rather than a
 *   broken or empty-looking string) so the caller can store a real null.
 *
 * WHERE IT LIVES:
 *   Pure helper — no network, no DB. Imported by functions/api/transcribe-call.js
 *   and unit-tested by deepgram.test.js. Kept pure on purpose so it is testable
 *   without a live Deepgram account (same split as callrail.js's predicates).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   formatDeepgramTranscript(deepgramJson) → string | null
 *
 * NOTES / GOTCHAS:
 *   - Speaker indexes from Deepgram are 0-based; we present them 1-based
 *     ("Speaker 1") since that reads more naturally to non-technical staff.
 *   - We build the transcript from the structured `paragraphs.paragraphs`
 *     array (grouped speaker turns) rather than Deepgram's pre-joined
 *     `paragraphs.transcript` string, so the label format is ours to control.
 *     Falls back to the plain `alternatives[0].transcript` when diarization
 *     data isn't present (e.g. diarize turned off, or a one-speaker call).
 * ════════════════════════════════════════════════
 */

/**
 * Normalize a Deepgram pre-recorded ("listen") response into readable, optionally
 * speaker-labeled text. Returns a trimmed string, or null when there is nothing
 * usable to store in inbound_leads.transcription.
 */
export function formatDeepgramTranscript(deepgramJson) {
  const alt = deepgramJson?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return null;

  // Preferred path: diarized paragraphs → "Speaker N: <sentences>" per turn.
  const paras = alt.paragraphs?.paragraphs;
  if (Array.isArray(paras) && paras.length) {
    const turns = paras
      .map((p) => {
        const text = (p?.sentences || [])
          .map((s) => (typeof s === 'string' ? s : s?.text || ''))
          .filter(Boolean)
          .join(' ')
          .trim();
        if (!text) return '';
        // Only prefix a speaker label when diarization actually tagged a speaker.
        const label = Number.isInteger(p?.speaker) ? `Speaker ${p.speaker + 1}: ` : '';
        return `${label}${text}`;
      })
      .filter(Boolean);
    const joined = turns.join('\n\n').trim();
    if (joined) return joined;
  }

  // Fallback: Deepgram's own joined paragraph text, if present.
  const paraText = alt.paragraphs?.transcript;
  if (typeof paraText === 'string' && paraText.trim()) return paraText.trim();

  // Last resort: the plain flat transcript.
  if (typeof alt.transcript === 'string' && alt.transcript.trim()) return alt.transcript.trim();

  return null;
}
