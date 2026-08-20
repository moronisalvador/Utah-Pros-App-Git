/**
 * ════════════════════════════════════════════════
 * FILE: invoice-pay-session.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the public "pay this invoice" endpoint refuses everything it should —
 *   bad links, dead links, silly amounts, more than is owed — and only reaches
 *   Stripe when every check has passed.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  invoice-pay-session.js with mocked database/Stripe
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This endpoint is reachable by anyone on the internet who holds a token, so
 *     the deny cases matter more than the happy path.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: {}, flagOn: true }));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/stripe.js', () => ({
  stripeConfigured: () => true,
  createCheckoutSession: vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })),
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: vi.fn(() => ({
    select: vi.fn(async (table) => {
      if (table === 'feature_flags') {
        return state.flagOn
          ? [{ key: 'feature:stripe_payment_command_v1', enabled: true, force_disabled: false }]
          : [];
      }
      return state.rows[table] ?? [];
    }),
  })),
}));

import { createCheckoutSession } from '../lib/stripe.js';
import { onRequestPost } from './invoice-pay-session.js';

const TOKEN = '3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const call = (payload) => onRequestPost({
  request: new Request('https://app.test/api/invoice-pay-session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  env: { APP_BASE_URL: 'https://utahpros.app', STRIPE_SECRET_KEY: 'sk_test' },
});

const activeShare = () => ({
  id: 'share-1', invoice_id: 'inv-1', status: 'active',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.flagOn = true;
  state.rows = {
    invoice_shares: [activeShare()],
    invoices: [{
      id: 'inv-1', invoice_number: 'INV-1', qbo_doc_number: 'W-1',
      total: 5182, adjusted_total: null, amount_paid: 1500,
      job_id: 'job-1', contact_id: 'c-1',
    }],
    jobs: [{ id: 'job-1', primary_contact_id: 'c-1' }],
    contacts: [{ id: 'c-1', email: 'ap@example.test' }],
  };
});

describe('input is never trusted', () => {
  it('rejects a malformed token before touching the database', async () => {
    const res = await call({ token: 'not-a-uuid', amount_cents: 1000 });
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    const res = await call({ amount_cents: 1000 });
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects a non-integer, zero, or negative amount', async () => {
    for (const amount_cents of [0, -500, 10.5, NaN, '1000']) {
      const res = await call({ token: TOKEN, amount_cents });
      expect(res.status, `amount ${amount_cents}`).toBe(400);
    }
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an amount below the provider floor', async () => {
    const res = await call({ token: TOKEN, amount_cents: 49 });
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('the link must be alive', () => {
  it('refuses an unknown token', async () => {
    state.rows.invoice_shares = [];
    const res = await call({ token: TOKEN, amount_cents: 1000 });
    expect(res.status).toBe(410);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a revoked link', async () => {
    state.rows.invoice_shares = [{ ...activeShare(), status: 'revoked' }];
    const res = await call({ token: TOKEN, amount_cents: 1000 });
    expect(res.status).toBe(410);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a superseded link — a re-send invalidates the old URL', async () => {
    state.rows.invoice_shares = [{ ...activeShare(), status: 'superseded' }];
    const res = await call({ token: TOKEN, amount_cents: 1000 });
    expect(res.status).toBe(410);
  });

  it('refuses an expired link', async () => {
    state.rows.invoice_shares = [{
      ...activeShare(), expires_at: new Date(Date.now() - 1000).toISOString(),
    }];
    const res = await call({ token: TOKEN, amount_cents: 1000 });
    expect(res.status).toBe(410);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('gives every dead link the SAME message, so it cannot be used as an oracle', async () => {
    const messages = new Set();
    for (const share of [
      null,
      { ...activeShare(), status: 'revoked' },
      { ...activeShare(), expires_at: new Date(Date.now() - 1000).toISOString() },
    ]) {
      state.rows.invoice_shares = share ? [share] : [];
      const res = await call({ token: TOKEN, amount_cents: 1000 });
      messages.add((await res.json()).error);
    }
    expect(messages.size).toBe(1);
  });
});

describe('the amount must be owed', () => {
  it('refuses more than the outstanding balance and says what it is', async () => {
    // total 5182 − paid 1500 = 3682.00 → 368200 cents
    const res = await call({ token: TOKEN, amount_cents: 368201 });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ balance_cents: 368200 });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a fully paid invoice', async () => {
    state.rows.invoices[0].amount_paid = 5182;
    const res = await call({ token: TOKEN, amount_cents: 1000 });
    expect(res.status).toBe(409);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('prefers adjusted_total when present', async () => {
    state.rows.invoices[0].adjusted_total = 2000;
    // 2000 − 1500 = 500.00 → 50000 cents
    const res = await call({ token: TOKEN, amount_cents: 50001 });
    await expect(res.json()).resolves.toMatchObject({ balance_cents: 50000 });
  });

  it('accepts a PARTIAL payment — carriers pay ACV first', async () => {
    const res = await call({ token: TOKEN, amount_cents: 100000 });
    expect(res.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession.mock.calls[0][1].amountCents).toBe(100000);
  });

  it('accepts exactly the balance', async () => {
    const res = await call({ token: TOKEN, amount_cents: 368200 });
    expect(res.status).toBe(200);
  });
});

describe('the happy path', () => {
  it('returns a Checkout URL and sends the customer back to their own page', async () => {
    const res = await call({ token: TOKEN, amount_cents: 100000 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, url: 'https://checkout.stripe.test/cs_1' });

    const args = createCheckoutSession.mock.calls[0][1];
    expect(args.invoiceId).toBe('inv-1');
    expect(args.customerEmail).toBe('ap@example.test');
    // Not into the staff app.
    expect(args.successUrl).toBe(`https://utahpros.app/pay/${TOKEN}?paid=1`);
    expect(args.cancelUrl).toBe(`https://utahpros.app/pay/${TOKEN}`);
  });
});

describe('the feature gate', () => {
  it('refuses while the projection is switched off', async () => {
    state.flagOn = false;
    const res = await call({ token: TOKEN, amount_cents: 100000 });
    expect(res.status).toBe(503);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('failures stay opaque', () => {
  it('never leaks an upstream message to an anonymous caller', async () => {
    createCheckoutSession.mockRejectedValueOnce(
      new Error('Invalid API Key provided: sk_test_abcd1234 for account acct_123'),
    );
    const res = await call({ token: TOKEN, amount_cents: 100000 });

    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/API Key|sk_test|acct_/);
  });
});
