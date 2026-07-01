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
import { formatDeepgramTranscript } from './deepgram.js';

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
