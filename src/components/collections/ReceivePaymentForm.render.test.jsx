/**
 * ════════════════════════════════════════════════
 * FILE: ReceivePaymentForm.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the payment review form shows the trusted QuickBooks choices,
 *   open balances, and review step before anyone can confirm a payment.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom
 *   Internal:  ReceivePaymentForm
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - This is a server-rendered smoke test; interaction rules live in the exact
 *     cents and retry-identity helper tests.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ReceivePaymentForm from './ReceivePaymentForm';

const CONTROL_LABELS = [
  'Customer',
  'Payment date',
  'Paid by',
  'Method',
  'Check / reference',
  'Deposit to',
];

function expectUniformPaymentControls(output) {
  CONTROL_LABELS.forEach((label) => {
    const control = output.match(new RegExp(`<(?:button|input)[^>]*aria-label="${label}"[^>]*>`))?.[0];
    expect(control, `${label} control`).toBeTruthy();
    expect(control).toContain('height:44px');
    expect(control).toContain('min-height:44px');
    expect(control).toContain('box-sizing:border-box');
  });
}

describe('ReceivePaymentForm', () => {
  it('renders canonical QBO options, invoice balances, and the review gate', () => {
    const output = renderToStaticMarkup(<ReceivePaymentForm
      data={{
        contact: { id: 'contact-1', name: 'Stuart Hernandez' },
        payment_methods: [{ id: 'pm-check', name: 'Check', type: 'check' }],
        deposit_accounts: [{ id: 'bank-1', name: 'Operating 2227', account_type: 'Bank' }],
        invoices: [{ id: 'invoice-1', invoice_number: 'INV-1001', balance_cents: 644007 }],
      }}
      prefillInvoice="invoice-1"
      onSubmit={vi.fn()}
      onSelectContact={vi.fn()}
      submitting={false}
    />);
    expect(output).toContain('Stuart Hernandez');
    expect(output).toContain('Choose method');
    expect(output).toContain('Choose account');
    expect(output).toContain('INV-1001');
    expect(output).toContain('$6,440.07');
    expect(output).toContain('Review payment');
    expect(output).not.toContain('Confirm $');
    expect(output).not.toContain('<select');
    expect(output).not.toContain('type="date"');
    expect(output).toContain('aria-label="Customer"');
    expect(output).toContain('aria-label="Payment date"');
    expect(output).toContain('aria-label="Paid by"');
    expect(output).toContain('aria-label="Method"');
    expect(output).toContain('aria-label="Check / reference"');
    expect(output).toContain('aria-label="Deposit to"');
    expectUniformPaymentControls(output);
    expect(output).toMatch(/class="coll-ghost"[^>]*disabled=""/);
  });

  it('disables the payment actions while a payment is submitting', () => {
    const output = renderToStaticMarkup(<ReceivePaymentForm
      data={{
        contact: { id: 'contact-1', name: 'Stuart Hernandez' },
        payment_methods: [{ id: 'pm-check', name: 'Check', type: 'check' }],
        deposit_accounts: [{ id: 'bank-1', name: 'Operating 2227', account_type: 'Bank' }],
        invoices: [{ id: 'invoice-1', invoice_number: 'INV-1001', balance_cents: 644007 }],
      }}
      prefillInvoice="invoice-1"
      onSubmit={vi.fn()}
      onSelectContact={vi.fn()}
      submitting
    />);
    expect(output).toMatch(/class="coll-ghost"[^>]*disabled=""/);
    expect(output).toMatch(/class="coll-primary"[^>]*disabled=""/);
    expect(output).toContain('Saving…');
  });

  it('disarms a pending review when focus leaves the card or confirm button', () => {
    const source = readFileSync(new URL('./ReceivePaymentForm.jsx', import.meta.url), 'utf8');
    expect(source).toContain('onBlur={(event) =>');
    expect(source).toContain('shouldDisarmReviewOnBlur(event.currentTarget, event.relatedTarget)');
    expect(source).toContain('<PrimaryButton onBlur={() => { if (armed) setArmed(false); }}');
  });
});
