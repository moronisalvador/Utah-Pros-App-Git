/**
 * ════════════════════════════════════════════════
 * FILE: transcript.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves both call-transcript paths label speakers "Utah Pros"/"Customer":
 *   turnsFromAnalysis() reading the backend's already-verified per-turn role,
 *   and parseTranscript() guessing from the flat "Speaker 1: ... Speaker 2:
 *   ..." text (first speaker to talk = Utah Pros) when that structured data
 *   isn't available. Also proves each bails out (returns null) on input that
 *   isn't actually a usable back-and-forth, so the caller (ActivityTimeline)
 *   falls back to showing it as normal text instead of a broken transcript.
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
import { turnsFromAnalysis, parseTranscript } from './transcript.js';

describe('turnsFromAnalysis (the accurate, backend-verified path)', () => {
  it('labels turns Utah Pros/Customer from the already-identified role', () => {
    const analysis = {
      turns: [
        { role: 'agent', speaker: 'Ben', text: 'Hi, this is Ben with Utah Pros. How can I help?' },
        { role: 'customer', speaker: 'Customer', text: 'Hey, I have a leak in my basement.' },
        { role: 'agent', speaker: 'Ben', text: 'Got it, let\'s get someone out there.' },
      ],
    };
    expect(turnsFromAnalysis(analysis)).toEqual([
      { speaker: 'Utah Pros', line: 'Hi, this is Ben with Utah Pros. How can I help?' },
      { speaker: 'Customer', line: 'Hey, I have a leak in my basement.' },
      { speaker: 'Utah Pros', line: 'Got it, let\'s get someone out there.' },
    ]);
  });

  it('ignores the per-turn name (Ben) — always shows the company label, not the individual', () => {
    const analysis = { turns: [
      { role: 'agent', speaker: 'Ben', text: 'Hello.' },
      { role: 'customer', speaker: 'Customer', text: 'Hi.' },
    ] };
    const rows = turnsFromAnalysis(analysis);
    expect(rows.map(r => r.speaker)).toEqual(['Utah Pros', 'Customer']);
  });

  it('returns null when there is no analysis', () => {
    expect(turnsFromAnalysis(null)).toBeNull();
    expect(turnsFromAnalysis(undefined)).toBeNull();
  });

  it('returns null when turns is missing or not an array', () => {
    expect(turnsFromAnalysis({})).toBeNull();
    expect(turnsFromAnalysis({ turns: 'not an array' })).toBeNull();
  });

  it('returns null for a single-turn analysis (not a real back-and-forth)', () => {
    expect(turnsFromAnalysis({ turns: [{ role: 'agent', text: 'Hello?' }] })).toBeNull();
  });

  it('drops empty-text turns and keeps an unrecognized role neutral', () => {
    const analysis = { turns: [
      { role: 'agent', text: 'Hi.' },
      { role: null, speaker: 'Speaker 3', text: 'Someone else joined.' },
      { role: 'customer', text: '' },
    ] };
    expect(turnsFromAnalysis(analysis)).toEqual([
      { speaker: 'Utah Pros', line: 'Hi.' },
      { speaker: 'Speaker 3', line: 'Someone else joined.' },
    ]);
  });
});

describe('parseTranscript (the fallback, best-effort-guess path)', () => {
  it('labels the FIRST speaker to talk as Utah Pros, the other as Customer', () => {
    const text = 'Speaker 1: Thank you for calling Utah Pros. Speaker 2: Hey, my name is Tanner. Speaker 1: Great, Tanner, what can we help with?';
    expect(parseTranscript(text)).toEqual([
      { speaker: 'Utah Pros', line: 'Thank you for calling Utah Pros.' },
      { speaker: 'Customer', line: 'Hey, my name is Tanner.' },
      { speaker: 'Utah Pros', line: 'Great, Tanner, what can we help with?' },
    ]);
  });

  it('still labels correctly when diarization numbers the caller as Speaker 1 (first-to-talk wins, not the literal number)', () => {
    const text = 'Speaker 2: Thank you for calling Utah Pros. Speaker 1: Hi, I need help.';
    expect(parseTranscript(text)).toEqual([
      { speaker: 'Utah Pros', line: 'Thank you for calling Utah Pros.' },
      { speaker: 'Customer', line: 'Hi, I need help.' },
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
      { speaker: 'Utah Pros', line: 'Hello.' },
    ]);
  });

  it('tolerates inconsistent spacing/casing around "Speaker N:"', () => {
    const text = 'speaker 1:Hi there. SPEAKER   2 :   Hi back.';
    expect(parseTranscript(text)).toEqual([
      { speaker: 'Utah Pros', line: 'Hi there.' },
      { speaker: 'Customer', line: 'Hi back.' },
    ]);
  });

  it('keeps a neutral "Speaker N" label for a third+ distinct speaker (no reliable default)', () => {
    const text = 'Speaker 1: Hi. Speaker 2: Hello. Speaker 3: I am also on this call.';
    expect(parseTranscript(text)).toEqual([
      { speaker: 'Utah Pros', line: 'Hi.' },
      { speaker: 'Customer', line: 'Hello.' },
      { speaker: 'Speaker 3', line: 'I am also on this call.' },
    ]);
  });
});
