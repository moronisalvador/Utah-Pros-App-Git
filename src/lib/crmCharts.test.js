/**
 * ════════════════════════════════════════════════
 * FILE: crmCharts.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Unit tests for the pure chart-math helpers in crmCharts.js — the functions
 *   that turn raw database rows into the shapes the CRM Overview donut/bar
 *   charts and KPI strip need. Because a wrong number here would mislead a real
 *   business decision, every helper is checked against empty, all-zero, and
 *   boundary inputs so it can never render a NaN, an Infinity, or a rate above
 *   100%.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./crmCharts (the module under test)
 *   Data:      none — pure functions, fixed fixtures.
 *
 * NOTES / GOTCHAS:
 *   - pipelineOutcome tests encode the data-honesty rule that drove this
 *     feature: a win rate never exceeds 100% (won ÷ decided), because won/lost
 *     both come from the CRM pipeline — a nested population.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  CHART_PALETTE,
  CHANNEL_COLOR,
  CHANNEL_LABELS,
  DIVISION_LABELS,
  paletteColor,
  toDonutSegments,
  callVolumeSplit,
  agingOverThreshold,
  isCountableLead,
  leadsByCampaign,
  leadsByChannel,
  newLeadsSince,
  pipelineOutcome,
  callScreeningCoverage,
} from './crmCharts.js';

describe('constant maps', () => {
  it('exposes a non-empty categorical palette of CSS vars', () => {
    expect(Array.isArray(CHART_PALETTE)).toBe(true);
    expect(CHART_PALETTE.length).toBeGreaterThanOrEqual(6);
    for (const c of CHART_PALETTE) expect(c).toMatch(/^var\(--crm-/);
  });

  it('maps all six channels to a color and a label', () => {
    const channels = ['google_ads', 'meta_ads', 'organic', 'referral', 'insurance', 'other'];
    for (const ch of channels) {
      expect(CHANNEL_COLOR[ch]).toMatch(/^var\(--crm-/);
      expect(typeof CHANNEL_LABELS[ch]).toBe('string');
    }
    expect(CHANNEL_LABELS.other).toBe('Other / Direct');
  });

  it('labels the service divisions', () => {
    expect(DIVISION_LABELS.water).toBe('Water');
    expect(DIVISION_LABELS.reconstruction).toBe('Reconstruction');
    expect(DIVISION_LABELS.general).toBe('General');
  });
});

describe('paletteColor', () => {
  it('cycles through the palette by index', () => {
    expect(paletteColor(0)).toBe(CHART_PALETTE[0]);
    expect(paletteColor(CHART_PALETTE.length)).toBe(CHART_PALETTE[0]);
    expect(paletteColor(CHART_PALETTE.length + 1)).toBe(CHART_PALETTE[1]);
  });

  it('coerces bad indices to 0', () => {
    expect(paletteColor(undefined)).toBe(CHART_PALETTE[0]);
    expect(paletteColor(-3)).toBe(CHART_PALETTE[0]);
  });
});

describe('toDonutSegments', () => {
  it('returns [] for empty input', () => {
    expect(toDonutSegments([])).toEqual([]);
    expect(toDonutSegments(undefined)).toEqual([]);
  });

  it('returns [] for all-zero / negative input (never NaN/Infinity)', () => {
    expect(toDonutSegments([{ label: 'a', value: 0 }, { label: 'b', value: -5 }])).toEqual([]);
  });

  it('drops non-positive items and tiles remaining 0 → 100', () => {
    const segs = toDonutSegments([
      { label: 'a', value: 3 },
      { label: 'zero', value: 0 },
      { label: 'b', value: 1 },
    ]);
    expect(segs.map((s) => s.label)).toEqual(['a', 'b']);
    expect(segs[0].from).toBe(0);
    expect(segs[segs.length - 1].to).toBe(100);
  });

  it('computes cumulative from/to correctly', () => {
    const segs = toDonutSegments([
      { label: 'a', value: 1 },
      { label: 'b', value: 1 },
      { label: 'c', value: 2 },
    ]);
    expect(segs[0].from).toBe(0);
    expect(segs[0].to).toBe(25);
    expect(segs[1].from).toBe(25);
    expect(segs[1].to).toBe(50);
    expect(segs[2].from).toBe(50);
    expect(segs[2].to).toBe(100);
    expect(segs[2].pct).toBe(50);
  });

  it('assigns palette color when missing and keeps provided color', () => {
    const segs = toDonutSegments([
      { label: 'a', value: 1, color: 'var(--crm-success)' },
      { label: 'b', value: 1 },
    ]);
    expect(segs[0].color).toBe('var(--crm-success)');
    expect(segs[1].color).toBe(paletteColor(1));
  });

  it('coerces string values to numbers', () => {
    const segs = toDonutSegments([{ label: 'a', value: '4' }, { label: 'b', value: '4' }]);
    expect(segs[0].pct).toBe(50);
  });
});

describe('callVolumeSplit', () => {
  it('sums rows and computes answer_rate', () => {
    const out = callVolumeSplit([
      { total: 10, answered: 7, missed: 3 },
      { total: '10', answered: '3', missed: '7' },
    ]);
    expect(out.total).toBe(20);
    expect(out.answered).toBe(10);
    expect(out.missed).toBe(10);
    expect(out.answer_rate).toBeCloseTo(0.5);
  });

  it('returns null answer_rate when total is 0 (never NaN)', () => {
    const out = callVolumeSplit([]);
    expect(out.total).toBe(0);
    expect(out.answer_rate).toBeNull();
    expect(Number.isNaN(out.answer_rate)).toBe(false);
  });
});

describe('agingOverThreshold', () => {
  const rows = [
    { bucket: '0–14 days', sort_order: 1, count: 5, total_amount: 500 },
    { bucket: '15–30 days', sort_order: 2, count: 3, total_amount: 300 },
    { bucket: '31–60 days', sort_order: 3, count: 2, total_amount: 200 },
    { bucket: '60+ days', sort_order: 4, count: 1, total_amount: 100 },
  ];

  it('includes buckets starting at >= days (31 included, 30 excluded, 60+ included)', () => {
    const out = agingOverThreshold(rows, 31);
    expect(out.count).toBe(3); // 31–60 (2) + 60+ (1)
    expect(out.total_amount).toBe(300);
  });

  it('boundary: 30 excludes the 15–30 bucket', () => {
    // a bucket labelled 15–30 starts at 15, so days=31 never includes it
    const out = agingOverThreshold(rows, 31);
    expect(out.count).not.toBe(5);
  });

  it('handles empty input', () => {
    expect(agingOverThreshold([], 31)).toEqual({ count: 0, total_amount: 0 });
  });
});

describe('isCountableLead', () => {
  it('a form lead is always countable regardless of answered/duration', () => {
    expect(isCountableLead({ source_type: 'form' })).toBe(true);
    expect(isCountableLead({ source_type: 'form', answered: 'false', duration_sec: 0 })).toBe(true);
  });

  it('a call with answered:"true" is countable', () => {
    expect(isCountableLead({ source_type: 'call', answered: 'true', duration_sec: 5 })).toBe(true);
  });

  it('a call with answered:"false" is NOT countable, even with real duration', () => {
    expect(isCountableLead({ source_type: 'call', answered: 'false', duration_sec: 19 })).toBe(false);
  });

  it('falls back to duration_sec > 0 when the answered field is absent (legacy rows)', () => {
    expect(isCountableLead({ source_type: 'call', answered: null, duration_sec: 45 })).toBe(true);
    expect(isCountableLead({ source_type: 'call', answered: null, duration_sec: 0 })).toBe(false);
    expect(isCountableLead({ source_type: 'call', answered: undefined, duration_sec: null })).toBe(false);
  });

  it('reads raw_payload.answered (CallRail form-encoded string) when the top-level field is missing', () => {
    // select=*-shaped rows (Leads board, get_inbound_leads) carry only raw_payload.
    expect(isCountableLead({ source_type: 'call', raw_payload: { answered: 'true' }, duration_sec: 0 })).toBe(true);
    expect(isCountableLead({ source_type: 'call', raw_payload: { answered: 'false' }, duration_sec: 30 })).toBe(false);
  });

  it('a top-level answered field wins over raw_payload.answered when both exist', () => {
    expect(isCountableLead({ source_type: 'call', answered: 'true', raw_payload: { answered: 'false' } })).toBe(true);
    expect(isCountableLead({ source_type: 'call', answered: 'false', raw_payload: { answered: 'true' } })).toBe(false);
  });

  it('raw_payload without an answered key still falls back to duration_sec > 0', () => {
    expect(isCountableLead({ source_type: 'call', raw_payload: {}, duration_sec: 12 })).toBe(true);
    expect(isCountableLead({ source_type: 'call', raw_payload: {}, duration_sec: 0 })).toBe(false);
  });
});

describe('leadsByCampaign', () => {
  it('groups, sorts desc, keeps top N and folds Other', () => {
    const leads = [
      ...Array(5).fill({ campaign: 'Spring' }),
      ...Array(4).fill({ campaign: 'Summer' }),
      ...Array(3).fill({ campaign: 'Fall' }),
      ...Array(2).fill({ campaign: 'Winter' }),
      { campaign: 'A' },
      { campaign: 'B' },
      { campaign: 'C' },
    ];
    const out = leadsByCampaign(leads, 3);
    expect(out.slice(0, 3).map((o) => o.label)).toEqual(['Spring', 'Summer', 'Fall']);
    const other = out.find((o) => o.label === 'Other');
    expect(other.count).toBe(2 + 1 + 1 + 1); // Winter + A + B + C
  });

  it('does not add Other when there is no remainder', () => {
    const out = leadsByCampaign([{ campaign: 'X' }, { campaign: 'X' }], 6);
    expect(out.find((o) => o.label === 'Other')).toBeUndefined();
  });

  it('null/empty/whitespace campaign → Direct / none', () => {
    const out = leadsByCampaign([{ campaign: null }, { campaign: '' }, { campaign: '  ' }]);
    expect(out).toEqual([{ label: 'Direct / none', count: 3 }]);
  });

  it('handles empty input', () => {
    expect(leadsByCampaign([])).toEqual([]);
  });
});

describe('leadsByChannel', () => {
  it('filters count>0 and sorts desc', () => {
    const rows = [
      { channel: 'organic', leads: 2 },
      { channel: 'google_ads', leads: 5 },
      { channel: 'referral', leads: 0 },
      { channel: 'meta_ads', leads: '3' },
    ];
    const out = leadsByChannel(rows);
    expect(out).toEqual([
      { channel: 'google_ads', count: 5 },
      { channel: 'meta_ads', count: 3 },
      { channel: 'organic', count: 2 },
    ]);
  });

  it('handles empty input', () => {
    expect(leadsByChannel([])).toEqual([]);
  });
});

describe('newLeadsSince', () => {
  const since = '2026-07-01T00:00:00Z';

  it('counts leads at/after the boundary using occurred_at then created_at', () => {
    const leads = [
      { occurred_at: '2026-07-01T00:00:00Z' }, // == boundary → counts
      { occurred_at: '2026-06-30T23:59:59Z' }, // before → no
      { created_at: '2026-07-05T00:00:00Z' }, // fallback → counts
      { occurred_at: 'not-a-date' }, // bad → no
    ];
    expect(newLeadsSince(leads, since)).toBe(2);
  });

  it('returns 0 for a bad sinceISO', () => {
    expect(newLeadsSince([{ occurred_at: '2026-07-05T00:00:00Z' }], 'nonsense')).toBe(0);
  });

  it('handles empty input', () => {
    expect(newLeadsSince([], since)).toBe(0);
  });
});

describe('pipelineOutcome', () => {
  const stages = [
    { id: 'new', is_won: false, is_lost: false },
    { id: 'qualified', is_won: false, is_lost: false },
    { id: 'won', is_won: true, is_lost: false },
    { id: 'lost', is_won: false, is_lost: true },
  ];

  it('splits won / lost / open and computes a bounded win rate', () => {
    const grouped = {
      new: [{}, {}, {}], // 3 open
      qualified: [{}, {}], // 2 open
      won: [{}, {}, {}, {}], // 4 won
      lost: [{}, {}, {}, {}, {}, {}], // 6 lost
    };
    const o = pipelineOutcome(stages, grouped);
    expect(o.won).toBe(4);
    expect(o.lost).toBe(6);
    expect(o.open).toBe(5);
    expect(o.decided).toBe(10);
    expect(o.total).toBe(15);
    expect(o.win_rate).toBeCloseTo(0.4, 10); // 4 / (4+6) — never exceeds 1
  });

  it('win_rate is null when nothing is decided (guards 0/0)', () => {
    const grouped = { new: [{}, {}] };
    const o = pipelineOutcome(stages, grouped);
    expect(o.open).toBe(2);
    expect(o.decided).toBe(0);
    expect(o.win_rate).toBeNull();
  });

  it('a lost-before-estimate lead still counts in the denominator', () => {
    // one won, one lost (that never reached an estimate) → 50%, not >100%
    const grouped = { won: [{}], lost: [{}] };
    const o = pipelineOutcome(stages, grouped);
    expect(o.win_rate).toBeCloseTo(0.5, 10);
    expect(o.win_rate).toBeLessThanOrEqual(1);
  });

  it('handles empty / missing input', () => {
    expect(pipelineOutcome([], {}).win_rate).toBeNull();
    expect(pipelineOutcome(undefined, undefined).total).toBe(0);
  });
});

describe('callScreeningCoverage', () => {
  it('counts a call-lead as screened only when transcript_analysis carries the is_customer_inquiry key', () => {
    const leads = [
      { source_type: 'call', transcript_analysis: { is_customer_inquiry: true } }, // screened
      { source_type: 'call', transcript_analysis: { is_customer_inquiry: false } }, // screened (still counts as screened even though it's a spam verdict)
      { source_type: 'call', transcript_analysis: { sentiment: { label: 'positive' } } }, // no key → unscreened
      { source_type: 'call', transcript_analysis: null }, // never transcribed → unscreened
      { source_type: 'call' }, // no transcript_analysis at all → unscreened
      { source_type: 'form', transcript_analysis: null }, // not a call → excluded entirely
    ];
    const c = callScreeningCoverage(leads);
    expect(c.call_leads).toBe(5); // the form lead is excluded from the denominator
    expect(c.screened).toBe(2);
    expect(c.unscreened).toBe(3);
    expect(c.screened_rate).toBeCloseTo(0.4, 10);
  });

  it('screened_rate is null when there are no call-leads at all (guards 0/0)', () => {
    const c = callScreeningCoverage([{ source_type: 'form' }]);
    expect(c.call_leads).toBe(0);
    expect(c.screened_rate).toBeNull();
  });

  it('a non-object transcript_analysis (e.g. a stray string) never counts as screened', () => {
    const c = callScreeningCoverage([{ source_type: 'call', transcript_analysis: 'not an object' }]);
    expect(c.screened).toBe(0);
    expect(c.unscreened).toBe(1);
  });

  it('handles empty / missing input', () => {
    expect(callScreeningCoverage([]).screened_rate).toBeNull();
    expect(callScreeningCoverage(undefined).call_leads).toBe(0);
  });
});
