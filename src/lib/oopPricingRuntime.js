/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingRuntime.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns published price lists and saved quotes into the calculator's working data.
 *   It keeps old saved quotes tied to the prices they were created with.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  oopPricing, oopPricingConfig
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - A saved quote always prefers its stored price-list snapshot so later
 *     price changes do not rewrite the customer's historical calculation.
 *   - Legacy quote rows are converted into the frozen original price list.
 * ════════════════════════════════════════════════
 */

import { formFromQuoteRow, legacyInputsFromForm } from './oopPricing';
import { LEGACY_PRICING_CONFIG, normalizePricingConfig, validatePricingConfig } from './oopPricingConfig';

const unwrap = (value) => Array.isArray(value) ? value[0] : value;
function validatedConfig(config) {
  const errors = validatePricingConfig(config);
  if (errors.length) throw new Error(`Invalid pricing configuration: ${errors.join('; ')}`);
  return normalizePricingConfig(config);
}


export function defaultPricingInputs(config) {
  return Object.fromEntries(normalizePricingConfig(config).items.map((item) => {
    const input = {};
    if (item.defaultQuantity > 0) input.quantity = String(item.defaultQuantity);
    if (item.defaultDays > 0) input.days = String(item.defaultDays);
    if (item.priceOverrideAllowed) input.rateOverride = String(item.standardRate);
    return [item.key, input];
  }));
}

export function normalizePricingEnvelope(value) {
  const row = unwrap(value);
  if (!row?.config) throw new Error('The pricing configuration response was incomplete.');
  return {
    id: row.id || row.revisionId || row.revision_id || null,
    revisionNumber: row.revisionNumber ?? row.revision_number ?? null,
    config: validatedConfig(row.config),
    source: 'published',
  };
}

export function quotePricingState(row) {
  if (row?.pricing_config_snapshot && row?.pricing_inputs) {
    return {
      id: row.pricing_revision_id || null,
      revisionNumber: null,
      config: validatedConfig(row.pricing_config_snapshot),
      inputs: row.pricing_inputs,
      source: 'snapshot',
    };
  }
  return {
    id: null,
    revisionNumber: 1,
    config: LEGACY_PRICING_CONFIG,
    inputs: legacyInputsFromForm(formFromQuoteRow(row || {})),
    source: 'legacy_quote',
  };
}

export function pricingSaveFingerprint(params) {
  const payload = { ...params };
  delete payload.p_request_id;
  return JSON.stringify(payload);
}
