/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingConfig.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that price lists accept safe changes and reject broken ones.
 *   It also proves the new calculator preserves every total from the original calculator.
 *
 * DEPENDS ON:
 *   Packages:  Vitest
 *   Internal:  oopPricing.js, oopPricingConfig.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Legacy-total checks are exact because existing saved quote behavior is frozen.
 *   - Edge cases cover rounding, minimums, ordering, overrides, and hidden costs.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { LEGACY_PRICING_CONFIG, addPricingItem, archivePricingItem, isPricingConfigRpcUnavailable, movePricingItem, normalizePricingConfig, pricingConfigEquals, restorePricingItem, updatePricingItem, validatePricingConfig } from './oopPricingConfig';
import { BLANK, calcPricingQuote, calcQuote, legacyFormFromInputs, legacyInputsFromForm, paramsForPricingQuoteV2, serializePricingInputs } from './oopPricing';

const water = { ...BLANK, techHours: '2', billRate: '100', airMoverCount: '1', airMoverDays: '2', materialsActualCost: '10', antimicrobialSqft: '10', disposalTrips: '1' };
describe('OOP pricing engine', () => {
  it('has exact legacy water and mold line parity', () => {
    expect(calcQuote(water)).toMatchObject({ quote: 391, lines: { laborLine: 200, equipment: 50, materialsLine: 12.5, antimicrobialLine: 3.5, disposalLine: 125 } });
    expect(calcQuote({ ...water, jobType: 'mold', negAirCount: '1', negAirDays: '2', containmentLinearFt: '10', prvInvoiceCost: '25' })).toMatchObject({ lines: { equipment: 270, containmentLine: 20, ppeLine: 10 }, internal: { containmentCost: 12, ppeCost: 4, prvCost: 25 } });
  });
  it('rounds, applies line/project minimums, and computes final-total internal costs', () => {
    const config = updatePricingItem({ ...LEGACY_PRICING_CONFIG, projectMinimums: { water: 50, mold: 0 } }, 'antimicrobial', { minimumCharge: 10 });
    const quote = calcPricingQuote({ config, inputs: { antimicrobial: { quantity: 1 } } });
    expect(quote.quote).toBe(50); expect(quote.projectMinimumAdjustment).toBe(40);
    expect(calcPricingQuote({ inputs: { labor: { quantity: 1 } } }).internal.overheadAlloc).toBe(30.36);
    const fractionalMinimum = updatePricingItem(LEGACY_PRICING_CONFIG, 'antimicrobial', { minimumCharge: .015 });
    expect(calcPricingQuote({ config: fractionalMinimum, inputs: { antimicrobial: { quantity: .001 } } }).itemLines.find((line) => line.key === 'antimicrobial').customer).toBe(.02);
  });
  it('rejects unsafe input and honors archive/job-type filtering', () => {
    expect(() => calcPricingQuote({ inputs: { unknown: { quantity: 1 } } })).toThrow('Unknown');
    expect(() => calcPricingQuote({ inputs: { labor: { quantity: -1 } } })).toThrow('non-negative');
    expect(() => calcPricingQuote({ inputs: { air_mover: { quantity: 1, rateOverride: 2 } } })).toThrow('does not allow');
    expect(calcPricingQuote({ config: archivePricingItem(LEGACY_PRICING_CONFIG, 'labor'), inputs: { labor: { quantity: 1 } } }).quote).toBe(0);
    expect(calcPricingQuote({ jobType: 'water', inputs: { negative_air: { quantity: 1, days: 1 } } }).quote).toBe(0);
  });
  it('rejects malformed raw configs and input payloads before normalization', () => {
    expect(() => calcPricingQuote({ config: { ...LEGACY_PRICING_CONFIG, unknown: true } })).toThrow('unknown config field');
    const badItem = { ...LEGACY_PRICING_CONFIG, items: [{ ...LEGACY_PRICING_CONFIG.items[0], key: 'Bad Key', extra: true }] };
    expect(validatePricingConfig(badItem).join(' ')).toMatch(/unknown field.*key is invalid/);
    expect(() => calcPricingQuote({ config: { ...LEGACY_PRICING_CONFIG, projectMinimums: { water: -1, mold: 0 } } })).toThrow('projectMinimums.water');
    expect(() => calcPricingQuote({ inputs: { labor: 1 } })).toThrow('input must be an object');
    expect(() => calcPricingQuote({ inputs: { labor: { quantity: 1, nope: true } } })).toThrow('unknown');
    expect(() => calcPricingQuote({ inputs: { labor: { quantity: 1.00001 } } })).toThrow('four decimals');
    expect(() => calcPricingQuote({ inputs: { labor: { quantity: 1000001 } } })).toThrow('bounded');
  });
  it('does not add hidden lines to customer totals or percentage subtotal bases', () => {
    const config = updatePricingItem(LEGACY_PRICING_CONFIG, 'prv', { customerVisible: false, standardRate: 20 });
    expect(calcPricingQuote({ config, jobType: 'mold', inputs: { prv: { quantity: 2 } } }).quote).toBe(0);
    const minimum = updatePricingItem(LEGACY_PRICING_CONFIG, 'antimicrobial', { minimumCharge: .01 });
    expect(calcPricingQuote({ config: minimum, inputs: { antimicrobial: { quantity: .001 } } }).itemLines.find((line) => line.key === 'antimicrobial').customer).toBe(.01);
  });
  it('bases prior-subtotal percentages only on earlier visible lines', () => {
    const config = addPricingItem(LEGACY_PRICING_CONFIG, {
      key: 'early_percentage', label: 'Early percentage', sortOrder: 15, jobTypes: ['water'],
      formula: 'percentage', unit: 'percent', standardRate: .1, percentageBase: 'prior_subtotal',
    });
    const quote = calcPricingQuote({ config, inputs: { labor: { quantity: 1 }, disposal: { quantity: 1 } } });
    expect(quote.itemLines.find((line) => line.key === 'early_percentage').customer).toBe(9.2);
    expect(quote.quote).toBe(226.2);
  });
  it('rejects named percentage bases that point to a later deterministic item', () => {
    const laterTarget = updatePricingItem(LEGACY_PRICING_CONFIG, 'ppe', { jobTypes: ['water'], sortOrder: 5, percentageBase: 'item:labor' });
    expect(validatePricingConfig(laterTarget).join(' ')).toContain('target must be an earlier item');
  });
  it('uses zero for a named customer percentage base when its target is hidden', () => {
    const hiddenTarget = updatePricingItem(LEGACY_PRICING_CONFIG, 'prv', { standardRate: 50 });
    const config = addPricingItem(hiddenTarget, {
      key: 'hidden_target_percentage', label: 'Hidden target percentage', sortOrder: 125, jobTypes: ['mold'],
      formula: 'percentage', unit: 'percent', standardRate: .1, percentageBase: 'item:prv',
    });
    const quote = calcPricingQuote({ config, jobType: 'mold', inputs: { prv: { quantity: 2 } } });
    expect(quote.itemLines.find((line) => line.key === 'hidden_target_percentage').customer).toBe(0);
    expect(quote.quote).toBe(0);
  });
  it('bases final-total internal costs on the post-minimum final quote', () => {
    const config = { ...LEGACY_PRICING_CONFIG, projectMinimums: { water: 100, mold: 0 } };
    const quote = calcPricingQuote({ config, inputs: { labor: { quantity: .1 } } });
    expect(quote.quote).toBe(100);
    expect(quote.projectMinimumAdjustment).toBe(90.8);
    expect(quote.itemLines.find((line) => line.key === 'overhead').internal).toBe(33);
    expect(quote.internal.overheadAlloc).toBe(33);
  });
  it('round-trips legacy inputs and supports immutable settings helpers', () => {
    const inputs = legacyInputsFromForm(water); expect(legacyFormFromInputs(inputs).techHours).toBe('2');
    const added = addPricingItem(LEGACY_PRICING_CONFIG); expect(added.items.at(-1).key).toMatch(/^custom_/);
    expect(restorePricingItem(archivePricingItem(added, added.items.at(-1).key), added.items.at(-1).key).items.at(-1).active).toBe(true);
    expect(movePricingItem(added, added.items.at(-1).key, 'up').items.find((item) => item.key === added.items.at(-1).key).sortOrder).toBeLessThan(added.items.at(-1).sortOrder);
    expect(pricingConfigEquals(LEGACY_PRICING_CONFIG, normalizePricingConfig(LEGACY_PRICING_CONFIG))).toBe(true); expect(validatePricingConfig({}).length).toBeGreaterThan(0);
  });
  it('uses the frozen v2 RPC shape and only identifies missing RPC errors', () => {
    expect(paramsForPricingQuoteV2({ jobType: 'water', requestId: 'r1' })).toEqual({ p_id: null, p_job_id: null, p_job_type: 'water', p_insured_name: null, p_address: null, p_notes: null, p_pricing_revision_id: null, p_inputs: {}, p_expected_updated_at: null, p_request_id: 'r1' });
    expect(isPricingConfigRpcUnavailable({ code: 'PGRST202' })).toBe(true); expect(isPricingConfigRpcUnavailable({ code: '42501' })).toBe(false);    expect(serializePricingInputs({ labor: { quantity: '2.5', days: '', rateOverride: '92' }, materials: { quantity: null } })).toEqual({ labor: { quantity: 2.5, rateOverride: 92 }, materials: {} });
    expect(() => serializePricingInputs({ labor: { quantity: '1', unexpected: 1 } })).toThrow('unknown');
    expect(() => serializePricingInputs({ labor: { quantity: 'Infinity' } })).toThrow('finite');
    expect(() => serializePricingInputs({ labor: '2' })).toThrow('input must be an object');
  });
});