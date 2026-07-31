/**
 * ════════════════════════════════════════════════
 * FILE: oopPricing.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Calculates out-of-pocket job prices from a versioned price list. It keeps
 *   the original calculator helpers available while allowing new screens to
 *   use a safer list of individually priced items.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./oopPricingConfig.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The legacy adapter deliberately uses the frozen legacy list so saved
 *     calculator screens keep their existing form and RPC contract.
 * ════════════════════════════════════════════════
 */
import { LEGACY_PRICING_CONFIG, normalizePricingConfig, validatePricingConfig } from './oopPricingConfig';

// ─── SECTION: Legacy public contract ──────────────
export const RATES = { airMover: 25, lgr: 80, xlgr: 125, airScrubber: 75, negAir: 110, antimicrobialPerSqft: .35, disposalPerTrip: 125, containmentPerLft: 2, materialsMarkup: 1.25, ppeMultiplier: .05 };
export const COSTS = { effectiveLaborCost: 51, overheadRate: .33, antimicrobialCostPerSqft: .15, disposalCostPerTrip: 50, containmentCostPerLft: 1.2, ppeCostMultiplier: .02 };
export const BLANK = { jobType: 'water', insuredName: '', address: '', techHours: '', billRate: '92', airMoverCount: '', airMoverDays: '', lgrCount: '', lgrDays: '', xlgrCount: '', xlgrDays: '', airScrubberCount: '', airScrubberDays: '', negAirCount: '', negAirDays: '', materialsActualCost: '', antimicrobialSqft: '', disposalTrips: '', containmentLinearFt: '', prvInvoiceCost: '', notes: '' };
export const toNum = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const isDecimal = (value) => value === '' || /^\d*\.?\d*$/.test(value);
export const isInt = (value) => value === '' || /^\d*$/.test(value);
export const TIER_COLORS = { green: { bg: 'var(--success-bg)', fg: 'var(--success)', border: 'var(--success-border)' }, amber: { bg: 'var(--warning-bg)', fg: 'var(--warning)', border: 'var(--warning-border)' }, red: { bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'var(--danger-border)' }, none: { bg: 'var(--bg-tertiary)', fg: 'var(--text-tertiary)', border: 'var(--border-light)' } };
export const tierFor = (pct) => pct == null ? 'none' : pct >= 20 ? 'green' : pct >= 10 ? 'amber' : 'red';
export const divisionToJobType = (division) => division === 'mold' ? 'mold' : 'water';

// ─── SECTION: Config inputs and calculation ──────────────
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const MAX_INPUT = 1_000_000;
const numericInput = (value, label) => {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_INPUT || !Number.isInteger(number * 10_000)) throw new Error(`${label} must be a bounded non-negative number with at most four decimals`);
  return number;
};
const validateInputs = (inputs, allItems) => {
  if (!inputs || Array.isArray(inputs) || typeof inputs !== 'object') throw new Error('inputs must be an object');
  const known = new Set(allItems.map((item) => item.key));
  Object.entries(inputs).forEach(([key, input]) => {
    if (!known.has(key)) throw new Error(`Unknown pricing item: ${key}`);
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error(`${key} input must be an object`);
    Object.keys(input).forEach((field) => { if (!['quantity', 'days', 'rateOverride'].includes(field)) throw new Error(`${key}.${field} is unknown`); });
    ['quantity', 'days', 'rateOverride'].forEach((field) => { if (input[field] != null && input[field] !== '') numericInput(input[field], `${key}.${field}`); });
  });
};const activeItems = (config, jobType) => config.items.filter((item) => item.active && item.jobTypes.includes(jobType)).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

export function calcPricingQuote({ config = LEGACY_PRICING_CONFIG, jobType = 'water', inputs = {}, configRevisionId = null, configRevision = null } = {}) {
  const configErrors = validatePricingConfig(config);
  if (configErrors.length) throw new Error(`Invalid pricing config: ${configErrors.join('; ')}`);
  if (!['water', 'mold'].includes(jobType)) throw new Error('Unknown job type');
  validateInputs(inputs, config.items);
  const normalized = normalizePricingConfig(config);
  const items = activeItems(normalized, jobType);  const linesByKey = new Map();
  const itemLines = [];
  let customerSubtotal = 0;
  let internalSubtotal = 0;
  const finalInternal = [];
  for (const item of items) {
    const input = inputs[item.key] || {};
    const rawQuantity = numericInput(input.quantity, `${item.key}.quantity`);
    const days = numericInput(input.days, `${item.key}.days`);
    const inputRate = input.rateOverride == null || input.rateOverride === '' ? null : numericInput(input.rateOverride, `${item.key}.rateOverride`);
    if (inputRate != null && !item.priceOverrideAllowed) throw new Error(`${item.key} does not allow a rate override`);
    const quantity = rawQuantity > 0 ? Math.max(rawQuantity, item.minimumQuantity) : 0;
    const rate = inputRate ?? item.standardRate;
    const baseFor = (base) => { const source = linesByKey.get(String(base).slice(5)); return base === 'prior_subtotal' ? customerSubtotal : base === 'final_total' ? null : String(base).startsWith('item:') ? (source?.customerVisible ? source.customer : 0) : 0; };
    const internalBaseFor = (base) => base === 'final_total' ? null : baseFor(base);
    let customerRaw = 0;
    let internalRaw = 0;
    if (item.formula === 'quantity') customerRaw = quantity * rate;
    if (item.formula === 'duration') customerRaw = quantity * days * rate;
    if (item.formula === 'fixed') customerRaw = quantity > 0 ? rate : 0;
    if (item.formula === 'cost_plus') customerRaw = quantity * rate;
    if (item.formula === 'pass_through') customerRaw = quantity * rate;
    if (item.formula === 'percentage') {
      if (item.percentageBase === 'final_total' && item.customerVisible && rate !== 0) throw new Error(`${item.key} has circular customer final-total percentage`);
      customerRaw = (baseFor(item.percentageBase) || 0) * rate;
    }
    if (item.internalCostBasis === 'units') internalRaw = item.formula === 'duration' ? quantity * days * item.internalRate : quantity * item.internalRate;
    if (item.internalCostBasis === 'input') internalRaw = rawQuantity * item.internalRate;
    if (item.internalCostBasis === 'percentage_base') internalRaw = (internalBaseFor(item.percentageBase) || 0) * item.internalRate;
    const customer = round(customerRaw);
    // Price-list values permit four decimal places, but every customer-facing
    // line remains a cent value after a configured minimum is applied.
    const customerWithMinimum = customerRaw > 0 ? round(Math.max(customer, item.minimumCharge)) : customer;
    const internal = item.internalCostBasis === 'final_total' ? 0 : round(internalRaw);
    const line = { key: item.key, label: item.label, section: item.section, quantity, days, rate, customer: customerWithMinimum, internal, customerVisible: item.customerVisible, formula: item.formula };
    linesByKey.set(item.key, line); itemLines.push(line);
    customerSubtotal = round(customerSubtotal + (item.customerVisible ? customerWithMinimum : 0));
    internalSubtotal = round(internalSubtotal + internal);
    if (item.internalCostBasis === 'final_total') finalInternal.push({ item, line });
  }
  const minimum = normalized.projectMinimums[jobType] || 0;
  const projectMinimumAdjustment = customerSubtotal > 0 && customerSubtotal < minimum ? round(minimum - customerSubtotal) : 0;
  const quote = round(customerSubtotal + projectMinimumAdjustment);
  for (const { item, line } of finalInternal) { line.internal = round(quote * item.internalRate); internalSubtotal = round(internalSubtotal + line.internal); }
  const netProfit = round(quote - internalSubtotal);
  return { itemLines, quote, customerSubtotal, projectMinimumAdjustment, internal: { totalDirectCost: internalSubtotal, overheadAlloc: linesByKey.get('overhead')?.internal || 0, netProfit, netMarginPct: quote > 0 ? (netProfit / quote) * 100 : null }, configSchemaVersion: normalized.schemaVersion, configName: normalized.name, configRevisionId, configRevision };
}

export function legacyInputsFromForm(form = {}) {
  return {
    labor: { quantity: form.techHours, rateOverride: form.billRate }, air_mover: { quantity: form.airMoverCount, days: form.airMoverDays }, lgr: { quantity: form.lgrCount, days: form.lgrDays }, xlgr: { quantity: form.xlgrCount, days: form.xlgrDays }, air_scrubber: { quantity: form.airScrubberCount, days: form.airScrubberDays }, negative_air: { quantity: form.negAirCount, days: form.negAirDays }, materials: { quantity: form.materialsActualCost }, antimicrobial: { quantity: form.antimicrobialSqft }, disposal: { quantity: form.disposalTrips }, containment: { quantity: form.containmentLinearFt }, prv: { quantity: form.prvInvoiceCost },
  };
}
export function legacyFormFromInputs(inputs = {}, base = BLANK) {
  const value = (key, name) => inputs[key]?.[name] ?? '';
  return { ...base, techHours: value('labor', 'quantity'), billRate: value('labor', 'rateOverride') || '92', airMoverCount: value('air_mover', 'quantity'), airMoverDays: value('air_mover', 'days'), lgrCount: value('lgr', 'quantity'), lgrDays: value('lgr', 'days'), xlgrCount: value('xlgr', 'quantity'), xlgrDays: value('xlgr', 'days'), airScrubberCount: value('air_scrubber', 'quantity'), airScrubberDays: value('air_scrubber', 'days'), negAirCount: value('negative_air', 'quantity'), negAirDays: value('negative_air', 'days'), materialsActualCost: value('materials', 'quantity'), antimicrobialSqft: value('antimicrobial', 'quantity'), disposalTrips: value('disposal', 'quantity'), containmentLinearFt: value('containment', 'quantity'), prvInvoiceCost: value('prv', 'quantity') };
}
export function serializePricingInputs(inputs = {}) {
  if (!inputs || Array.isArray(inputs) || typeof inputs !== 'object') throw new Error('inputs must be an object');
  const result = {};
  Object.entries(inputs).forEach(([key, input]) => {
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error(`${key} input must be an object`);
    const serialized = {};
    Object.entries(input).forEach(([field, value]) => {
      if (!['quantity', 'days', 'rateOverride'].includes(field)) throw new Error(`${key}.${field} is unknown`);
      if (value == null || (typeof value === 'string' && value.trim() === '')) return;
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`${key}.${field} must be finite`);
      serialized[field] = number;
    });
    result[key] = serialized;
  });
  return result;
}
export function paramsForPricingQuoteV2({ quoteId = null, jobId = null, jobType, insuredName, address, notes, pricingRevisionId = null, inputs = {}, expectedUpdatedAt = null, requestId }) {
  if (!requestId) throw new Error('requestId is required');
  return { p_id: quoteId, p_job_id: jobId, p_job_type: jobType, p_insured_name: insuredName || null, p_address: address || null, p_notes: notes || null, p_pricing_revision_id: pricingRevisionId, p_inputs: serializePricingInputs(inputs), p_expected_updated_at: expectedUpdatedAt, p_request_id: requestId };
}
export function calcQuote(form) {
  // Legacy consumers retain their historic unrounded arithmetic. Rates still
  // come from the frozen v1 config, so there is no second mutable price list.
  const item = (key) => LEGACY_PRICING_CONFIG.items.find((entry) => entry.key === key);
  const rate = (key) => item(key).standardRate;
  const cost = (key) => item(key).internalRate;
  const mold = form.jobType === 'mold';
  const n = toNum;
  const laborLine = n(form.techHours) * n(form.billRate);
  const equipment = n(form.airMoverCount) * n(form.airMoverDays) * rate('air_mover') + n(form.lgrCount) * n(form.lgrDays) * rate('lgr') + n(form.xlgrCount) * n(form.xlgrDays) * rate('xlgr') + n(form.airScrubberCount) * n(form.airScrubberDays) * rate('air_scrubber') + (mold ? n(form.negAirCount) * n(form.negAirDays) * rate('negative_air') : 0);
  const materialsLine = n(form.materialsActualCost) * rate('materials');
  const antimicrobialLine = n(form.antimicrobialSqft) * rate('antimicrobial');
  const disposalLine = n(form.disposalTrips) * rate('disposal');
  const containmentLine = mold ? n(form.containmentLinearFt) * rate('containment') : 0;
  const ppeLine = mold ? laborLine * rate('ppe') : 0;
  const quote = laborLine + equipment + materialsLine + antimicrobialLine + disposalLine + containmentLine + ppeLine;
  const directLaborCost = n(form.techHours) * cost('labor');
  const materialsCost = n(form.materialsActualCost) * cost('materials');
  const antimicrobialCost = n(form.antimicrobialSqft) * cost('antimicrobial');
  const disposalCost = n(form.disposalTrips) * cost('disposal');
  const containmentCost = mold ? n(form.containmentLinearFt) * cost('containment') : 0;
  const ppeCost = mold ? laborLine * cost('ppe') : 0;
  const prvCost = mold ? n(form.prvInvoiceCost) * cost('prv') : 0;
  const totalDirectCost = directLaborCost + materialsCost + antimicrobialCost + disposalCost + containmentCost + ppeCost + prvCost;
  const overheadAlloc = quote * cost('overhead');
  const netProfit = quote - totalDirectCost - overheadAlloc;
  return { lines: { laborLine, equipment, materialsLine, antimicrobialLine, disposalLine, containmentLine, ppeLine }, quote, internal: { directLaborCost, materialsCost, antimicrobialCost, disposalCost, containmentCost, ppeCost, prvCost, totalDirectCost, overheadAlloc, netProfit, netMarginPct: quote > 0 ? (netProfit / quote) * 100 : null } };
}
export function formFromQuoteRow(row) { return { ...BLANK, jobType: row.job_type || 'water', insuredName: row.insured_name || '', address: row.address || '', techHours: row.tech_hours != null ? String(row.tech_hours) : '', billRate: row.bill_rate != null ? String(row.bill_rate) : '92', airMoverCount: row.air_mover_count || '', airMoverDays: row.air_mover_days || '', lgrCount: row.lgr_count || '', lgrDays: row.lgr_days || '', xlgrCount: row.xlgr_count || '', xlgrDays: row.xlgr_days || '', airScrubberCount: row.air_scrubber_count || '', airScrubberDays: row.air_scrubber_days || '', negAirCount: row.neg_air_count || '', negAirDays: row.neg_air_days || '', materialsActualCost: row.materials_actual_cost != null ? String(row.materials_actual_cost) : '', antimicrobialSqft: row.antimicrobial_sqft != null ? String(row.antimicrobial_sqft) : '', disposalTrips: row.disposal_trips || '', containmentLinearFt: row.containment_linear_ft != null ? String(row.containment_linear_ft) : '', prvInvoiceCost: row.prv_invoice_cost != null ? String(row.prv_invoice_cost) : '', notes: row.notes || '' }; }
export function paramsForUpsert({ form, quoteId, jobId, calc, employeeId }) { const mold = form.jobType === 'mold'; return { p_id: quoteId || null, p_job_id: jobId || null, p_job_type: form.jobType, p_insured_name: form.insuredName || null, p_address: form.address || null, p_tech_hours: toNum(form.techHours), p_bill_rate: toNum(form.billRate), p_air_mover_count: toNum(form.airMoverCount), p_air_mover_days: toNum(form.airMoverDays), p_lgr_count: toNum(form.lgrCount), p_lgr_days: toNum(form.lgrDays), p_xlgr_count: toNum(form.xlgrCount), p_xlgr_days: toNum(form.xlgrDays), p_air_scrubber_count: toNum(form.airScrubberCount), p_air_scrubber_days: toNum(form.airScrubberDays), p_neg_air_count: mold ? toNum(form.negAirCount) : 0, p_neg_air_days: mold ? toNum(form.negAirDays) : 0, p_materials_actual_cost: toNum(form.materialsActualCost), p_antimicrobial_sqft: toNum(form.antimicrobialSqft), p_disposal_trips: toNum(form.disposalTrips), p_containment_linear_ft: mold ? toNum(form.containmentLinearFt) : 0, p_prv_invoice_cost: mold ? toNum(form.prvInvoiceCost) : 0, p_quote_total: calc.quote, p_net_margin_pct: calc.internal.netMarginPct, p_notes: form.notes || null, p_created_by: employeeId || null }; }
