/**
 * ════════════════════════════════════════════════
 * FILE: attribution.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM attribution money-math is right before a single number
 *   ever reaches the screen. A wrong figure here misallocates real ad budget,
 *   so every case — cost-per-lead, ROAS, cost-per-job, the spend→lead→job→
 *   revenue rollup, funnel conversion rates, and the "show — not 0 for a
 *   zero-spend source" rule — is checked against a hand calculation.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./attribution.js (the pure functions under test)
 *
 * NOTES / GOTCHAS:
 *   - Test-first per docs/crm-roadmap.md Phase 3: this file was committed
 *     failing before attribution.js existed. Do not edit a test to make it
 *     green — fix the code.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  costPerLead,
  roas,
  costPerJob,
  conversionRate,
  isPaidChannel,
  deriveChannelMetrics,
  rollupTotals,
  funnelStages,
  fmtMoney,
  fmtRatio,
  fmtPct,
} from './attribution.js';

describe('costPerLead — spend / leads', () => {
  it('divides normally', () => {
    expect(costPerLead(500, 20)).toBe(25);
  });
  it('is null for a zero-spend source (— not 0)', () => {
    expect(costPerLead(0, 20)).toBeNull();
  });
  it('guards divide-by-zero when there are no leads', () => {
    expect(costPerLead(500, 0)).toBeNull();
  });
  it('is null when both are zero', () => {
    expect(costPerLead(0, 0)).toBeNull();
  });
  it('treats negative/garbage spend as null, never a negative cost', () => {
    expect(costPerLead(-5, 10)).toBeNull();
  });
});

describe('roas — revenue / spend', () => {
  it('divides normally', () => {
    expect(roas(2000, 500)).toBe(4);
  });
  it('is a real 0.0 (wasted spend), NOT null, when revenue is 0 but spend > 0', () => {
    expect(roas(0, 500)).toBe(0);
  });
  it('is null only when spend is 0 (zero-spend source → —)', () => {
    expect(roas(2000, 0)).toBeNull();
  });
});

describe('costPerJob — spend / booked jobs', () => {
  it('divides normally', () => {
    expect(costPerJob(1000, 5)).toBe(200);
  });
  it('is null for a zero-spend source', () => {
    expect(costPerJob(0, 5)).toBeNull();
  });
  it('guards divide-by-zero when no jobs booked', () => {
    expect(costPerJob(1000, 0)).toBeNull();
  });
});

describe('conversionRate — numerator / denominator', () => {
  it('divides normally', () => {
    expect(conversionRate(5, 20)).toBe(0.25);
  });
  it('is a legitimate 0 (0%) when numerator is 0 over a positive denominator', () => {
    expect(conversionRate(0, 20)).toBe(0);
  });
  it('guards divide-by-zero (null) when denominator is 0', () => {
    expect(conversionRate(5, 0)).toBeNull();
  });
});

describe('isPaidChannel', () => {
  it('paid channels are google_ads and meta_ads', () => {
    expect(isPaidChannel('google_ads')).toBe(true);
    expect(isPaidChannel('meta_ads')).toBe(true);
  });
  it('zero-spend channels are not paid', () => {
    expect(isPaidChannel('organic')).toBe(false);
    expect(isPaidChannel('referral')).toBe(false);
    expect(isPaidChannel('insurance')).toBe(false);
    expect(isPaidChannel('other')).toBe(false);
  });
});

describe('deriveChannelMetrics — a paid channel row', () => {
  const row = { channel: 'google_ads', spend: 1000, leads: 40, estimates: 10, won_jobs: 5, revenue: 60000 };
  const d = deriveChannelMetrics(row);
  it('cost_per_lead = 1000/40 = 25', () => expect(d.cost_per_lead).toBe(25));
  it('roas = 60000/1000 = 60', () => expect(d.roas).toBe(60));
  it('cost_per_job = 1000/5 = 200', () => expect(d.cost_per_job).toBe(200));
  it('lead→estimate rate = 10/40 = 0.25', () => expect(d.lead_to_estimate_rate).toBe(0.25));
  it('estimate→won rate = 5/10 = 0.5', () => expect(d.estimate_to_won_rate).toBe(0.5));
  it('lead→won rate = 5/40 = 0.125', () => expect(d.lead_to_won_rate).toBe(0.125));
  it('preserves the raw fields', () => {
    expect(d.channel).toBe('google_ads');
    expect(d.spend).toBe(1000);
    expect(d.revenue).toBe(60000);
  });
});

describe('deriveChannelMetrics — a zero-spend channel row (Referral/Organic/Insurance)', () => {
  const row = { channel: 'referral', spend: 0, leads: 12, estimates: 6, won_jobs: 4, revenue: 80000 };
  const d = deriveChannelMetrics(row);
  it('cost_per_lead is null → renders — not 0', () => expect(d.cost_per_lead).toBeNull());
  it('roas is null → renders — not 0', () => expect(d.roas).toBeNull());
  it('cost_per_job is null → renders — not 0', () => expect(d.cost_per_job).toBeNull());
  it('but conversion rates are still real numbers', () => {
    expect(d.lead_to_estimate_rate).toBe(0.5);
    expect(d.estimate_to_won_rate).toBeCloseTo(0.6667, 4);
    expect(d.lead_to_won_rate).toBeCloseTo(0.3333, 4);
  });
});

describe('rollupTotals — spend → lead → job → revenue across channels', () => {
  const rows = [
    { channel: 'google_ads', spend: 1000, leads: 40, estimates: 10, won_jobs: 5, revenue: 60000 },
    { channel: 'meta_ads',   spend: 500,  leads: 20, estimates: 4,  won_jobs: 2, revenue: 25000 },
    { channel: 'referral',   spend: 0,    leads: 12, estimates: 6,  won_jobs: 4, revenue: 80000 },
    { channel: 'insurance',  spend: 0,    leads: 8,  estimates: 3,  won_jobs: 3, revenue: 45000 },
  ];
  const t = rollupTotals(rows);

  it('sums counts across ALL channels', () => {
    expect(t.spend).toBe(1500);
    expect(t.leads).toBe(80);
    expect(t.estimates).toBe(23);
    expect(t.won_jobs).toBe(14);
    expect(t.revenue).toBe(210000);
  });
  it('tracks paid-only subtotals separately', () => {
    expect(t.paid_spend).toBe(1500);
    expect(t.paid_leads).toBe(60);
    expect(t.paid_won_jobs).toBe(7);
    expect(t.paid_revenue).toBe(85000);
  });
  it('blended efficiency metrics use PAID-only figures (ads never credited with organic revenue)', () => {
    // paid_spend/paid_leads = 1500/60 = 25
    expect(t.cost_per_lead).toBe(25);
    // paid_revenue/paid_spend = 85000/1500 ≈ 56.667  (NOT 210000/1500=140)
    expect(t.roas).toBeCloseTo(56.6667, 4);
    // paid_spend/paid_won_jobs = 1500/7 ≈ 214.286
    expect(t.cost_per_job).toBeCloseTo(214.2857, 4);
  });
  it('funnel rates are computed over ALL channels', () => {
    expect(t.lead_to_estimate_rate).toBe(23 / 80);
    expect(t.estimate_to_won_rate).toBe(14 / 23);
    expect(t.lead_to_won_rate).toBe(14 / 80);
  });
  it('handles an all-zero-spend set without dividing by zero', () => {
    const z = rollupTotals([
      { channel: 'referral', spend: 0, leads: 5, estimates: 2, won_jobs: 1, revenue: 10000 },
    ]);
    expect(z.roas).toBeNull();
    expect(z.cost_per_lead).toBeNull();
    expect(z.cost_per_job).toBeNull();
    expect(z.lead_to_won_rate).toBe(1 / 5);
  });
  it('handles an empty set', () => {
    const e = rollupTotals([]);
    expect(e.spend).toBe(0);
    expect(e.leads).toBe(0);
    expect(e.revenue).toBe(0);
    expect(e.roas).toBeNull();
    expect(e.lead_to_won_rate).toBeNull();
  });
});

describe('funnelStages — Overview funnel with step conversion', () => {
  const stages = funnelStages({ leads: 100, estimates: 40, won_jobs: 12 });
  it('returns leads → estimates → won in order', () => {
    expect(stages.map(s => s.key)).toEqual(['leads', 'estimates', 'won']);
    expect(stages.map(s => s.count)).toEqual([100, 40, 12]);
  });
  it('top of funnel has no prior stage', () => {
    expect(stages[0].rate_from_prev).toBeNull();
    expect(stages[0].rate_from_top).toBe(1);
  });
  it('each stage carries its step-over-previous and share-of-top rate', () => {
    expect(stages[1].rate_from_prev).toBe(0.4);   // 40/100
    expect(stages[1].rate_from_top).toBe(0.4);
    expect(stages[2].rate_from_prev).toBe(0.3);   // 12/40
    expect(stages[2].rate_from_top).toBe(0.12);   // 12/100
  });
  it('guards an empty funnel (0 leads) without NaN', () => {
    const empty = funnelStages({ leads: 0, estimates: 0, won_jobs: 0 });
    expect(empty[1].rate_from_prev).toBeNull();
    expect(empty[2].rate_from_top).toBeNull();
  });
});

describe('display formatters distinguish "no data" (—) from a real zero', () => {
  it('fmtMoney: null → —, real 0 → $0', () => {
    expect(fmtMoney(null)).toBe('—');
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(1234.5)).toBe('$1,235');
  });
  it('fmtRatio (ROAS): null → —, real 0 → 0.0×', () => {
    expect(fmtRatio(null)).toBe('—');
    expect(fmtRatio(0)).toBe('0.0×');
    expect(fmtRatio(4)).toBe('4.0×');
  });
  it('fmtPct: null → —, real 0 → 0%', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(0.25)).toBe('25%');
  });
});
