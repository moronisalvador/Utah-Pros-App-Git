/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingRuntime.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that published price lists and saved quotes open with the right prices.
 *   It also proves save retries keep the same safe request identity when content has not changed.
 *
 * DEPENDS ON:
 *   Packages:  Vitest
 *   Internal:  oopPricingRuntime.js, oopPricingConfig.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These checks run without a browser and cover data conversion only.
 *   - Snapshot tests protect historical quotes from future price-list changes.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { LEGACY_PRICING_CONFIG, updatePricingItem } from './oopPricingConfig';
import {
  defaultPricingInputs,
  normalizePricingEnvelope,
  pricingSaveFingerprint,
  quotePricingState,
} from './oopPricingRuntime';

describe('OOP pricing runtime adapters', () => {
  it('hydrates default values and standard overrides from a published config', () => {
    const config = updatePricingItem(
      updatePricingItem(LEGACY_PRICING_CONFIG, 'labor', { defaultQuantity: 4 }),
      'air_mover',
      { defaultDays: 3 },
    );
    const inputs = defaultPricingInputs(config);
    expect(inputs.labor).toEqual({ quantity: '4', rateOverride: '92' });
    expect(inputs.air_mover).toEqual({ days: '3' });
  });

  it('normalizes camel- and snake-case revision envelopes', () => {
    expect(normalizePricingEnvelope({
      id: 'revision-2',
      revision_number: 2,
      config: LEGACY_PRICING_CONFIG,
    })).toMatchObject({ id: 'revision-2', revisionNumber: 2, source: 'published' });
    expect(() => normalizePricingEnvelope({ config: { broken: true } })).toThrow('Invalid pricing configuration');
  });

  it('pins a saved v2 quote to its snapshot and inputs', () => {
    const snapshot = updatePricingItem(LEGACY_PRICING_CONFIG, 'labor', { standardRate: 123 });
    const state = quotePricingState({
      pricing_revision_id: 'revision-7',
      pricing_config_snapshot: snapshot,
      pricing_inputs: { labor: { quantity: '2', rateOverride: '123' } },
    });
    expect(state).toMatchObject({
      id: 'revision-7',
      source: 'snapshot',
      inputs: { labor: { quantity: '2', rateOverride: '123' } },
    });
    expect(state.config.items.find((item) => item.key === 'labor').standardRate).toBe(123);
  });

  it('adapts legacy quote columns without silently using current pricing', () => {
    const state = quotePricingState({ tech_hours: 2, bill_rate: 100, air_mover_count: 1, air_mover_days: 3 });
    expect(state.source).toBe('legacy_quote');
    expect(state.revisionNumber).toBe(1);
    expect(state.inputs.labor).toEqual({ quantity: '2', rateOverride: '100' });
    expect(state.inputs.air_mover).toEqual({ quantity: 1, days: 3 });
  });

  it('keeps retry fingerprints stable across request-id changes', () => {
    const base = { p_id: null, p_inputs: { labor: { quantity: 2 } } };
    expect(pricingSaveFingerprint({ ...base, p_request_id: 'one' }))
      .toBe(pricingSaveFingerprint({ ...base, p_request_id: 'two' }));
    expect(pricingSaveFingerprint({ ...base, p_inputs: { labor: { quantity: 3 } }, p_request_id: 'two' }))
      .not.toBe(pricingSaveFingerprint({ ...base, p_request_id: 'one' }));
  });
});
