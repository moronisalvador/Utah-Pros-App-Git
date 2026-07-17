/**
 * ════════════════════════════════════════════════
 * FILE: transcript.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves parseTranscript() correctly splits a Deepgram-diarized call
 *   transcript ("Speaker 1: ... Speaker 2: ...") into per-speaker turns,
 *   and correctly bails out (returns null) on plain text that isn't
 *   actually a back-and-forth transcript, so the caller (ActivityTimeline)
 *   falls back to showing it as normal text instead of a broken
 *   one-line "transcript".
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./transcript.js
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test. No creds needed; runs everywhere.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { parseTranscript } from './transcript.js';

describe('parseTranscript', () => {
  it('splits a two-speaker call into ordered turns', () => {
    const text = 'Speaker 1: Thank you for calling Utah Pros. Speaker 2: Hey, my name is Tanner. Speaker 1: Great, Tanner, what can we help with?';
    expect(parseTranscript(text)).toEqual([
      { speaker: '1', line: 'Thank you for calling Utah Pros.' },
      { speaker: '2', line: 'Hey, my name is Tanner.' },
      { speaker: '1', line: 'Great, Tanner, what can we help with?' },
    ]);
  });

  it('returns null for plain text with no speaker markers', () => {
    expect(parseTranscript('Called back, left a voicemail.')).toBeNull();
  });

  it('returns null when there is only a single speaker turn (not a real back-and-forth)', () => {
    expect(parseTranscript('Speaker 1: just one line, no reply captured')).toBeNull();
  });

  it('drops an empty trailing turn instead of rendering a blank line', () => {
    const text = 'Speaker 1: Hello. Speaker 2: ';
    expect(parseTranscript(text)).toEqual([
      { speaker: '1', line: 'Hello.' },
    ]);
  });

  it('tolerates inconsistent spacing/casing around "Speaker N:"', () => {
    const text = 'speaker 1:Hi there. SPEAKER   2 :   Hi back.';
    expect(parseTranscript(text)).toEqual([
      { speaker: '1', line: 'Hi there.' },
      { speaker: '2', line: 'Hi back.' },
    ]);
  });
});
