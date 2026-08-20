/**
 * ════════════════════════════════════════════════
 * FILE: stripe-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the Stripe listener as text and checks the handful of rules that keep
 *   money correct: a bank payment that has not settled is never recorded as
 *   paid, a bounced bank payment is treated as money leaving, the totals the
 *   database calculates for itself are never overwritten, and every request to
 *   QuickBooks carries a repeat-proof reference.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  stripe-webhook.js (read as source)
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - **This file replaced a containment contract.** Until 2026-08-20 it asserted
 *     the worker was a stub containing no `payments`, `quickbooks` or `supabase`
 *     reference at all. That premise is gone: the projection is restored behind
 *     `feature:stripe_payment_command_v1`, which ships disabled. The refusal
 *     behaviour that contract protected is still pinned — see
 *     stripe-webhook-maintenance.test.js, which exercises the closed gate.
 *   - Source contract only: it sends no webhook and contacts nothing.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('./stripe-webhook.js', import.meta.url)), 'utf8');

/** The body of a named function, for assertions that must not leak across handlers. */
const fnBody = (name) => {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  const next = src.indexOf('\nasync function ', start + 1);
  const end = next === -1 ? src.indexOf('\nexport async function onRequestPost', start + 1) : next;
  return src.slice(start, end === -1 ? undefined : end);
};

describe('the signature is still the front door', () => {
  it('verifies the raw body and refuses a bad signature distinctly', () => {
    expect(src).toMatch(/constructEvent\(rawBody, sig, env\.STRIPE_WEBHOOK_SECRET\)/);
    expect(src).toMatch(/stripe_webhook_invalid/);
    expect(src).toMatch(/}, 400, request, env\)/);
  });
});

describe('the gate comes before anything that costs money', () => {
  it('consults the flag before the event is claimed', () => {
    const gateIdx = src.indexOf('requireStripePaymentCommandV1');
    const claimIdx = src.indexOf('claim_stripe_event');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(claimIdx);
  });

  it('keeps the containment refusal code, so Stripe still retries', () => {
    expect(src).toMatch(/stripe_projection_durable_boundary_required|STRIPE_PROJECTION_DURABLE_BOUNDARY_REQUIRED/);
  });
});

describe('an unsettled ACH is never money', () => {
  it('handles payment_intent.processing at all', () => {
    expect(src).toMatch(/case 'payment_intent\.processing'/);
  });

  it('the processing handler NEVER inserts a payments row', () => {
    // payments has no status column, and update_invoice_paid() fires on INSERT —
    // a row here would mark the invoice paid days before the funds settle, and an
    // ACH that later bounces would leave it that way.
    const body = fnBody('handleAchProcessing');
    expect(body).not.toMatch(/db\.insert\(/);
    expect(body).not.toMatch(/'payments'/);
    expect(body).toMatch(/pending_settlement/);
  });

  it('only a fresh reservation is moved to pending, never a finished one', () => {
    // Stripe events can arrive out of order; a late `processing` must not walk
    // back a command that already succeeded.
    expect(fnBody('handleAchProcessing')).toMatch(/cmd\.status === 'prepared'/);
  });
});

describe('a late ACH failure is money leaving, not a disagreement', () => {
  it('recognises the three bank-return reasons', () => {
    for (const reason of ['insufficient_funds', 'incorrect_account_details', 'bank_cannot_process']) {
      expect(src, `must handle ${reason}`).toContain(reason);
    }
  });

  it('the dispute handler reverses the QuickBooks payment either way', () => {
    const body = fnBody('handleDispute');
    expect(body).toMatch(/reversePaymentInQbo/);
    expect(body).toMatch(/refunded_amount/);
    // And records WHICH it was, so a human need not go to Stripe to find out.
    expect(body).toMatch(/ach_return/);
  });
});

describe('the database owns its own totals', () => {
  it('never writes a trigger-owned or generated column', () => {
    // update_invoice_paid() owns these. balance_due and line_total are GENERATED.
    for (const col of [
      'amount_paid', 'balance_due', 'insurance_paid', 'homeowner_paid',
      'paid_at', 'collected_value', 'ar_status',
    ]) {
      expect(src, `must not write ${col}`).not.toMatch(new RegExp(`${col}\\s*:`));
    }
  });

  it('never updates the invoices table directly', () => {
    expect(src).not.toMatch(/db\.update\(\s*'invoices'/);
  });

  it('reverses money by netting refunded_amount, never by deleting a payment', () => {
    // payments forbids amount <= 0, so there is no negative row; and deleting
    // would erase the record that the payment ever happened.
    expect(src).not.toMatch(/db\.delete\(\s*'payments'/);
    expect(fnBody('reversePaymentInQbo')).toMatch(/refunded_amount|qbo_payment_id: null/);
  });
});

describe('who paid is derived, not assumed', () => {
  it('reads payer_type from the invoice', () => {
    // Hardcoding this — as the pre-containment version did with 'homeowner' —
    // books every carrier payment as homeowner money, silently corrupting the
    // insurance/homeowner split that update_invoice_paid() computes from it.
    expect(src).toMatch(/function payerTypeForInvoice/);
    expect(src).toMatch(/payer_type: payerTypeForInvoice\(inv\)/);
    expect(src).not.toMatch(/payer_type:\s*'homeowner'/);
  });

  it('maps every billed_to value the invoice constraint allows', () => {
    const body = src.slice(src.indexOf('function payerTypeForInvoice'));
    for (const v of ['insurance', 'homeowner', 'property_manager']) {
      expect(body).toContain(`'${v}'`);
    }
  });
});

describe('every provider write carries a repeat-proof reference', () => {
  it('passes the frozen requestId to the payment, the fee and the payout', () => {
    // Intuit dedups on requestid. A retry without it creates a second Payment,
    // Purchase or Transfer rather than being recognised as the same request.
    expect(src).toMatch(/createPayment\(env, \{[\s\S]*?requestId: cmd\.provider_request_id/);
    expect(src).toMatch(/createPurchase\(env, \{[\s\S]*?requestId: feeCmd\.provider_request_id/);
    expect(src).toMatch(/createTransfer\(env, \{[\s\S]*?requestId: cmd\.provider_request_id/);
  });

  it('classifies an ambiguous failure rather than assuming it failed', () => {
    expect(src).toMatch(/classifyProviderFailure/);
  });

  it('adopts an already-succeeded command instead of pushing twice', () => {
    expect(src).toMatch(/status === 'succeeded' && cmd\.provider_target_id/);
    expect(src).toMatch(/status === 'succeeded' && feeCmd\.provider_target_id/);
  });
});
