/**
 * ════════════════════════════════════════════════
 * FILE: oopPricing.crossTierParity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Runs one custom price list through the browser calculator and locks its exact result.
 *   The isolated database proof reads the same fixture so the two calculators cannot drift silently.
 *
 * DEPENDS ON:
 *   Packages:  Vitest, Node.js file system
 *   Internal:  oopPricing.js, oop-pricing-cross-tier-parity.json
 *   Data:      reads  → local JSON fixture
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The SQL half saves the same configuration and inputs through upsert_oop_quote_v2.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calcPricingQuote } from './oopPricing.js';

const fixture = JSON.parse(readFileSync(new URL('../../tests/qa/fixtures/oop-pricing-cross-tier-parity.json', import.meta.url), 'utf8'));

describe('OOP browser-to-SQL parity fixture', () => {
  it('evaluates the shared custom config exactly as the canonical SQL proof expects', () => {
    const actual = calcPricingQuote(fixture);
    const expected = fixture.expected;
    expect(actual.customerSubtotal).toBe(expected.customerSubtotal);
    expect(actual.projectMinimumAdjustment).toBe(expected.projectMinimumAdjustment);
    expect(actual.quote).toBe(expected.quote);
    expect(actual.internal.totalDirectCost).toBe(expected.internalTotal);
    expect(actual.internal.overheadAlloc).toBe(expected.overhead);
    expect(actual.internal.netProfit).toBe(expected.netProfit);
    expect(actual.internal.netMarginPct).toBeCloseTo(expected.netMarginPct, 8);
    expect(actual.itemLines.map(({ key, customer, internal, customerVisible }) => ({ key, customer, internal, customerVisible }))).toEqual(expected.lines);
  });
});