/**
 * ════════════════════════════════════════════════
 * FILE: demoSchemaUtils.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pure helper functions for the Scope Sheet Builder page. These are the
 *   little "do the math on a plain object" routines — reorder an item in a
 *   list, make a blank section or field, walk every field to count them, and
 *   check a schema for mistakes before it can be saved. None of them touch the
 *   screen or the database; they just take a value in and hand a value back,
 *   which makes them easy to test on their own.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (utility module)
 *   Rendered by:  n/a
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Extracted from src/pages/settings/ScopeSheets.jsx (Settings Overhaul P6)
 *     so the shape logic is unit-tested in isolation. The page is the ONLY
 *     consumer — the tech-facing renderer (TechDemoSheet / DemoSheetRenderer)
 *     keeps its own copies; do NOT re-point those here (tech surface is out of
 *     P6 scope).
 *   - Every list helper (move/removeAt/replaceAt) returns a NEW array and never
 *     mutates its input, so React state updates stay referentially honest.
 *   - FIELD_TYPES is the single source of truth for allowed field types and is
 *     kept in sync with TechDemoSheet's FieldRenderer.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Constants ──────────────
// Allowed field types (kept in sync with TechDemoSheet's FieldRenderer).
export const FIELD_TYPES = [
  'stepper', 'single-chip', 'multi-chip', 'text', 'textarea',
  'checkbox', 'select', 'list', 'row', 'computed',
];

// ─── SECTION: List helpers (immutable) ──────────────
export function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
export function removeAt(arr, i)        { return arr.slice(0, i).concat(arr.slice(i + 1)); }
export function replaceAt(arr, i, val)  { const next = arr.slice(); next[i] = val; return next; }

// ─── SECTION: Two-click confirm state (pure) ──────────────
// Encodes the "arm on first click, commit on second" decision used for every
// destructive action on the builder (Rule 2 — no window.confirm). Given the
// currently-armed key and the key just clicked, it returns whether to run the
// action now and what the next armed key should be. Kept here (not inline) so
// the conversion is unit-testable in plain node (no jsdom in this repo).
//   twoClickNext(armed, target) → { commit: boolean, nextArmed: string|null }
export function twoClickNext(armedKey, targetKey) {
  if (armedKey === targetKey) return { commit: true, nextArmed: null };
  return { commit: false, nextArmed: targetKey };
}

// ─── SECTION: Blank-shape factories ──────────────
export function emptySection() {
  return {
    key: `section${Date.now()}`,
    label: 'New section',
    icon: '✨',
    alwaysOn: true,
    doneFlag: `section${Date.now()}Done`,
    fields: [],
  };
}

export function emptyField(type = 'stepper') {
  const base = { key: `field${Date.now()}`, label: 'New field', type };
  switch (type) {
    case 'stepper':     return { ...base, unit: '', step: 1, small: true };
    case 'single-chip': return { ...base, options: ['Option A', 'Option B'], cols: 2 };
    case 'multi-chip':  return { ...base, options: ['Option A', 'Option B'] };
    case 'text':        return { ...base, placeholder: '' };
    case 'textarea':    return { ...base, placeholder: '', rows: 3 };
    case 'checkbox':    return base;
    case 'select':      return { ...base, options: ['', 'Option A', 'Option B'] };
    case 'list':        return { ...base, addLabel: 'Add item', itemLabel: 'Item', defaultItem: {}, itemFields: [] };
    case 'row':         return { type: 'row', cols: 2, fields: [] };
    case 'computed':    return { ...base, formula: { op: 'multiply', a: '', b: '' }, unit: '', summaryKey: '' };
    default:            return base;
  }
}

export function emptySchema() {
  return { version: 1, name: 'New schema', roomPresets: [], sections: [] };
}

// ─── SECTION: Traversal ──────────────
export function walkFields(fields, fn, basePath = '') {
  (fields || []).forEach((f, i) => {
    const path = `${basePath}[${i}]${f.key ? `:${f.key}` : (f.type === 'row' ? ':row' : '')}`;
    fn(f, path);
    if (f.type === 'row')  walkFields(f.fields, fn, path);
    if (f.type === 'list') walkFields(f.itemFields || [], fn, path + '.itemFields');
  });
}

// ─── SECTION: Validation ──────────────
export function validateSchemaShape(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['Definition must be an object'];
  if (!Array.isArray(def.roomPresets)) errors.push('roomPresets must be an array of strings');
  if (!Array.isArray(def.sections))    errors.push('sections must be an array');

  // Validates one section (used for both per-room `sections` and job-level
  // `jobSections`). `group` is the array name used in error prefixes.
  const validateSection = (s, i, group) => {
    if (!s.key)   errors.push(`${group}[${i}]: missing "key"`);
    if (!s.label) errors.push(`${group}[${i}]: missing "label"`);
    if (!s.alwaysOn && !s.gateField) {
      errors.push(`${group}[${i}] (${s.key || 'unnamed'}): must have alwaysOn=true or a gateField`);
    }
    if (s.alwaysOn && !s.doneFlag) {
      errors.push(`${group}[${i}] (${s.key || 'unnamed'}): alwaysOn=true requires a doneFlag`);
    }
    if (!Array.isArray(s.fields)) errors.push(`${group}[${i}] (${s.key || 'unnamed'}): fields must be an array`);
    walkFields(s.fields || [], (f, path) => {
      if (f.type === 'row') {
        if (!Array.isArray(f.fields)) errors.push(`${group}${path}: row must have a "fields" array`);
        if (typeof f.cols !== 'number') errors.push(`${group}${path}: row missing numeric "cols"`);
        return;
      }
      if (!f.key) errors.push(`${group}${path}: missing "key"`);
      if (!f.type) errors.push(`${group}${path}: missing "type"`);
      else if (!FIELD_TYPES.includes(f.type)) errors.push(`${group}${path}: unknown type "${f.type}"`);
      if (f.type === 'list' && !Array.isArray(f.itemFields)) {
        errors.push(`${group}${path}: list field needs "itemFields"`);
      }
      if (f.type === 'computed') {
        if (!f.formula || !f.formula.a || !f.formula.b) {
          errors.push(`${group}${path}: computed field needs formula.a and formula.b (sibling field keys)`);
        }
      }
    });
  };

  (def.sections || []).forEach((s, i) => validateSection(s, i, 'sections'));

  // jobSections is OPTIONAL (v1 schemas don't have it). Only validate when present.
  if (def.jobSections !== undefined) {
    if (!Array.isArray(def.jobSections)) errors.push('jobSections must be an array');
    else (def.jobSections).forEach((s, i) => validateSection(s, i, 'jobSections'));
  }
  return errors;
}

// ─── SECTION: Summary ──────────────
export function summarize(def) {
  const sections = def?.sections || [];
  let fieldCount = 0;
  sections.forEach(s => walkFields(s.fields || [], () => { fieldCount++; }));
  return {
    sectionCount: sections.length,
    fieldCount,
    roomPresets: (def?.roomPresets || []).length,
  };
}
