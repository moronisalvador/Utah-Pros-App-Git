/**
 * ════════════════════════════════════════════════
 * FILE: leads.render.test.jsx  (Admin Mobile — Lead Center smoke tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves two things draw correctly without a browser: a lead card shows the
 *   caller, the play button, and its spam/value flags; and the transcript view
 *   turns a stored analysis fixture into a readable summary + speaker turns (and
 *   falls back to plain text when there's no analysis). Also checks the pure
 *   status/spam filter so the tabs sort leads the way the screen expects.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom (renderToStaticMarkup — no jsdom needed)
 *   Internal:  ./LeadRow, ./TranscriptView, ./leadFormat
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import LeadRow from './LeadRow';
import TranscriptView from './TranscriptView';
import { filterLeads } from './leadFormat';

const ANALYSIS_FIXTURE = {
  summary: 'Homeowner has a flooded basement and wants an estimate today.',
  sentiment: { label: 'positive' },
  topics: ['water damage', 'basement', 'estimate'],
  turns: [
    { speaker: 'Caller', role: 'customer', text: 'My basement is flooded.' },
    { speaker: 'Caller', role: 'customer', text: 'Can someone come out today?' },
    { speaker: 'Agent', role: 'agent', text: 'Absolutely, we can help.' },
  ],
  entities: [{ value: 'Salt Lake City' }],
};

describe('Lead Center — lead-list render', () => {
  it('renders a call lead with caller, play button, and flags', () => {
    const lead = {
      id: 'lead-1',
      source_type: 'call',
      lead_status: 'new',
      caller_number: '+18015551234',
      contact: { name: 'Jane Homeowner' },
      duration_sec: 187,
      recording_url: 'https://example.com/rec.mp3',
      value: 1500,
      spam_flag: false,
      occurred_at: '2026-07-06T18:04:00Z',
    };
    const stages = [
      { id: 's-qual', name: 'Qualified', is_won: false, is_lost: false },
      { id: 's-won', name: 'Won', is_won: true, is_lost: false },
    ];
    const out = renderToStaticMarkup(
      <MemoryRouter><LeadRow lead={{ ...lead, stage: stages[0] }} /></MemoryRouter>,
    );
    expect(out).toContain('Jane Homeowner');
    expect(out).toContain('$1,500');       // formatted value badge
    expect(out).toContain('Qualified');    // the row shows its actual stage
    expect(out).not.toContain('Spam');     // not flagged
    // The row is a LINK to the lead's own screen, not an accordion. The
    // recording, transcript and stage mover live on AdminLeadDetail now, so a
    // play button here would be the regression.
    expect(out).toContain('href="/tech/admin/leads/lead-1"');
    expect(out).not.toContain('Play recording');
    expect(out).not.toContain('<select');
  });

  it('shows "Not staged" rather than pretending an unplaced lead is in stage one', () => {
    const out = renderToStaticMarkup(
      <MemoryRouter><LeadRow lead={{ id: 'lead-3', source_type: 'call', stage: null }} /></MemoryRouter>,
    );
    expect(out).toContain('Not staged');
  });

  it('shows a Spam badge for a spam-flagged lead', () => {
    const lead = { id: 'lead-2', source_type: 'form', lead_status: 'spam', spam_flag: true };
    const stages = [
      { id: 's-qual', name: 'Qualified', is_won: false, is_lost: false },
      { id: 's-won', name: 'Won', is_won: true, is_lost: false },
    ];
    const out = renderToStaticMarkup(
      <MemoryRouter><LeadRow lead={{ ...lead, stage: stages[0] }} /></MemoryRouter>,
    );
    expect(out).toContain('Spam');
    expect(out).toContain('Form');
  });
});

describe('Lead Center — transcript-view render from fixture', () => {
  it('renders summary, sentiment, topics, and grouped speaker turns', () => {
    const out = renderToStaticMarkup(<TranscriptView analysis={ANALYSIS_FIXTURE} text={null} />);
    expect(out).toContain('Summary');
    expect(out).toContain('flooded basement');
    expect(out).toContain('positive');           // sentiment pill
    expect(out).toContain('water damage');        // topic chip
    expect(out).toContain('Caller');              // grouped speaker label
    expect(out).toContain('Salt Lake City');      // detected entity
    // Consecutive same-speaker turns merge into ONE block (two Caller lines, one label).
    expect(out.match(/am-transcript-block/g)?.length).toBe(2);
  });

  it('falls back to flat text when there is no structured analysis', () => {
    const out = renderToStaticMarkup(<TranscriptView analysis={null} text={'line one\nline two'} />);
    expect(out).toContain('am-transcript-flat');
    expect(out).toContain('line one');
    expect(out).not.toContain('am-transcript-turns');
  });
});

describe('Lead Center — filterLeads (stage group + spam + search)', () => {
  // Stage rows as pipeline_stages returns them — grouped by FLAGS, never by name.
  const won        = { id: 's-won',  name: 'Won',          is_won: true,  is_lost: false };
  const lost       = { id: 's-lost', name: 'Lost',         is_won: false, is_lost: true, is_recoverable: false };
  const missed     = { id: 's-miss', name: 'Missed Calls', is_won: false, is_lost: true, is_recoverable: true };
  const qualified  = { id: 's-qual', name: 'Qualified',    is_won: false, is_lost: false };

  const leads = [
    { id: 'a', stage: qualified, contact: { name: 'Alice' }, caller_number: '111' },
    { id: 'b', stage: won, caller_number: '222' },
    { id: 'c', stage: lost, caller_number: '333' },
    { id: 'd', stage: missed, caller_number: '444' },
    { id: 'e', stage: null, caller_number: '555' },              // never staged
    { id: 'f', stage: qualified, spam_flag: true, caller_number: '666' },
  ];

  it('groups by stage flags, and an unstaged lead counts as working', () => {
    expect(filterLeads(leads, { group: 'working' }).map((l) => l.id)).toEqual(['a', 'd', 'e']);
    expect(filterLeads(leads, { group: 'won' }).map((l) => l.id)).toEqual(['b']);
    expect(filterLeads(leads, { group: 'lost' }).map((l) => l.id)).toEqual(['c']);
  });

  it('puts a RECOVERABLE lost stage in working, not lost', () => {
    // Missed Calls is is_lost + is_recoverable: a callback is still work to do,
    // which is exactly what that flag is for. Burying it under Lost would hide
    // the most urgent thing in the pipeline.
    expect(filterLeads(leads, { group: 'working' }).map((l) => l.id)).toContain('d');
    expect(filterLeads(leads, { group: 'lost' }).map((l) => l.id)).not.toContain('d');
  });

  it('keeps spam out of the working groups but visible under All', () => {
    expect(filterLeads(leads, { group: 'working' }).map((l) => l.id)).not.toContain('f');
    expect(filterLeads(leads, { group: 'all' }).map((l) => l.id)).toContain('f');
  });

  it('searches name and number within the active group', () => {
    expect(filterLeads(leads, { group: 'all', search: 'ali' }).map((l) => l.id)).toEqual(['a']);
    expect(filterLeads(leads, { group: 'working', search: '555' }).map((l) => l.id)).toEqual(['e']);
  });
});
