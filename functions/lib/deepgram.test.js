/**
 * ════════════════════════════════════════════════
 * FILE: deepgram.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that the code which turns Deepgram's raw transcription response into
 *   readable, speaker-labeled text behaves correctly — including when Deepgram
 *   sends back nothing useful (empty or malformed), where it must produce no
 *   text at all rather than a broken string.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./deepgram.js (formatDeepgramTranscript)
 *
 * NOTES / GOTCHAS:
 *   - Written test-first (CRM roadmap "test-first" gate): this file was committed
 *     failing before formatDeepgramTranscript existed. Do not edit the test to make
 *     it pass — fix the implementation.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { formatDeepgramTranscript, buildTranscriptAnalysis } from './deepgram.js';

// A trimmed-down shape of a real Deepgram pre-recorded response with
// diarize=true + smart_format (paragraphs, each tagged with a speaker index).
const diarized = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hello, this is Utah Pros Restoration. Hi, my basement is flooded.',
            paragraphs: {
              transcript: '\nSpeaker 0: Hello, this is Utah Pros Restoration.\n\nSpeaker 1: Hi, my basement is flooded.\n',
              paragraphs: [
                { speaker: 0, sentences: [{ text: 'Hello, this is Utah Pros Restoration.' }] },
                { speaker: 1, sentences: [{ text: 'Hi, my basement is flooded.' }] },
              ],
            },
          },
        ],
      },
    ],
  },
};

describe('formatDeepgramTranscript', () => {
  it('builds a speaker-labeled transcript from diarized paragraphs (1-indexed speakers)', () => {
    const out = formatDeepgramTranscript(diarized);
    expect(out).toBe(
      'Speaker 1: Hello, this is Utah Pros Restoration.\n\nSpeaker 2: Hi, my basement is flooded.'
    );
  });

  it('joins multiple sentences within one speaker paragraph', () => {
    const twoSentences = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'Thanks for calling. How can I help?',
                paragraphs: {
                  paragraphs: [
                    {
                      speaker: 0,
                      sentences: [{ text: 'Thanks for calling.' }, { text: 'How can I help?' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    expect(formatDeepgramTranscript(twoSentences)).toBe('Speaker 1: Thanks for calling. How can I help?');
  });

  it('falls back to the plain transcript when no diarized paragraphs exist', () => {
    const plain = {
      results: { channels: [{ alternatives: [{ transcript: 'Just a plain transcript.' }] }] },
    };
    expect(formatDeepgramTranscript(plain)).toBe('Just a plain transcript.');
  });

  it('returns null for an empty transcript', () => {
    const empty = {
      results: { channels: [{ alternatives: [{ transcript: '   ' }] }] },
    };
    expect(formatDeepgramTranscript(empty)).toBeNull();
  });

  it('returns null when there are no alternatives', () => {
    expect(formatDeepgramTranscript({ results: { channels: [{ alternatives: [] }] } })).toBeNull();
  });

  it('returns null for null / garbage / missing structure', () => {
    expect(formatDeepgramTranscript(null)).toBeNull();
    expect(formatDeepgramTranscript(undefined)).toBeNull();
    expect(formatDeepgramTranscript({})).toBeNull();
    expect(formatDeepgramTranscript('nope')).toBeNull();
  });
});

// A stereo (multichannel) Deepgram response: CallRail records Agent + Customer on
// separate channels, so utterances carry a `channel` (0=Agent, 1=Customer) and we
// build the conversation by interleaving them by start time — no diarization guessing.
const multichannel = {
  results: {
    channels: [
      { alternatives: [{ transcript: 'Hi, this is Ben with Utah Pros. How can I help you?', entities: [{ label: 'PERSON', value: 'Ben' }] }] },
      { alternatives: [{ transcript: 'Hi, this is Colton with Cascade Roofing.' }] },
    ],
    utterances: [
      { start: 6.0, channel: 0, transcript: 'How can I help you?' },
      { start: 0.5, channel: 0, transcript: 'Hi, this is Ben with Utah Pros.' },
      { start: 3.0, channel: 1, transcript: 'Hi, this is Colton with Cascade Roofing.' },
    ],
    summary: { result: 'success', short: 'A roofing contractor introduces himself and pitches a partnership.' },
    sentiments: { average: { sentiment: 'positive', sentiment_score: 0.42 } },
    topics: {
      segments: [
        { topics: [{ topic: 'roofing', confidence_score: 0.9 }] },
        { topics: [{ topic: 'partnership', confidence_score: 0.8 }, { topic: 'roofing', confidence_score: 0.7 }] },
      ],
    },
  },
};

// A mono (single-channel) response — diarization is the only speaker signal.
const diarizedOnly = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Hello. Hi there.',
            paragraphs: {
              paragraphs: [
                { speaker: 0, sentences: [{ text: 'Hello.' }] },
                { speaker: 1, sentences: [{ text: 'Hi there.' }] },
              ],
            },
          },
        ],
      },
    ],
  },
};

describe('buildTranscriptAnalysis', () => {
  it('builds Agent/Customer turns from stereo utterances, ordered by start time', () => {
    const a = buildTranscriptAnalysis(multichannel);
    expect(a.speakerMode).toBe('channel');
    expect(a.turns).toEqual([
      { speaker: 'Agent', text: 'Hi, this is Ben with Utah Pros.' },
      { speaker: 'Customer', text: 'Hi, this is Colton with Cascade Roofing.' },
      { speaker: 'Agent', text: 'How can I help you?' },
    ]);
  });

  it('extracts summary, sentiment, deduped topics, and entities', () => {
    const a = buildTranscriptAnalysis(multichannel);
    expect(a.summary).toBe('A roofing contractor introduces himself and pitches a partnership.');
    expect(a.sentiment).toEqual({ label: 'positive', score: 0.42 });
    expect(a.topics).toEqual(['roofing', 'partnership']);
    expect(a.entities).toEqual([{ label: 'PERSON', value: 'Ben' }]);
  });

  it('caps topics to the 6 most confident (Deepgram over-generates noise)', () => {
    const many = {
      results: {
        channels: [{ alternatives: [{ transcript: 'x', paragraphs: { paragraphs: [{ speaker: 0, sentences: [{ text: 'x' }] }] } }] }],
        topics: {
          segments: [{
            topics: [
              { topic: 'mold', confidence_score: 0.99 },
              { topic: 'watermelon', confidence_score: 0.10 },
              { topic: 'costs', confidence_score: 0.90 },
              { topic: 'cleaning', confidence_score: 0.80 },
              { topic: 'baking', confidence_score: 0.05 },
              { topic: 'respirator', confidence_score: 0.70 },
              { topic: 'hazmat', confidence_score: 0.60 },
              { topic: 'storing', confidence_score: 0.20 },
            ],
          }],
        },
      },
    };
    const a = buildTranscriptAnalysis(many);
    expect(a.topics).toEqual(['mold', 'costs', 'cleaning', 'respirator', 'hazmat', 'storing']);
    expect(a.topics).toHaveLength(6);
  });

  it('falls back to diarized Speaker turns when the audio is mono (one channel)', () => {
    const a = buildTranscriptAnalysis(diarizedOnly);
    expect(a.speakerMode).toBe('diarize');
    expect(a.turns).toEqual([
      { speaker: 'Speaker 1', text: 'Hello.' },
      { speaker: 'Speaker 2', text: 'Hi there.' },
    ]);
    // No intelligence features requested/returned → empty, not throwing.
    expect(a.summary).toBeNull();
    expect(a.sentiment).toBeNull();
    expect(a.topics).toEqual([]);
    expect(a.entities).toEqual([]);
  });

  it('returns null for null / garbage / no transcript content', () => {
    expect(buildTranscriptAnalysis(null)).toBeNull();
    expect(buildTranscriptAnalysis(undefined)).toBeNull();
    expect(buildTranscriptAnalysis({})).toBeNull();
    expect(buildTranscriptAnalysis('nope')).toBeNull();
    expect(buildTranscriptAnalysis({ results: { channels: [] } })).toBeNull();
  });

  // Regression: buildTranscriptAnalysis must be non-null WHENEVER
  // formatDeepgramTranscript is, or a row gets text-but-no-analysis and is
  // re-transcribed (re-billed) on every backfill run. This shape has a joined
  // paragraphs.transcript but an empty flat transcript and no structured paragraphs.
  it('is non-null when only paragraphs.transcript carries the text (recharge-trap guard)', () => {
    const paraTextOnly = {
      results: { channels: [{ alternatives: [{ transcript: '   ', paragraphs: { transcript: 'Speaker 0: Hello.' } }] }] },
    };
    expect(formatDeepgramTranscript(paraTextOnly)).toBe('Speaker 0: Hello.');
    expect(buildTranscriptAnalysis(paraTextOnly)).not.toBeNull();
  });
});
