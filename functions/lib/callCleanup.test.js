/**
 * ════════════════════════════════════════════════
 * FILE: callCleanup.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pure pieces of the transcript clean-up + summarize step: how we
 *   format the (already speaker-labeled) transcript for the AI, how we safely
 *   read the AI's JSON answer back — including refusing a turn-count mismatch
 *   rather than misattributing cleaned text — and how we apply that answer to
 *   the transcript, where the AI returns junk must degrade to leaving the
 *   transcript unchanged rather than corrupting it.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./callCleanup.js
 *
 * NOTES / GOTCHAS:
 *   - Written test-first. The Claude API call itself is impure (in the worker);
 *     everything testable is factored into these pure functions.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { buildCleanupPrompt, parseCleanupResponse, applyCleanup } from './callCleanup.js';

describe('buildCleanupPrompt', () => {
  it('formats turns as a numbered "<n>. <speaker>: <text>" list', () => {
    const turns = [
      { speaker: 'Agent', text: 'Thank you for calling the Pros.' },
      { speaker: 'Customer', text: 'Hi, I have a mold question.' },
    ];
    expect(buildCleanupPrompt(turns)).toBe(
      '1. Agent: Thank you for calling the Pros.\n2. Customer: Hi, I have a mold question.'
    );
  });

  it('skips empty turns and returns "" for no usable turns', () => {
    expect(buildCleanupPrompt([{ speaker: 'Agent', text: '   ' }])).toBe('');
    expect(buildCleanupPrompt([])).toBe('');
    expect(buildCleanupPrompt(null)).toBe('');
  });

  it('falls back to a generic "Speaker" label when a turn has none', () => {
    expect(buildCleanupPrompt([{ text: 'Hello.' }])).toBe('1. Speaker: Hello.');
  });
});

describe('parseCleanupResponse', () => {
  const good = '{"turns":["Thank you for calling Utah Pros.","Hi, I have a flood in my basement."],"summary":"Caller reports a basement flood; agent scheduled an inspection for tomorrow."}';

  it('parses a clean JSON object when the turn count matches', () => {
    expect(parseCleanupResponse(good, 2)).toEqual({
      turns: ['Thank you for calling Utah Pros.', 'Hi, I have a flood in my basement.'],
      summary: 'Caller reports a basement flood; agent scheduled an inspection for tomorrow.',
    });
  });

  it('extracts JSON out of markdown fences or surrounding prose', () => {
    const fenced = '```json\n' + good + '\n```';
    expect(parseCleanupResponse(fenced, 2)?.summary).toContain('basement flood');
    const chatty = 'Sure! Here is the result:\n' + good + '\nHope that helps.';
    expect(parseCleanupResponse(chatty, 2)?.turns[0]).toBe('Thank you for calling Utah Pros.');
  });

  it('returns null when the turn count does not exactly match expectedCount', () => {
    expect(parseCleanupResponse(good, 3)).toBeNull();
    expect(parseCleanupResponse(good, 1)).toBeNull();
  });

  it('skips the count check when expectedCount is not a number', () => {
    expect(parseCleanupResponse(good)?.turns).toHaveLength(2);
  });

  it('treats a missing/blank summary as null but still returns the cleaned turns', () => {
    const noSummary = '{"turns":["Hi there."]}';
    expect(parseCleanupResponse(noSummary, 1)).toEqual({ turns: ['Hi there.'], summary: null });
  });

  it('returns null on garbage / no JSON / missing or empty turns', () => {
    expect(parseCleanupResponse('nope')).toBeNull();
    expect(parseCleanupResponse('')).toBeNull();
    expect(parseCleanupResponse(null)).toBeNull();
    expect(parseCleanupResponse('{"summary":"x"}')).toBeNull();
    expect(parseCleanupResponse('{"turns":[]}')).toBeNull();
  });
});

describe('applyCleanup', () => {
  const analysis = {
    model: 'nova-3',
    speakerMode: 'diarize',
    turns: [
      { speaker: 'Agent', role: 'agent', text: 'Thank you for calling the Pros.' },
      { speaker: 'Customer', role: 'customer', text: 'Hi, mold question, um, in my, uh, basement.' },
    ],
    summary: 'A roofing contractor introduces himself.',
    topics: ['mold'],
  };
  const cleaned = {
    turns: ['Thank you for calling the Pros.', 'Hi, I have a mold question in my basement.'],
    summary: 'Caller has a mold issue in their basement and wants an inspection.',
  };

  it('replaces each turn\'s text, keeps the original as rawText, and swaps in the new summary', () => {
    const out = applyCleanup(analysis, cleaned);
    expect(out.turns).toEqual([
      { speaker: 'Agent', role: 'agent', text: 'Thank you for calling the Pros.', rawText: 'Thank you for calling the Pros.' },
      {
        speaker: 'Customer',
        role: 'customer',
        text: 'Hi, I have a mold question in my basement.',
        rawText: 'Hi, mold question, um, in my, uh, basement.',
      },
    ]);
    expect(out.summary).toBe('Caller has a mold issue in their basement and wants an inspection.');
    expect(out.topics).toEqual(['mold']);
    // original not mutated
    expect(analysis.turns[1].text).toBe('Hi, mold question, um, in my, uh, basement.');
    expect(analysis.summary).toBe('A roofing contractor introduces himself.');
  });

  it('falls back to the original Deepgram summary when the cleaned summary is null', () => {
    const out = applyCleanup(analysis, { turns: cleaned.turns, summary: null });
    expect(out.summary).toBe('A roofing contractor introduces himself.');
  });

  it('leaves a turn unchanged (no rawText) when cleaned has no counterpart for it', () => {
    const out = applyCleanup(analysis, { turns: ['Thank you for calling the Pros.'], summary: 'x' });
    expect(out.turns[0].text).toBe('Thank you for calling the Pros.');
    expect(out.turns[1]).toEqual(analysis.turns[1]);
  });

  it('returns the analysis unchanged when cleaned is null/invalid', () => {
    expect(applyCleanup(analysis, null)).toBe(analysis);
    expect(applyCleanup(null, cleaned)).toBeNull();
    expect(applyCleanup({ turns: null }, cleaned)).toEqual({ turns: null });
  });
});
