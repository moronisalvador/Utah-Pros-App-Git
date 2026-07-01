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
 *   - buildTranscriptAnalysis() produces the richer structured object stored in
 *     inbound_leads.transcript_analysis: speaker-attributed turns PLUS Deepgram
 *     Audio Intelligence (summary, sentiment, topics, entities). Speakers come
 *     from the audio CHANNEL when the recording is stereo (CallRail records
 *     Agent + Customer on separate channels → exact labels, no guessing), and
 *     fall back to diarization ("Speaker N") when the audio is mono.
 * ════════════════════════════════════════════════
 */

// Deepgram's topic detector over-generates; cap the stored/displayed set to the
// most confident few so the Call Log shows a short, relevant chip row.
const TOP_TOPICS = 6;

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

// Channel index → human role. CallRail records the business line (Agent) and the
// caller (Customer) on separate channels; Deepgram preserves that as channel 0/1.
// If a live call proves the mapping is reversed, flip these two labels.
const CHANNEL_ROLE = { 0: 'Agent', 1: 'Customer' };

// Build speaker turns from stereo utterances (each tagged with a `channel`),
// ordered by start time so the two channels interleave into one conversation.
function turnsFromUtterances(utterances) {
  return utterances
    .filter((u) => u && typeof u.transcript === 'string' && u.transcript.trim())
    .slice()
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    .map((u) => ({
      speaker: CHANNEL_ROLE[u.channel] || `Channel ${(u.channel ?? 0) + 1}`,
      text: u.transcript.trim(),
    }));
}

// Build speaker turns from diarized paragraphs (mono audio) — "Speaker N", 1-based.
function turnsFromParagraphs(paras) {
  return paras
    .map((p) => {
      const text = (p?.sentences || [])
        .map((s) => (typeof s === 'string' ? s : s?.text || ''))
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!text) return null;
      const speaker = Number.isInteger(p?.speaker) ? `Speaker ${p.speaker + 1}` : 'Speaker';
      return { speaker, text };
    })
    .filter(Boolean);
}

/**
 * Turn a Deepgram response into the structured analysis stored in
 * inbound_leads.transcript_analysis. Returns null when there's no usable
 * transcript at all; otherwise an object with speaker-attributed turns and
 * whatever Audio Intelligence features Deepgram returned. Every field is
 * best-effort (defensive against Deepgram shape drift) — a missing feature is
 * null / [], never a throw.
 */
export function buildTranscriptAnalysis(deepgramJson) {
  const results = deepgramJson?.results;
  const alt = results?.channels?.[0]?.alternatives?.[0];

  // Prefer channel-based turns (stereo) — exact Agent/Customer separation.
  const utterances = Array.isArray(results?.utterances) ? results.utterances : [];
  const channelCount = Array.isArray(results?.channels) ? results.channels.length : 0;
  const utteranceChannels = new Set(utterances.map((u) => u?.channel));
  const isMultichannel = channelCount > 1 || utteranceChannels.size > 1;

  let turns = [];
  let speakerMode = 'diarize';
  if (isMultichannel && utterances.length) {
    turns = turnsFromUtterances(utterances);
    speakerMode = 'channel';
  } else if (Array.isArray(alt?.paragraphs?.paragraphs) && alt.paragraphs.paragraphs.length) {
    turns = turnsFromParagraphs(alt.paragraphs.paragraphs);
    speakerMode = 'diarize';
  }

  // Nothing usable at all → null. This MUST mirror formatDeepgramTranscript's full
  // fallback ladder (paragraphs.paragraphs → paragraphs.transcript → transcript),
  // otherwise a row could get flat text but null analysis and be re-transcribed
  // (re-billed) on every backfill run. `turns` covers the first tier; check the
  // other two here.
  const hasFlatText =
    (typeof alt?.transcript === 'string' && alt.transcript.trim()) ||
    (typeof alt?.paragraphs?.transcript === 'string' && alt.paragraphs.transcript.trim());
  if (!turns.length && !hasFlatText) return null;

  // ── Audio Intelligence (all optional) ──
  const summary =
    (typeof results?.summary?.short === 'string' && results.summary.short.trim()) || null;

  const avg = results?.sentiments?.average;
  const sentiment =
    avg && typeof avg.sentiment === 'string'
      ? { label: avg.sentiment, score: typeof avg.sentiment_score === 'number' ? avg.sentiment_score : null }
      : null;

  // Topics: Deepgram over-generates (20+ per call, incl. noise like "watermelon").
  // Keep each topic's best confidence, then take the TOP_TOPICS most confident so
  // the UI shows a short, relevant set instead of a chip wall.
  const topicScore = new Map();
  for (const seg of results?.topics?.segments || []) {
    for (const t of seg?.topics || []) {
      if (!t?.topic) continue;
      const score = typeof t.confidence_score === 'number' ? t.confidence_score : 0;
      if (!topicScore.has(t.topic) || score > topicScore.get(t.topic)) topicScore.set(t.topic, score);
    }
  }
  const topics = [...topicScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TOPICS)
    .map(([topic]) => topic);

  // Entities: from the first channel's alternative; dedupe by label+value.
  const rawEntities = alt?.entities || [];
  const entities = [];
  const seen = new Set();
  for (const e of rawEntities) {
    if (!e?.value) continue;
    const key = `${e.label || ''}:${e.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({ label: e.label || null, value: e.value });
  }

  return { model: 'nova-3', speakerMode, turns, summary, sentiment, topics, entities };
}
