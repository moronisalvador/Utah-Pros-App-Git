/**
 * ════════════════════════════════════════════════
 * FILE: PaymentSheet.render.test.jsx  (Admin Mobile — payment sheet smoke test)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the record-payment form actually draws on screen: the amount box
 *   starts pre-filled with what's still owed, the choice buttons show up, and
 *   the Save button starts UN-armed (a second, deliberate tap is required
 *   before any money is written).
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom (renderToStaticMarkup — no jsdom here)
 *   Internal:  ./PaymentSheet
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PaymentSheet from './PaymentSheet';

describe('PaymentSheet render', () => {
  it('pre-fills the outstanding balance and shows the form fields', () => {
    const out = renderToStaticMarkup(
      <PaymentSheet balance={649.5} busy={false} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain('Record payment');
    expect(out).toContain('649.50');       // amount pre-filled from balance
    expect(out).toContain('Insurance');    // payer chips
    expect(out).toContain('Check');        // method chips
    expect(out).toContain('Save payment'); // NOT the armed "Confirm — record …" label
    expect(out).not.toContain('Confirm — record');
  });

  it('leaves the amount empty when nothing is owed', () => {
    const out = renderToStaticMarkup(
      <PaymentSheet balance={0} busy={false} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(out).toContain('placeholder="0.00"');
    expect(out).not.toContain('value="0.00"');
  });
});
