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

// ─── SECTION: Composition — search narrowing TOGETHER with the sibling filters ──
// The search matcher above is proven in isolation. What this covers is the wiring
// risk: that `filterLeads` ANDs search with the date range and every criteria
// group, rather than one silently replacing another. vitest runs in plain node
// here (no jsdom), so this is the closest provable equivalent to typing in the box
// with filters already set.
const { filterLeads } = await import('./CrmLeads.jsx');

const DAY = 86400000;
const iso = daysAgo => new Date(Date.now() - daysAgo * DAY).toISOString();

const noFilters = () => ({
  sources: new Set(), campaigns: new Set(), sentiments: new Set(),
  services: new Set(), stageAges: new Set(),
});

// Two leads that BOTH match the query "smith", so any test that isolates one of
// them proves the other filter actually applied on top of the search.
const smithRecentGoogle = {
  id: 'smith-recent', caller_name: 'Jane Smith', source: 'Google My Business',
  occurred_at: iso(2), transcript_analysis: { sentiment: { label: 'positive' }, topics: ['water damage'] },
};
const smithOldYelp = {
  id: 'smith-old', caller_name: 'Bob Smith', source: 'Yelp',
  occurred_at: iso(45), transcript_analysis: { sentiment: { label: 'negative' }, topics: ['mold'] },
};
const jonesRecent = {
  id: 'jones', caller_name: 'Ann Jones', source: 'Google My Business',
  occurred_at: iso(1), transcript_analysis: { sentiment: { label: 'positive' }, topics: ['water damage'] },
};
const all = [smithRecentGoogle, smithOldYelp, jonesRecent];

const ids = rows => rows.map(r => r.id).sort();
const run = opts => filterLeads(all, { filters: noFilters(), ...opts });

describe('filterLeads — search composes with the other filters', () => {
  it('returns everything when nothing is set', () => {
    expect(ids(run({}))).toEqual(['jones', 'smith-old', 'smith-recent']);
  });

  it('search alone narrows to both Smiths', () => {
    expect(ids(run({ searchTerms: leadSearchTerms('smith') }))).toEqual(['smith-old', 'smith-recent']);
  });

  it('search AND date range — the old Smith drops out, Jones stays out', () => {
    expect(ids(run({
      searchTerms: leadSearchTerms('smith'),
      dateRange: { start: Date.now() - 30 * DAY, end: null },
    }))).toEqual(['smith-recent']);
  });

  it('search AND source — the Yelp Smith drops out', () => {
    const filters = noFilters();
    filters.sources.add('Google My Business');
    expect(ids(run({ searchTerms: leadSearchTerms('smith'), filters }))).toEqual(['smith-recent']);
  });

  it('search AND sentiment', () => {
    const filters = noFilters();
    filters.sentiments.add('negative');
    expect(ids(run({ searchTerms: leadSearchTerms('smith'), filters }))).toEqual(['smith-old']);
  });

  it('search AND service category', () => {
    const filters = noFilters();
    filters.services.add('mold');
    expect(ids(run({ searchTerms: leadSearchTerms('smith'), filters }))).toEqual(['smith-old']);
  });

  it('a filter that excludes every search hit yields nothing — drives the empty state', () => {
    const filters = noFilters();
    filters.sources.add('Facebook');
    expect(run({ searchTerms: leadSearchTerms('smith'), filters })).toEqual([]);
  });

  it('search does not override the criteria filters (the wiring bug this guards)', () => {
    // "jones" matches only Jones, but the source filter allows only Yelp.
    // If search replaced the filters instead of ANDing, Jones would leak through.
    const filters = noFilters();
    filters.sources.add('Yelp');
    expect(run({ searchTerms: leadSearchTerms('jones'), filters })).toEqual([]);
  });

  it('an empty query leaves the other filters fully in charge', () => {
    const filters = noFilters();
    filters.sources.add('Yelp');
    expect(ids(run({ searchTerms: leadSearchTerms(''), filters }))).toEqual(['smith-old']);
  });

  it('falls back to computing the haystack when no prebuilt index is supplied', () => {
    // The component always passes searchIndex; this pins the documented fallback
    // so a future caller without one still filters instead of silently matching all.
    expect(ids(run({ searchTerms: leadSearchTerms('jones'), searchIndex: undefined }))).toEqual(['jones']);
  });

  it('uses the prebuilt index when one IS supplied', () => {
    const searchIndex = new Map(all.map(l => [l.id, leadSearchText(l)]));
    expect(ids(run({ searchTerms: leadSearchTerms('yelp'), searchIndex }))).toEqual(['smith-old']);
  });

  it('a lead with no occurred_at is excluded by a date range but not by search', () => {
    const undated = { id: 'undated', caller_name: 'Sam Smith' };
    expect(ids(filterLeads([undated], { filters: noFilters(), searchTerms: leadSearchTerms('smith') }))).toEqual(['undated']);
    expect(filterLeads([undated], {
      filters: noFilters(), searchTerms: leadSearchTerms('smith'),
      dateRange: { start: Date.now() - 30 * DAY, end: null },
    })).toEqual([]);
  });
});
