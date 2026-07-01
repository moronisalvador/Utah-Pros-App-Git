/**
 * ════════════════════════════════════════════════
 * FILE: speakerNaming.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pure pieces of the "name the speakers" step: how we format the
 *   transcript for the AI, how we safely read the AI's JSON answer back, and how
 *   we apply that answer to relabel each speaker turn (Agent/Customer + real
 *   names) — including when the AI returns junk, where it must degrade to leaving
 *   the transcript unchanged rather than breaking it.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./speakerNaming.js
 *
 * NOTES / GOTCHAS:
 *   - Written test-first. The Claude API call itself is impure (in the worker);
 *     everything testable is factored into these pure functions.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { buildSpeakerPrompt, parseSpeakerIdentities, applySpeakerIdentities } from './speakerNaming.js';

describe('buildSpeakerPrompt', () => {
  it('formats turns as "<speaker>: <text>" lines', () => {
    const turns = [
      { speaker: 'Speaker 1', text: 'Thank you for calling the Pros.' },
      { speaker: 'Speaker 2', text: 'Hi, I have a mold question.' },
    ];
    expect(buildSpeakerPrompt(turns)).toBe(
      'Speaker 1: Thank you for calling the Pros.\nSpeaker 2: Hi, I have a mold question.'
    );
  });

  it('skips empty turns and returns "" for no usable turns', () => {
    expect(buildSpeakerPrompt([{ speaker: 'Speaker 1', text: '   ' }])).toBe('');
    expect(buildSpeakerPrompt([])).toBe('');
    expect(buildSpeakerPrompt(null)).toBe('');
  });
});

describe('parseSpeakerIdentities', () => {
  const good = '{"speakers":{"Speaker 1":{"role":"agent","name":"Ben"},"Speaker 2":{"role":"customer","name":"Colton"}},"caller_name":"Colton"}';

  it('parses a clean JSON object', () => {
    expect(parseSpeakerIdentities(good)).toEqual({
      speakers: { 'Speaker 1': { role: 'agent', name: 'Ben' }, 'Speaker 2': { role: 'customer', name: 'Colton' } },
      caller_name: 'Colton',
    });
  });

  it('extracts JSON out of markdown fences or surrounding prose', () => {
    const fenced = '```json\n' + good + '\n```';
    expect(parseSpeakerIdentities(fenced)?.caller_name).toBe('Colton');
    const chatty = 'Sure! Here is the result:\n' + good + '\nHope that helps.';
    expect(parseSpeakerIdentities(chatty)?.speakers['Speaker 1'].name).toBe('Ben');
  });

  it('normalizes role case and nulls invalid roles / empty names', () => {
    const r = parseSpeakerIdentities('{"speakers":{"Speaker 1":{"role":"AGENT","name":"  Ben "},"Speaker 2":{"role":"unknown","name":""}},"caller_name":"  "}');
    expect(r.speakers['Speaker 1']).toEqual({ role: 'agent', name: 'Ben' });
    expect(r.speakers['Speaker 2']).toEqual({ role: null, name: null });
    expect(r.caller_name).toBeNull();
  });

  it('returns null for garbage / no JSON / missing speakers', () => {
    expect(parseSpeakerIdentities('nope')).toBeNull();
    expect(parseSpeakerIdentities('')).toBeNull();
    expect(parseSpeakerIdentities(null)).toBeNull();
    expect(parseSpeakerIdentities('{"caller_name":"x"}')).toBeNull();
  });
});

describe('applySpeakerIdentities', () => {
  const analysis = {
    model: 'nova-3',
    speakerMode: 'diarize',
    turns: [
      { speaker: 'Speaker 1', text: 'Thank you for calling the Pros.' },
      { speaker: 'Speaker 2', text: 'Hi, mold question.' },
      { speaker: 'Speaker 1', text: 'Sure, go ahead.' },
    ],
    summary: 'A mold inquiry.',
    topics: ['mold'],
  };
  const identities = {
    speakers: { 'Speaker 1': { role: 'agent', name: 'Ben' }, 'Speaker 2': { role: 'customer', name: 'Colton' } },
    caller_name: 'Colton',
  };

  it('relabels turns with names + role, preserving other analysis fields', () => {
    const out = applySpeakerIdentities(analysis, identities);
    expect(out.turns).toEqual([
      { speaker: 'Ben', role: 'agent', text: 'Thank you for calling the Pros.' },
      { speaker: 'Colton', role: 'customer', text: 'Hi, mold question.' },
      { speaker: 'Ben', role: 'agent', text: 'Sure, go ahead.' },
    ]);
    expect(out.summary).toBe('A mold inquiry.');
    expect(out.topics).toEqual(['mold']);
    // original not mutated
    expect(analysis.turns[0].speaker).toBe('Speaker 1');
  });

  it('falls back to role label when a speaker has a role but no name', () => {
    const noNames = { speakers: { 'Speaker 1': { role: 'agent', name: null }, 'Speaker 2': { role: 'customer', name: null } }, caller_name: null };
    const out = applySpeakerIdentities(analysis, noNames);
    expect(out.turns[0]).toEqual({ speaker: 'Agent', role: 'agent', text: 'Thank you for calling the Pros.' });
    expect(out.turns[1]).toEqual({ speaker: 'Customer', role: 'customer', text: 'Hi, mold question.' });
  });

  it('keeps a turn unchanged when there is no identity for its speaker', () => {
    const partial = { speakers: { 'Speaker 1': { role: 'agent', name: 'Ben' } }, caller_name: null };
    const out = applySpeakerIdentities(analysis, partial);
    expect(out.turns[1]).toEqual({ speaker: 'Speaker 2', role: null, text: 'Hi, mold question.' });
  });

  it('returns the analysis unchanged when identities is null/invalid', () => {
    expect(applySpeakerIdentities(analysis, null)).toBe(analysis);
    expect(applySpeakerIdentities(null, identities)).toBeNull();
  });
});
