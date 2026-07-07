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
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// LeadRow imports @/lib/realtime for the recording-proxy auth header; that module
// spins up a Supabase client at import time (needs env vars we don't set in tests).
// getAuthHeader is only called on a click, never at render, so a stub is enough.
vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));

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
    const out = renderToStaticMarkup(<LeadRow lead={lead} onStatusChange={() => {}} />);
    expect(out).toContain('Jane Homeowner');
    expect(out).toContain('Play recording');
    expect(out).toContain('$1,500');       // formatted value badge
    expect(out).toContain('Status');       // status control present
    expect(out).not.toContain('Spam');     // not flagged
  });

  it('shows a Spam badge for a spam-flagged lead', () => {
    const lead = { id: 'lead-2', source_type: 'form', lead_status: 'spam', spam_flag: true };
    const out = renderToStaticMarkup(<LeadRow lead={lead} onStatusChange={() => {}} />);
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

describe('Lead Center — filterLeads (status + spam + search)', () => {
  const leads = [
    { id: 'a', lead_status: 'new', contact: { name: 'Alice' }, caller_number: '111' },
    { id: 'b', lead_status: 'booked', caller_number: '222' },
    { id: 'c', lead_status: 'spam', spam_flag: true, caller_number: '333' },
    { id: 'd', lead_status: 'new', spam_flag: true, caller_number: '444' }, // spam via flag
  ];

  it('excludes spam from the "all" view', () => {
    const ids = filterLeads(leads, { status: 'all' }).map((l) => l.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('surfaces only spam (status or flag) in the "spam" view', () => {
    const ids = filterLeads(leads, { status: 'spam' }).map((l) => l.id);
    expect(ids.sort()).toEqual(['c', 'd']);
  });

  it('matches an exact status', () => {
    expect(filterLeads(leads, { status: 'booked' }).map((l) => l.id)).toEqual(['b']);
  });

  it('searches name and number within the active status', () => {
    expect(filterLeads(leads, { status: 'all', search: 'ali' }).map((l) => l.id)).toEqual(['a']);
    expect(filterLeads(leads, { status: 'all', search: '222' }).map((l) => l.id)).toEqual(['b']);
  });
});
