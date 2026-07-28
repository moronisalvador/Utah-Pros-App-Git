/**
 * ════════════════════════════════════════════════
 * FILE: crmLeads.search.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Leads board's search box finds what a person would expect it to
 *   find. Typing two words means "both must match", not "either" — so
 *   "smith water" finds the Smith lead about water damage and nothing else.
 *   A partial phone number matches no matter how it's typed: with dashes, with
 *   brackets, or as bare digits. A web-form lead is findable by what the
 *   customer typed into the form, which is often the only text it has. And the
 *   raw call transcript is deliberately NOT searched, because this page never
 *   shows a transcript — a card matching for an invisible reason would just
 *   look like a bug.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/pages/crm/CrmLeads.jsx (leadSearchTerms, leadSearchText,
 *              matchesLeadSearch — the pure matcher behind the search box)
 *
 * NOTES / GOTCHAS:
 *   - Mocks @/contexts/AuthContext for the same reason crmLeads.lostReason.test.js
 *     does: importing the page module otherwise pulls in the realtime Supabase
 *     client, which needs env vars at import time. Only the pure helpers are
 *     exercised; the page is never rendered.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: {}, employee: null }) }));

const { leadSearchTerms, leadSearchText, matchesLeadSearch } = await import('./CrmLeads.jsx');

// One helper so each test reads as "does this lead match this query".
const matches = (lead, query) => matchesLeadSearch(leadSearchText(lead), leadSearchTerms(query));

const callLead = {
  id: 'lead-call',
  source_type: 'call',
  caller_name: 'Jane Smith',
  caller_number: '+18015551234',
  source: 'Google My Business',
  campaign: 'Spring PPC',
  transcript_analysis: {
    summary: 'Caller reports a burst pipe flooding the basement.',
    topics: ['water damage', 'emergency'],
    customer_email: 'jane@example.com',
    customer_address: '742 Evergreen Ter, Provo',
  },
  transcription: 'Agent: thanks for calling. Caller: my name is Jane and there is asbestos in the attic.',
};

const formLead = {
  id: 'lead-form',
  source_type: 'form',
  caller_name: null,
  caller_number: null,
  source: 'Website',
  form_data: {
    full_name: 'Bob Jones',
    email: 'bob@contoso.com',
    services: ['Mold remediation', 'Air quality'],
    message: 'Ceiling stain in the guest bedroom',
    consent: true,
  },
};

describe('leadSearchTerms', () => {
  it('is empty for a blank or whitespace-only query, so search stays inactive', () => {
    expect(leadSearchTerms('')).toEqual([]);
    expect(leadSearchTerms('   ')).toEqual([]);
    expect(leadSearchTerms(null)).toEqual([]);
    expect(leadSearchTerms(undefined)).toEqual([]);
  });

  it('lowercases and splits on any run of whitespace', () => {
    expect(leadSearchTerms('  Jane   SMITH ').map(t => t.raw)).toEqual(['jane', 'smith']);
  });

  it('carries a digits-only twin for phone fragments, but ignores 1-2 digit noise', () => {
    expect(leadSearchTerms('(801) 555').map(t => t.digits)).toEqual(['801', '555']);
    expect(leadSearchTerms('801-555-1234')[0].digits).toBe('8015551234');
    // A lone "5" or "20" would otherwise match every dollar amount on the board.
    expect(leadSearchTerms('5')[0].digits).toBeNull();
    expect(leadSearchTerms('20')[0].digits).toBeNull();
  });
});

describe('matchesLeadSearch — every term must match (AND, not OR)', () => {
  it('matches when all terms are present, across different fields', () => {
    expect(matches(callLead, 'smith water')).toBe(true);
    expect(matches(callLead, 'jane basement')).toBe(true);
  });

  it('does NOT match when only some terms are present', () => {
    // "smith" hits, "mold" does not — an OR search would wrongly return this.
    expect(matches(callLead, 'smith mold')).toBe(false);
  });

  it('matches everything when the query is empty', () => {
    expect(matches(callLead, '')).toBe(true);
    expect(matches(formLead, '   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matches(callLead, 'JANE')).toBe(true);
    expect(matches(callLead, 'gOoGlE')).toBe(true);
  });
});

describe('phone matching — however a human types it', () => {
  it.each([
    ['bare digits', '8015551234'],
    ['dashed', '801-555-1234'],
    ['bracketed with a space', '(801) 555-1234'],
    ['a partial prefix', '801555'],
    ['a partial tail', '5551234'],
  ])('finds +18015551234 from %s', (_label, query) => {
    expect(matches(callLead, query)).toBe(true);
  });

  it('does not match an unrelated number', () => {
    expect(matches(callLead, '4079999')).toBe(false);
  });

  it('matches a linked contact phone that differs from caller_number', () => {
    const withContact = { ...callLead, contact: { name: 'Jane S.', phone: '(385) 222-0000' } };
    expect(matches(withContact, '3852220000')).toBe(true);
  });
});

describe('web-form leads — searchable by what the customer typed', () => {
  it('matches a submitted name, email and free-text message', () => {
    expect(matches(formLead, 'bob')).toBe(true);
    expect(matches(formLead, 'contoso')).toBe(true);
    expect(matches(formLead, 'guest bedroom')).toBe(true);
  });

  it('matches a value inside an array answer', () => {
    expect(matches(formLead, 'mold')).toBe(true);
    expect(matches(formLead, 'air quality')).toBe(true);
  });

  it('does not crash on a null, non-object or nested-object form_data', () => {
    expect(() => leadSearchText({ id: 'a', form_data: null })).not.toThrow();
    expect(() => leadSearchText({ id: 'b', form_data: 'not-an-object' })).not.toThrow();
    expect(() => leadSearchText({ id: 'c', form_data: { nested: { deep: 'x' } } })).not.toThrow();
    // A nested object contributes nothing rather than "[object Object]".
    expect(leadSearchText({ id: 'c', form_data: { nested: { deep: 'x' } } })).not.toContain('object');
  });
});

describe('the raw transcript is deliberately excluded', () => {
  it('does not match a word that appears ONLY in the call transcription', () => {
    // "asbestos" is in transcription but nowhere the Leads page renders, so a
    // hit would surface a card with no visible reason for matching.
    expect(callLead.transcription).toContain('asbestos');
    expect(matches(callLead, 'asbestos')).toBe(false);
  });

  it('still matches the AI summary and topics, which the card DOES show', () => {
    expect(matches(callLead, 'burst pipe')).toBe(true);
    expect(matches(callLead, 'emergency')).toBe(true);
  });
});

describe('leadSearchText — tolerates the sparse rows this table really has', () => {
  it('handles a lead with almost every column null', () => {
    const bare = { id: 'bare', source_type: 'call' };
    expect(leadSearchText(bare)).toBe('');
    expect(matchesLeadSearch(leadSearchText(bare), leadSearchTerms('anything'))).toBe(false);
    // ...but an empty query must still include it, or the board would blank out.
    expect(matchesLeadSearch(leadSearchText(bare), leadSearchTerms(''))).toBe(true);
  });

  it('includes lost_reason and the legacy notes column', () => {
    const lost = { id: 'l', lost_reason: 'Went with a competitor', notes: 'Legacy note text' };
    expect(matches(lost, 'competitor')).toBe(true);
    expect(matches(lost, 'legacy')).toBe(true);
  });

  it('drops empty strings instead of padding the haystack', () => {
    expect(leadSearchText({ id: 'e', source: '', campaign: '', caller_name: 'Ann' })).toBe('ann');
  });
});
