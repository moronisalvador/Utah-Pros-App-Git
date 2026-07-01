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
import { sortStages, groupLeadsByStage, stageWeight, weightedPipelineValue } from './crmPipeline.js';

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
