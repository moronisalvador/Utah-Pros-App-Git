/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingConfig.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Defines what an out-of-pocket price list can contain and checks every item.
 *   It also adds, edits, orders, archives, and restores items without changing the original copy.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Configuration is strict: unknown fields, duplicate item keys, and
 *     out-of-range prices are rejected instead of silently repaired.
 *   - Removing an item archives it so saved quotes can still understand it.
 *
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Contract validation ──────────────
export const OOP_PRICING_SCHEMA_VERSION = 1;
const FORMULAS = new Set(['quantity', 'duration', 'fixed', 'cost_plus', 'percentage', 'pass_through']);
const COST_BASES = new Set(['units', 'input', 'percentage_base', 'final_total', 'none']);
const ITEM_FIELDS = new Set(['key', 'label', 'helpText', 'section', 'sortOrder', 'jobTypes', 'formula', 'unit', 'standardRate', 'internalRate', 'internalCostBasis', 'minimumQuantity', 'minimumCharge', 'defaultQuantity', 'defaultDays', 'percentageBase', 'customerVisible', 'active', 'priceOverrideAllowed']);
const CONFIG_FIELDS = new Set(['schemaVersion', 'name', 'projectMinimums', 'items']);
const MAX_AMOUNT = 1_000_000;
const MAX_SORT = 100_000;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));
const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const precision = (value) => Number.isInteger(Number(value) * 10_000);
const numberError = (value, max) => !Number.isFinite(value) || value < 0 || value > max || !precision(value);

export function validatePricingConfig(config) {
  const errors = [];
  if (!config || Array.isArray(config) || typeof config !== 'object') return ['config must be an object'];
  Object.keys(config).forEach((field) => { if (!CONFIG_FIELDS.has(field)) errors.push(`unknown config field: ${field}`); });
  if (config.schemaVersion !== OOP_PRICING_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (typeof config.name !== 'string' || !config.name.trim() || config.name.length > 120) errors.push('name is required');
  if (!config.projectMinimums || typeof config.projectMinimums !== 'object' || Array.isArray(config.projectMinimums)) errors.push('projectMinimums is required');
  else {
    Object.keys(config.projectMinimums).forEach((key) => { if (!['water', 'mold'].includes(key)) errors.push(`unknown projectMinimums field: ${key}`); });
    ['water', 'mold'].forEach((key) => { if (numberError(config.projectMinimums[key], MAX_AMOUNT)) errors.push(`projectMinimums.${key} is invalid`); });
  }
  if (!Array.isArray(config.items) || config.items.length > 250) errors.push('items must be an array');
  const keys = new Set();
  (config.items || []).forEach((item, index) => {
    const prefix = `items[${index}]`;
    if (!item || Array.isArray(item) || typeof item !== 'object') { errors.push(`${prefix} must be an object`); return; }
    Object.keys(item).forEach((field) => { if (!ITEM_FIELDS.has(field)) errors.push(`${prefix} has unknown field: ${field}`); });
    ['key', 'label', 'helpText', 'section', 'unit'].forEach((field) => { if (typeof item[field] !== 'string') errors.push(`${prefix}.${field} is required`); });
    if (!KEY.test(item.key || '')) errors.push(`${prefix}.key is invalid`);
    if (keys.has(item.key)) errors.push(`${prefix}.key is duplicated`); keys.add(item.key);
    if (numberError(item.sortOrder, MAX_SORT) || !Number.isInteger(item.sortOrder)) errors.push(`${prefix}.sortOrder is invalid`);
    if (!Array.isArray(item.jobTypes) || !item.jobTypes.length || item.jobTypes.some((type) => !['water', 'mold'].includes(type)) || new Set(item.jobTypes).size !== item.jobTypes.length) errors.push(`${prefix}.jobTypes is invalid`);
    if (!FORMULAS.has(item.formula)) errors.push(`${prefix}.formula is invalid`);
    if (!COST_BASES.has(item.internalCostBasis)) errors.push(`${prefix}.internalCostBasis is invalid`);
    ['standardRate', 'internalRate', 'minimumQuantity', 'minimumCharge', 'defaultQuantity', 'defaultDays'].forEach((field) => { if (numberError(item[field], MAX_AMOUNT)) errors.push(`${prefix}.${field} is invalid`); });
    ['customerVisible', 'active', 'priceOverrideAllowed'].forEach((field) => { if (typeof item[field] !== 'boolean') errors.push(`${prefix}.${field} is required`); });
    if (item.formula !== 'percentage' && item.percentageBase !== null) errors.push(`${prefix}.percentageBase is only valid for percentage`);
    if (item.formula === 'percentage') {
      const base = item.percentageBase;
      if (!(base === 'prior_subtotal' || base === 'final_total' || (typeof base === 'string' && /^item:[a-z][a-z0-9_]{0,63}$/.test(base)))) errors.push(`${prefix}.percentageBase is invalid`);
      if (base === 'final_total' && item.customerVisible && item.standardRate !== 0) errors.push(`${prefix} has circular customer final-total percentage`);
    }
    if (item.internalCostBasis === 'percentage_base' && item.formula !== 'percentage') errors.push(`${prefix}.internalCostBasis requires percentage formula`);
    if (item.internalCostBasis === 'final_total' && item.formula !== 'percentage') errors.push(`${prefix}.internalCostBasis requires percentage formula`);
  });
  const itemsByKey = new Map((config.items || []).filter(Boolean).map((item) => [item.key, item]));
  const compareOrder = (left, right) => Number(left.sortOrder) - Number(right.sortOrder) || String(left.key).localeCompare(String(right.key));
  (config.items || []).forEach((item, index) => {
    if (item?.formula !== 'percentage' || typeof item.percentageBase !== 'string' || !item.percentageBase.startsWith('item:')) return;
    const target = itemsByKey.get(item.percentageBase.slice(5));
    if (!target || compareOrder(target, item) >= 0) errors.push(`items[${index}].percentageBase target must be an earlier item`);
  });
  return errors;
}

export function normalizePricingConfig(config) {
  const copy = clone(config || {});
  copy.schemaVersion = numeric(copy.schemaVersion, OOP_PRICING_SCHEMA_VERSION);
  copy.name = String(copy.name || '').trim();
  copy.projectMinimums = { water: numeric(copy.projectMinimums?.water), mold: numeric(copy.projectMinimums?.mold) };
  copy.items = (copy.items || []).map((item, index) => ({ key: String(item.key || '').trim(), label: String(item.label || '').trim(), helpText: String(item.helpText || ''), section: String(item.section || ''), sortOrder: numeric(item.sortOrder, index + 1), jobTypes: [...new Set((item.jobTypes || []).map(String))].sort(), formula: item.formula || 'quantity', unit: String(item.unit || ''), standardRate: numeric(item.standardRate), internalRate: numeric(item.internalRate), internalCostBasis: item.internalCostBasis || 'none', minimumQuantity: numeric(item.minimumQuantity), minimumCharge: numeric(item.minimumCharge), defaultQuantity: numeric(item.defaultQuantity), defaultDays: numeric(item.defaultDays), percentageBase: item.percentageBase ?? null, customerVisible: Boolean(item.customerVisible), active: item.active !== false, priceOverrideAllowed: Boolean(item.priceOverrideAllowed) })).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return copy;
}
export const pricingConfigEquals = (a, b) => JSON.stringify(normalizePricingConfig(a)) === JSON.stringify(normalizePricingConfig(b));
function changeItem(config, key, changer) { const next = normalizePricingConfig(config); const at = next.items.findIndex((item) => item.key === key); if (at < 0) throw new Error(`Unknown pricing item: ${key}`); next.items[at] = changer(next.items[at]); return normalizePricingConfig(next); }
export function addPricingItem(config, partial = {}) { const current = normalizePricingConfig(config); let n = current.items.length + 1; let key = partial.key || `custom_${n}`; while (current.items.some((item) => item.key === key)) key = `custom_${++n}`; return normalizePricingConfig({ ...current, items: [...current.items, { key, label: partial.label || 'New item', helpText: partial.helpText || '', section: partial.section || 'Custom', sortOrder: partial.sortOrder ?? ((current.items.at(-1)?.sortOrder || 0) + 10), jobTypes: partial.jobTypes || ['water', 'mold'], formula: partial.formula || 'quantity', unit: partial.unit || 'unit', standardRate: partial.standardRate ?? 0, internalRate: partial.internalRate ?? 0, internalCostBasis: partial.internalCostBasis || 'none', minimumQuantity: partial.minimumQuantity ?? 0, minimumCharge: partial.minimumCharge ?? 0, defaultQuantity: partial.defaultQuantity ?? 0, defaultDays: partial.defaultDays ?? 0, percentageBase: partial.percentageBase ?? null, customerVisible: partial.customerVisible ?? true, active: partial.active ?? true, priceOverrideAllowed: partial.priceOverrideAllowed ?? false }] }); }
export const updatePricingItem = (config, key, patch) => changeItem(config, key, (item) => ({ ...item, ...patch, key: item.key }));
export const archivePricingItem = (config, key) => updatePricingItem(config, key, { active: false });
export const restorePricingItem = (config, key) => updatePricingItem(config, key, { active: true });
export function movePricingItem(config, key, direction) { const next = normalizePricingConfig(config); const index = next.items.findIndex((item) => item.key === key); if (index < 0) throw new Error(`Unknown pricing item: ${key}`); const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0; if (!offset || !next.items[index + offset]) return next; const other = next.items[index + offset]; [next.items[index].sortOrder, other.sortOrder] = [other.sortOrder, next.items[index].sortOrder]; return normalizePricingConfig(next); }

// ─── SECTION: Frozen legacy price list ──────────────
const legacyItem = (key, label, section, sortOrder, jobTypes, formula, unit, standardRate, internalRate, internalCostBasis, extra = {}) => ({ key, label, helpText: '', section, sortOrder, jobTypes, formula, unit, standardRate, internalRate, internalCostBasis, minimumQuantity: 0, minimumCharge: 0, defaultQuantity: 0, defaultDays: 0, percentageBase: null, customerVisible: true, active: true, priceOverrideAllowed: false, ...extra });
export const LEGACY_PRICING_CONFIG = Object.freeze(normalizePricingConfig({ schemaVersion: 1, name: 'Legacy OOP pricing', projectMinimums: { water: 0, mold: 0 }, items: [legacyItem('labor', 'Labor', 'Labor', 10, ['water', 'mold'], 'quantity', 'hour', 92, 51, 'units', { priceOverrideAllowed: true }), legacyItem('air_mover', 'Air mover', 'Equipment', 20, ['water', 'mold'], 'duration', 'day', 25, 0, 'none'), legacyItem('lgr', 'LGR dehumidifier', 'Equipment', 30, ['water', 'mold'], 'duration', 'day', 80, 0, 'none'), legacyItem('xlgr', 'XLGR dehumidifier', 'Equipment', 40, ['water', 'mold'], 'duration', 'day', 125, 0, 'none'), legacyItem('air_scrubber', 'Air scrubber', 'Equipment', 50, ['water', 'mold'], 'duration', 'day', 75, 0, 'none'), legacyItem('negative_air', 'Negative air setup', 'Equipment', 60, ['mold'], 'duration', 'day', 110, 0, 'none'), legacyItem('materials', 'Materials', 'Materials', 70, ['water', 'mold'], 'cost_plus', 'cost', 1.25, 1, 'input'), legacyItem('antimicrobial', 'Antimicrobial', 'Materials', 80, ['water', 'mold'], 'quantity', 'sqft', .35, .15, 'units'), legacyItem('disposal', 'Disposal', 'Materials', 90, ['water', 'mold'], 'quantity', 'trip', 125, 50, 'units'), legacyItem('containment', 'Containment', 'Containment', 100, ['mold'], 'quantity', 'linear ft', 2, 1.2, 'units'), legacyItem('ppe', 'PPE', 'Containment', 110, ['mold'], 'percentage', 'labor', .05, .02, 'percentage_base', { percentageBase: 'item:labor' }), legacyItem('prv', 'PRV', 'Containment', 120, ['mold'], 'pass_through', 'cost', 0, 1, 'input', { customerVisible: false }), legacyItem('overhead', 'Overhead', 'Internal', 130, ['water', 'mold'], 'percentage', 'revenue', 0, .33, 'final_total', { percentageBase: 'final_total', customerVisible: false })] }));
export function isPricingConfigRpcUnavailable(error) { const code = error?.code || error?.details?.code; return code === 'PGRST202' || code === '42883' || /could not find (the )?function|function .* does not exist/i.test(String(error?.message || error?.details || '')); }