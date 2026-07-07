/**
 * ════════════════════════════════════════════════
 * FILE: estimateBuilder.test.js  (Admin Mobile — P4b named builder tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile estimate builder can't corrupt estimate money math:
 *   the "create estimate" call sends exactly the fields the database function
 *   expects (nothing invented, nothing missing), and every line-item write
 *   never touches line_total — the database computes that column itself, and
 *   writing it would be rejected (or worse, drift the totals).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./estimateBuilder (buildCreateEstimatePayload / line writes / catalog)
 *   Data:      reads → none · writes → none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - These are the NAMED tests bound by the Phase P4b block in
 *     docs/admin-mobile-roadmap.md — do not weaken them.
 *   - Plain-node vitest (no jsdom): the module is DOM-free by design.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  CREATE_ESTIMATE_PARAMS,
  LINE_SAFE_COLUMNS,
  buildCreateEstimatePayload,
  buildLineInsert,
  buildLineUpdate,
  parseQboCatalog,
  computeTotals,
} from './estimateBuilder';

const CONTACT = { id: 'c-1', name: 'Jane Doe' };
const ADDR = { address: '12 Elm St', city: 'Lehi', state: 'UT', zip: '84043' };

describe('create-shell payload (named P4b test)', () => {
  it('sends exactly the create_estimate_for_contact params — no extra keys, none missing', () => {
    const p = buildCreateEstimatePayload({
      contactId: CONTACT.id, division: 'mold', estimateType: 'supplement', addr: ADDR, createdBy: 'emp-1',
    });
    expect(Object.keys(p).sort()).toEqual([...CREATE_ESTIMATE_PARAMS].sort());
    expect(p.p_contact_id).toBe('c-1');
    expect(p.p_intended_division).toBe('mold');
    expect(p.p_estimate_type).toBe('supplement');
    expect(p.p_property_address).toBe('12 Elm St');
    expect(p.p_property_city).toBe('Lehi');
    expect(p.p_property_state).toBe('UT');
    expect(p.p_property_zip).toBe('84043');
    expect(p.p_created_by).toBe('emp-1');
  });

  it('empty address parts become null (worker-side DEFAULTs stay meaningful)', () => {
    const p = buildCreateEstimatePayload({
      contactId: CONTACT.id, division: 'water', estimateType: 'initial',
      addr: { address: '  ', city: '', state: '', zip: '' }, createdBy: null,
    });
    expect(p.p_property_address).toBeNull();
    expect(p.p_property_city).toBeNull();
    expect(p.p_property_state).toBeNull();
    expect(p.p_property_zip).toBeNull();
    expect(p.p_created_by).toBeNull();
  });

  it('defaults division to water and type to initial when omitted', () => {
    const p = buildCreateEstimatePayload({ contactId: CONTACT.id, addr: {} });
    expect(p.p_intended_division).toBe('water');
    expect(p.p_estimate_type).toBe('initial');
  });
});

describe('line-item write excludes line_total (named P4b test)', () => {
  it('the new-line insert never carries line_total (GENERATED column)', () => {
    const ins = buildLineInsert('est-1', 3);
    expect(ins).not.toHaveProperty('line_total');
    expect(ins).toEqual({ estimate_id: 'est-1', description: '', quantity: 1, unit_price: 0, sort_order: 3 });
  });

  it('the line update writes only the safe editable columns — exact keys', () => {
    const upd = buildLineUpdate({
      id: 'l-1', estimate_id: 'est-1', line_total: 999, created_at: 'x', sort_order: 0,
      description: 'Demo drywall', xactimate_code: null,
      qbo_item_id: '42', qbo_item_name: 'Labor', qbo_class_id: '7', qbo_class_name: 'Water',
      quantity: '2', unit_price: '125.5',
    });
    expect(Object.keys(upd).sort()).toEqual([...LINE_SAFE_COLUMNS].sort());
    expect(upd).not.toHaveProperty('line_total');
    expect(upd).not.toHaveProperty('id');
    expect(upd).not.toHaveProperty('estimate_id');
    expect(upd.quantity).toBe(2);
    expect(upd.unit_price).toBe(125.5);
  });

  it('belt-and-braces: the frozen safe list itself never contains line_total', () => {
    expect(LINE_SAFE_COLUMNS).not.toContain('line_total');
    expect(CREATE_ESTIMATE_PARAMS).not.toContain('line_total');
  });

  it('missing QBO fields are written as null (clearing a picker really clears it)', () => {
    const upd = buildLineUpdate({ id: 'l-1', description: '', quantity: null, unit_price: undefined });
    expect(upd.qbo_item_id).toBeNull();
    expect(upd.qbo_item_name).toBeNull();
    expect(upd.qbo_class_id).toBeNull();
    expect(upd.qbo_class_name).toBeNull();
    expect(upd.quantity).toBe(0);
    expect(upd.unit_price).toBe(0);
  });
});

describe('QBO catalog parsing (/api/qbo-query, call-only)', () => {
  it('drops Category items — QBO rejects estimates that reference a category', () => {
    const { items } = parseQboCatalog(
      { Item: [{ Id: 1, Name: 'Labor', Type: 'Service' }, { Id: 2, Name: 'Materials', Type: 'Category' }] },
      { Class: [{ Id: 9, Name: 'Water' }] },
    );
    expect(items).toEqual([{ id: '1', name: 'Labor' }]);
  });

  it('normalizes ids to strings and survives an empty response', () => {
    const { items, classes } = parseQboCatalog({}, {});
    expect(items).toEqual([]);
    expect(classes).toEqual([]);
    const parsed = parseQboCatalog({ Item: [] }, { Class: [{ Id: 3, Name: 'Fire' }] });
    expect(parsed.classes).toEqual([{ id: '3', name: 'Fire' }]);
  });
});

describe('running totals', () => {
  it('uses the DB line_total when present and falls back to qty × rate', () => {
    const { subtotal, total } = computeTotals([
      { line_total: 100 },
      { line_total: null, quantity: 2, unit_price: 25.25 },
    ]);
    expect(subtotal).toBe(150.5);
    expect(total).toBe(150.5);
  });

  it('is 0 for no lines', () => {
    expect(computeTotals([]).total).toBe(0);
  });
});
