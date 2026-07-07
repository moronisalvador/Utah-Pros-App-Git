/**
 * Render smoke-test for the Admin Mobile record-payment sheet. Uses
 * renderToStaticMarkup (no jsdom — vitest runs in plain node here) to prove
 * the real component mounts with the balance pre-filled and its Save button
 * starting in the UN-armed state (the two-click confirm needs a second,
 * deliberate tap before any money is written).
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
