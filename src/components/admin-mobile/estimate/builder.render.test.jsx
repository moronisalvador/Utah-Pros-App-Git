/**
 * ════════════════════════════════════════════════
 * FILE: builder.render.test.jsx  (Admin Mobile — P4b builder smoke test)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the estimate builder's pieces actually draw on screen: the new-
 *   estimate form opens on the customer search, a line-item card shows its
 *   pickers, description, quantity/rate boxes and live amount, and the remove
 *   button starts UN-armed (a second, deliberate tap is required before a
 *   line is deleted).
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom (renderToStaticMarkup — no jsdom here)
 *   Internal:  ./EstimateCreateForm, ./LineItemCard, ./CatalogPicker
 *   Data:      reads → none · writes → none (db is stubbed)
 *
 * NOTES / GOTCHAS:
 *   - Static render only (no jsdom): effects never run, so the stub db is never
 *     actually called — these tests pin initial-state markup, not behavior.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EstimateCreateForm from './EstimateCreateForm';
import LineItemCard from './LineItemCard';
import CatalogPicker from './CatalogPicker';

const stubDb = { rpc: async () => [], select: async () => [], insert: async () => [] };

describe('EstimateCreateForm render', () => {
  it('opens on the customer search with the add-new escape hatch', () => {
    const out = renderToStaticMarkup(
      <EstimateCreateForm db={stubDb} employee={{ id: 'emp-1' }} onCreated={() => {}} onOpenExisting={() => {}} />,
    );
    expect(out).toContain('Customer');
    expect(out).toContain('Search name, phone, or email');
    expect(out).toContain('New customer');
    expect(out).not.toContain('Create estimate'); // CTA only appears once a customer is chosen
  });
});

describe('LineItemCard render', () => {
  const line = {
    id: 'l-1', description: 'Demo drywall', quantity: 2, unit_price: 125.5, line_total: 251,
    qbo_item_id: '42', qbo_item_name: 'Labor', qbo_class_id: null, qbo_class_name: null,
  };

  it('shows pickers, description, qty/rate and the line amount', () => {
    const out = renderToStaticMarkup(
      <LineItemCard
        line={line} index={0}
        items={[{ id: '42', name: 'Labor' }]} classes={[]}
        busy={false} onPatch={() => {}} onCommit={() => {}} onRemove={() => {}}
      />,
    );
    expect(out).toContain('Line 1');
    expect(out).toContain('Labor');            // selected item name
    expect(out).toContain('Demo drywall');
    expect(out).toContain('251.00');           // line amount from line_total
    expect(out).toContain('>Remove<');         // remove starts UN-armed
    expect(out).not.toContain('Tap again to remove');
  });
});

describe('CatalogPicker render', () => {
  it('starts collapsed with a placeholder and disables without options', () => {
    const out = renderToStaticMarkup(
      <CatalogPicker label="Item" value="" valueName="" options={[]} disabled onChange={() => {}} />,
    );
    expect(out).toContain('disabled');
    expect(out).not.toContain('am-estb-picker-drop'); // no dropdown until tapped
  });
});
