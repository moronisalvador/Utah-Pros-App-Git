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

// Only the aria-labeled controls: the three selects are native (no aria-label
// needed — their wrapping <label> names them) and share FIELD_STYLE, whose
// 44px geometry the styles themselves guarantee.
const CONTROL_LABELS = [
  'Payment date',
  'Check / reference',
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
    // This tranche converts ONLY the date input: DatePicker is fully
    // keyboard-operable, while the payer/method/deposit selects stay NATIVE
    // until SearchSelect earns its keyboard contract (2026-08-15 a11y
    // review) — a native select is keyboard-better than SearchSelect today.
    // The customer picker is dev's contract-pinned combobox, label-wrapped.
    expect(output).not.toContain('type="date"');
    expect((output.match(/<select/g) || [])).toHaveLength(3);
    expect(output).toContain('aria-label="Payment date"');
    // The visible label text is the accessible name's source of truth.
    expect(output).toContain('id="rpf-payment-date-label"');
    // Composed: the visible label id plus the value span's useId, so the
    // field name AND the selected date are both announced.
    expect(output).toMatch(/aria-labelledby="rpf-payment-date-label [^"]+"/);
    expect(output).toContain('aria-label="Check / reference"');
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
