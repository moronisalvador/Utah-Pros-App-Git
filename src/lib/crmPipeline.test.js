/**
 * ════════════════════════════════════════════════
 * FILE: crmPipeline.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the math behind the Leads pipeline board — that columns always
 *   show up in the order set in Settings (not creation order), that a lead
 *   with no stage yet lands in the first column, and that the "weighted
 *   pipeline value" number (how much of the open pipeline $ is realistically
 *   likely to close) adds up correctly by hand.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/crmPipeline.js
 *   Data:      none — pure functions, no DB
 *
 * NOTES / GOTCHAS:
 *   - docs/crm-roadmap.md Phase 4a close-out: "any pipeline value math ...
 *     as a pure vitest unit; stage ordering respects
 *     pipeline_stages.sort_order." This file is that test — written and
 *     committed before crmPipeline.js existed (test-first).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  sortStages,
  groupLeadsByStage,
  stageWeight,
  weightedPipelineValue,
  classifyLeadChannel,
  scoreLead,
  scoreLeadFactors,
  LEAD_SCORE_MAX,
} from './crmPipeline.js';

const STAGES_OUT_OF_ORDER = [
  { id: 'won', name: 'Won', sort_order: 4, is_won: true, is_lost: false },
  { id: 'new', name: 'New', sort_order: 0, is_won: false, is_lost: false },
  { id: 'lost', name: 'Lost', sort_order: 5, is_won: false, is_lost: true },
  { id: 'qualified', name: 'Qualified', sort_order: 2, is_won: false, is_lost: false },
  { id: 'contacted', name: 'Contacted', sort_order: 1, is_won: false, is_lost: false },
  { id: 'estimate', name: 'Estimate Sent', sort_order: 3, is_won: false, is_lost: false },
];

describe('sortStages', () => {
  it('orders stages by sort_order regardless of input/array order', () => {
    const sorted = sortStages(STAGES_OUT_OF_ORDER);
    expect(sorted.map(s => s.id)).toEqual(['new', 'contacted', 'qualified', 'estimate', 'won', 'lost']);
  });

  it('does not mutate the input array', () => {
    const copy = [...STAGES_OUT_OF_ORDER];
    sortStages(STAGES_OUT_OF_ORDER);
    expect(STAGES_OUT_OF_ORDER).toEqual(copy);
  });
});

describe('groupLeadsByStage', () => {
  const stages = STAGES_OUT_OF_ORDER;

  it('buckets a lead with no assigned stage into the first stage by sort_order', () => {
    const leads = [{ id: 'lead-1', value: 100 }];
    const grouped = groupLeadsByStage(leads, stages, {});
    expect(grouped.new.map(l => l.id)).toEqual(['lead-1']);
    expect(grouped.contacted).toEqual([]);
  });

  it('buckets a lead into its explicitly assigned stage', () => {
    const leads = [{ id: 'lead-1', value: 100 }, { id: 'lead-2', value: 200 }];
    const positions = { 'lead-1': { stage_id: 'qualified' }, 'lead-2': { stage_id: 'won' } };
    const grouped = groupLeadsByStage(leads, stages, positions);
    expect(grouped.qualified.map(l => l.id)).toEqual(['lead-1']);
    expect(grouped.won.map(l => l.id)).toEqual(['lead-2']);
    expect(grouped.new).toEqual([]);
  });
});

describe('stageWeight', () => {
  const sorted = sortStages(STAGES_OUT_OF_ORDER);

  it('weights a won stage at 1', () => {
    expect(stageWeight(sorted.find(s => s.id === 'won'), sorted)).toBe(1);
  });

  it('weights a lost stage at 0', () => {
    expect(stageWeight(sorted.find(s => s.id === 'lost'), sorted)).toBe(0);
  });

  it('weights open stages increasingly by position, strictly between 0 and 1', () => {
    const openWeights = ['new', 'contacted', 'qualified', 'estimate'].map(
      id => stageWeight(sorted.find(s => s.id === id), sorted)
    );
    for (const w of openWeights) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThan(1);
    }
    for (let i = 1; i < openWeights.length; i++) {
      expect(openWeights[i]).toBeGreaterThan(openWeights[i - 1]);
    }
  });
});

describe('weightedPipelineValue', () => {
  it('matches a hand calculation across open, won, and lost stages', () => {
    // 4 open stages -> weights 1/5, 2/5, 3/5, 4/5; won -> 1; lost -> 0.
    const stages = STAGES_OUT_OF_ORDER;
    const leads = [
      { id: 'l1', value: 1000, contact_id: 'c1' }, // new: 1000 * 1/5 = 200
      { id: 'l2', value: 2000, contact_id: 'c2' }, // qualified: 2000 * 3/5 = 1200
      { id: 'l3', value: 5000, contact_id: 'c3' }, // won: 5000 * 1 = 5000
      { id: 'l4', value: 4000, contact_id: 'c4' }, // lost: 4000 * 0 = 0
    ];
    const positions = {
      l2: { stage_id: 'qualified' },
      l3: { stage_id: 'won' },
      l4: { stage_id: 'lost' },
    };

    const { total, byStage } = weightedPipelineValue(leads, stages, positions);

    expect(byStage.new).toBeCloseTo(200, 5);
    expect(byStage.qualified).toBeCloseTo(1200, 5);
    expect(byStage.won).toBeCloseTo(5000, 5);
    expect(byStage.lost).toBeCloseTo(0, 5);
    expect(total).toBeCloseTo(200 + 1200 + 5000, 5);
  });

  it('treats a lead with a null/missing value as contributing zero', () => {
    const stages = STAGES_OUT_OF_ORDER;
    const leads = [{ id: 'l1', value: null }];
    const { total } = weightedPipelineValue(leads, stages, {});
    expect(total).toBe(0);
  });
});

// ─── Phase 9: stageWeight prefers pipeline_stages.win_probability ─────────────
describe('stageWeight — win_probability preference (Phase 9)', () => {
  const sorted = sortStages(STAGES_OUT_OF_ORDER);
  const withProb = (id, p) => ({ ...sorted.find(s => s.id === id), win_probability: p });

  it('uses an admin-set win_probability for an open stage instead of the positional ramp', () => {
    // Positional weight for "qualified" (3rd of 4 open) is 3/5 = 0.6; the
    // explicit 0.42 must win.
    expect(stageWeight(withProb('qualified', 0.42), sorted)).toBe(0.42);
  });

  it('accepts the boundary probabilities 0 and 1 on an open stage', () => {
    expect(stageWeight(withProb('new', 0), sorted)).toBe(0);
    expect(stageWeight(withProb('estimate', 1), sorted)).toBe(1);
  });

  it('falls back to the positional ramp when win_probability is null/undefined', () => {
    // Unchanged legacy behavior: contacted is 2nd of 4 open → 2/5 = 0.4.
    expect(stageWeight(sorted.find(s => s.id === 'contacted'), sorted)).toBeCloseTo(0.4, 10);
    expect(stageWeight(withProb('contacted', null), sorted)).toBeCloseTo(0.4, 10);
  });

  it('ignores an out-of-range win_probability and uses the positional fallback', () => {
    expect(stageWeight(withProb('contacted', 1.5), sorted)).toBeCloseTo(0.4, 10);
    expect(stageWeight(withProb('contacted', -0.2), sorted)).toBeCloseTo(0.4, 10);
    expect(stageWeight(withProb('contacted', 'oops'), sorted)).toBeCloseTo(0.4, 10);
  });

  it('keeps won=1 / lost=0 terminal, even if a stray win_probability is set', () => {
    expect(stageWeight(withProb('won', 0.5), sorted)).toBe(1);
    expect(stageWeight(withProb('lost', 0.5), sorted)).toBe(0);
  });
});

describe('weightedPipelineValue — honors win_probability when present', () => {
  it('matches a hand calculation using explicit stage probabilities', () => {
    const stages = [
      { id: 'new', sort_order: 0, is_won: false, is_lost: false, win_probability: 0.1 },
      { id: 'qualified', sort_order: 1, is_won: false, is_lost: false, win_probability: 0.5 },
      { id: 'won', sort_order: 2, is_won: true, is_lost: false, win_probability: null },
    ];
    const leads = [
      { id: 'l1', value: 1000 },                        // new: 1000 * 0.1 = 100
      { id: 'l2', value: 2000, contact_id: 'c2' },      // qualified: 2000 * 0.5 = 1000
      { id: 'l3', value: 5000, contact_id: 'c3' },      // won: 5000 * 1 = 5000
    ];
    const positions = { l2: { stage_id: 'qualified' }, l3: { stage_id: 'won' } };
    const { total, byStage } = weightedPipelineValue(leads, stages, positions);
    expect(byStage.new).toBeCloseTo(100, 5);
    expect(byStage.qualified).toBeCloseTo(1000, 5);
    expect(byStage.won).toBeCloseTo(5000, 5);
    expect(total).toBeCloseTo(6100, 5);
  });
});

// ─── Phase 9: rule-based lead scoring (deterministic, no ML) ──────────────────
describe('classifyLeadChannel — mirrors crm_channel_for_source buckets', () => {
  it('maps paid, organic, insurance and referral sources', () => {
    expect(classifyLeadChannel('Google Ads')).toBe('google_ads');
    expect(classifyLeadChannel('Facebook')).toBe('meta_ads');
    expect(classifyLeadChannel('Google My Business')).toBe('organic'); // organic beats the google catch
    expect(classifyLeadChannel('Insurance adjuster')).toBe('insurance');
    expect(classifyLeadChannel('Referral - neighbor')).toBe('referral');
  });
  it('falls back to other for empty/unknown sources', () => {
    expect(classifyLeadChannel('')).toBe('other');
    expect(classifyLeadChannel(null)).toBe('other');
    expect(classifyLeadChannel('billboard on I-15')).toBe('other');
  });
});

describe('scoreLead — rule math on deterministic fixtures', () => {
  it('scores a hot lead: answered Google-Ads call, instant touch, positive + urgent transcript', () => {
    const lead = {
      source: 'Google Ads', source_type: 'call', duration_sec: 150,
      first_touch_minutes: 0,
      transcript_analysis: { sentiment: { label: 'positive' }, topics: ['Water damage', 'Emergency'] },
    };
    // 15 (google) + 20 (call>=120s) + 15 (<=5min) + 15 (positive) + 15 (urgent topic) = 80
    expect(scoreLead(lead)).toBe(80);
  });

  it('scores a lukewarm web form: organic source, 45-min touch, neutral non-urgent transcript', () => {
    const lead = {
      source: 'Nextdoor', source_type: 'form', first_touch_minutes: 45,
      transcript_analysis: { sentiment: { label: 'neutral' }, topics: ['General inquiry'] },
    };
    // 10 (organic) + 10 (form) + 5 (<=120min) + 5 (neutral) + 0 (no urgent topic) = 30
    expect(scoreLead(lead)).toBe(30);
  });

  it('scores a missed referral call with no follow-up yet', () => {
    const lead = { source: 'Referral', source_type: 'call', duration_sec: 0, first_touch_minutes: null };
    // 20 (referral) + 0 (missed call) + 0 (no touch) + 0 (no transcript) + 0 = 20
    expect(scoreLead(lead)).toBe(20);
  });

  it('hard-zeros a spam lead regardless of other signals', () => {
    const lead = {
      spam_flag: true, source: 'Referral', source_type: 'call', duration_sec: 300,
      first_touch_minutes: 1, transcript_analysis: { sentiment: { label: 'positive' }, topics: ['Fire damage'] },
    };
    expect(scoreLead(lead)).toBe(0);
    expect(scoreLeadFactors(lead)).toEqual([{ factor: 'spam', points: 0, detail: { spam: true } }]);
  });

  it('treats a negative response time as no credit, never a bonus', () => {
    const base = { source: 'Google Ads', source_type: 'form' };
    expect(scoreLead({ ...base, first_touch_minutes: -30 }))
      .toBe(scoreLead({ ...base, first_touch_minutes: null }));
  });

  it('never exceeds LEAD_SCORE_MAX or drops below 0', () => {
    const maxed = {
      source: 'Referral', source_type: 'call', duration_sec: 999, first_touch_minutes: 0,
      transcript_analysis: { sentiment: { label: 'positive' }, topics: ['Sewage backup'] },
    };
    const s = scoreLead(maxed);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(LEAD_SCORE_MAX);
  });

  it('returns a labeled factor breakdown that sums to the score', () => {
    const lead = { source: 'Google Ads', source_type: 'form', first_touch_minutes: 3, transcript_analysis: null };
    const factors = scoreLeadFactors(lead);
    expect(factors.map(f => f.factor)).toEqual(['source', 'engagement', 'speed_to_first_touch', 'sentiment', 'topics']);
    const sum = factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(scoreLead(lead));
  });
});
