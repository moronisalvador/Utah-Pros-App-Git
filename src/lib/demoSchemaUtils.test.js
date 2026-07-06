/**
 * Unit tests for the Scope Sheet Builder's pure helpers (Settings Overhaul P6).
 * Guards the extraction out of ScopeSheets.jsx and the two-click confirm
 * transition that replaced the page's three window.confirm() calls. Runs in
 * plain node (no jsdom) — every function under test is pure.
 */
import { describe, it, expect } from 'vitest';
import {
  FIELD_TYPES,
  move,
  removeAt,
  replaceAt,
  twoClickNext,
  emptySection,
  emptyField,
  emptySchema,
  walkFields,
  validateSchemaShape,
  summarize,
} from './demoSchemaUtils';

describe('list helpers (immutable)', () => {
  it('move reorders and does not mutate the source', () => {
    const src = ['a', 'b', 'c'];
    expect(move(src, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(move(src, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(src).toEqual(['a', 'b', 'c']); // untouched
  });

  it('move is a no-op when the target index is out of range', () => {
    const src = ['a', 'b'];
    expect(move(src, 0, -1)).toBe(src);
    expect(move(src, 1, 2)).toBe(src);
  });

  it('removeAt drops one index without mutating', () => {
    const src = ['a', 'b', 'c'];
    expect(removeAt(src, 1)).toEqual(['a', 'c']);
    expect(src).toEqual(['a', 'b', 'c']);
  });

  it('replaceAt swaps one index without mutating', () => {
    const src = ['a', 'b', 'c'];
    expect(replaceAt(src, 1, 'X')).toEqual(['a', 'X', 'c']);
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

describe('twoClickNext (two-click confirm transition)', () => {
  it('arms on the first click of a fresh target', () => {
    expect(twoClickNext(null, 'del-1')).toEqual({ commit: false, nextArmed: 'del-1' });
  });

  it('commits on the second click of the same target', () => {
    expect(twoClickNext('del-1', 'del-1')).toEqual({ commit: true, nextArmed: null });
  });

  it('re-arms (does not commit) when a different target is clicked while armed', () => {
    expect(twoClickNext('del-1', 'del-2')).toEqual({ commit: false, nextArmed: 'del-2' });
  });
});

describe('blank-shape factories', () => {
  it('emptySchema is a valid, empty, shippable shape', () => {
    const s = emptySchema();
    expect(s.roomPresets).toEqual([]);
    expect(s.sections).toEqual([]);
    expect(validateSchemaShape(s)).toEqual([]);
  });

  it('emptySection is always-on with a doneFlag and empty fields', () => {
    const sec = emptySection();
    expect(sec.alwaysOn).toBe(true);
    expect(sec.doneFlag).toBeTruthy();
    expect(sec.fields).toEqual([]);
  });

  it('emptyField produces a valid shape for every allowed type', () => {
    for (const t of FIELD_TYPES) {
      const f = emptyField(t);
      expect(f.type).toBe(t);
      // row is layout-only (no key); everything else carries a key
      if (t === 'row') expect(f.fields).toEqual([]);
      else expect(f.key).toBeTruthy();
    }
  });

  it('emptyField defaults to a stepper', () => {
    expect(emptyField().type).toBe('stepper');
  });
});

describe('walkFields', () => {
  it('visits nested row and list itemFields', () => {
    const fields = [
      { key: 'a', type: 'stepper' },
      { type: 'row', cols: 2, fields: [{ key: 'b', type: 'text' }] },
      { key: 'c', type: 'list', itemFields: [{ key: 'd', type: 'checkbox' }] },
    ];
    const keys = [];
    walkFields(fields, (f) => { if (f.key) keys.push(f.key); });
    expect(keys).toEqual(['a', 'b', 'c', 'd']);
  });

  it('tolerates null/undefined field arrays', () => {
    expect(() => walkFields(null, () => {})).not.toThrow();
    expect(() => walkFields(undefined, () => {})).not.toThrow();
  });
});

describe('validateSchemaShape', () => {
  it('accepts a well-formed schema', () => {
    const def = {
      roomPresets: ['Living Room'],
      sections: [
        { key: 's1', label: 'Sec', alwaysOn: true, doneFlag: 's1Done', fields: [
          { key: 'lf', type: 'stepper' },
        ] },
      ],
    };
    expect(validateSchemaShape(def)).toEqual([]);
  });

  it('flags a non-object definition', () => {
    expect(validateSchemaShape(null)).toEqual(['Definition must be an object']);
  });

  it('flags a missing section key/label', () => {
    const errs = validateSchemaShape({ roomPresets: [], sections: [{ alwaysOn: true, doneFlag: 'x', fields: [] }] });
    expect(errs.some(e => e.includes('missing "key"'))).toBe(true);
    expect(errs.some(e => e.includes('missing "label"'))).toBe(true);
  });

  it('requires alwaysOn sections to declare a doneFlag', () => {
    const errs = validateSchemaShape({ roomPresets: [], sections: [{ key: 's', label: 'S', alwaysOn: true, fields: [] }] });
    expect(errs.some(e => e.includes('alwaysOn=true requires a doneFlag'))).toBe(true);
  });

  it('requires gated sections to declare a gateField', () => {
    const errs = validateSchemaShape({ roomPresets: [], sections: [{ key: 's', label: 'S', alwaysOn: false, fields: [] }] });
    expect(errs.some(e => e.includes('alwaysOn=true or a gateField'))).toBe(true);
  });

  it('flags an unknown field type', () => {
    const errs = validateSchemaShape({ roomPresets: [], sections: [
      { key: 's', label: 'S', alwaysOn: true, doneFlag: 'd', fields: [{ key: 'x', type: 'bogus' }] },
    ] });
    expect(errs.some(e => e.includes('unknown type "bogus"'))).toBe(true);
  });

  it('flags a computed field missing formula operands', () => {
    const errs = validateSchemaShape({ roomPresets: [], sections: [
      { key: 's', label: 'S', alwaysOn: true, doneFlag: 'd', fields: [{ key: 'x', type: 'computed', formula: { a: '', b: '' } }] },
    ] });
    expect(errs.some(e => e.includes('needs formula.a and formula.b'))).toBe(true);
  });

  it('validates jobSections only when present', () => {
    const withBad = validateSchemaShape({ roomPresets: [], sections: [], jobSections: [{ alwaysOn: true }] });
    expect(withBad.some(e => e.startsWith('jobSections'))).toBe(true);
    const without = validateSchemaShape({ roomPresets: [], sections: [] });
    expect(without.some(e => e.startsWith('jobSections'))).toBe(false);
  });
});

describe('summarize', () => {
  it('counts sections, fields (incl. nested) and room presets', () => {
    const def = {
      roomPresets: ['A', 'B'],
      sections: [
        { key: 's1', label: 'S1', alwaysOn: true, doneFlag: 'd', fields: [
          { key: 'a', type: 'stepper' },
          { type: 'row', cols: 2, fields: [{ key: 'b', type: 'text' }] },
        ] },
      ],
    };
    expect(summarize(def)).toEqual({ sectionCount: 1, fieldCount: 3, roomPresets: 2 });
  });

  it('is safe on an empty/undefined definition', () => {
    expect(summarize(undefined)).toEqual({ sectionCount: 0, fieldCount: 0, roomPresets: 0 });
  });
});
