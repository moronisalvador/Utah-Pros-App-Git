/**
 * ════════════════════════════════════════════════
 * FILE: stripe-payment-commands.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the helper that records Stripe accounting actions: that the request
 *   number it gives QuickBooks is the same every time for the same action, that
 *   a lost connection is treated as "might have worked" rather than "failed",
 *   and that it always talks to the database through the locked-down routines.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  stripe-payment-commands.js
 *   Data:      reads  → none (the database client is mocked)
 *              writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import {
  STRIPE_COMMAND_ACTIONS,
  stableJsonStringify,
  hashStripeCommandIntent,
  deriveStripeRequestId,
  reserveStripePaymentCommand,
  startStripePaymentCommand,
  finalizeStripePaymentCommand,
  getStripePaymentCommand,
  isTerminalStripeCommand,
  classifyProviderFailure,
} from './stripe-payment-commands.js';

const dbStub = (rpcImpl = vi.fn(async () => ({ id: 'cmd-1', status: 'prepared' }))) => ({ rpc: rpcImpl });

describe('deriveStripeRequestId', () => {
  it('is deterministic — the whole point, since Intuit dedups on it', async () => {
    const args = { stripeObjectId: 'ch_123', action: 'record_payment', realmId: '9341453160223706' };
    const a = await deriveStripeRequestId(args);
    const b = await deriveStripeRequestId(args);
    expect(a).toBe(b);
  });

  it('differs per action, so booking the fee is not mistaken for the payment', async () => {
    const base = { stripeObjectId: 'ch_123', realmId: '934' };
    const pay = await deriveStripeRequestId({ ...base, action: 'record_payment' });
    const fee = await deriveStripeRequestId({ ...base, action: 'book_fee' });
    expect(pay).not.toBe(fee);
  });

  it('differs per charge and per realm', async () => {
    const a = await deriveStripeRequestId({ stripeObjectId: 'ch_1', action: 'record_payment', realmId: '934' });
    const b = await deriveStripeRequestId({ stripeObjectId: 'ch_2', action: 'record_payment', realmId: '934' });
    const c = await deriveStripeRequestId({ stripeObjectId: 'ch_1', action: 'record_payment', realmId: '999' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('stays inside Intuit\'s 50-character requestid limit', async () => {
    for (const action of STRIPE_COMMAND_ACTIONS) {
      const id = await deriveStripeRequestId({ stripeObjectId: 'ch_'.padEnd(80, 'x'), action, realmId: '9341453160223706' });
      expect(id.length).toBeLessThanOrEqual(50);
      expect(id.startsWith('upr-s-')).toBe(true);
    }
  });

  it('refuses an unknown action rather than inventing a code', async () => {
    await expect(deriveStripeRequestId({ stripeObjectId: 'ch_1', action: 'nope', realmId: '1' }))
      .rejects.toThrow(/Unknown Stripe command action/);
  });
});

describe('intent hashing', () => {
  it('is insensitive to key order — a jsonb readback reorders keys', async () => {
    const a = await hashStripeCommandIntent({ amount: 100, invoice: 'i1', nested: { b: 2, a: 1 } });
    const b = await hashStripeCommandIntent({ nested: { a: 1, b: 2 }, invoice: 'i1', amount: 100 });
    expect(a).toBe(b);
  });

  it('changes when a value changes', async () => {
    const a = await hashStripeCommandIntent({ amount: 100 });
    const b = await hashStripeCommandIntent({ amount: 100.01 });
    expect(a).not.toBe(b);
  });

  it('sorts arrays\' contents recursively without reordering the array itself', () => {
    expect(stableJsonStringify({ xs: [{ b: 1, a: 2 }] })).toBe('{"xs":[{"a":2,"b":1}]}');
    expect(stableJsonStringify({ xs: [2, 1] })).toBe('{"xs":[2,1]}');
  });
});

describe('classifyProviderFailure', () => {
  it('treats a definitive 4xx as rejected', () => {
    expect(classifyProviderFailure({ status: 400 })).toBe('rejected');
    expect(classifyProviderFailure({ status: 403 })).toBe('rejected');
  });

  it('treats a timeout, rate-limit, 5xx or network drop as AMBIGUOUS', () => {
    // The call may have landed and we never saw the answer. Marking these
    // rejected and retrying with a fresh id is how a duplicate QuickBooks
    // Payment gets created.
    expect(classifyProviderFailure({ status: 408 })).toBe('ambiguous');
    expect(classifyProviderFailure({ status: 429 })).toBe('ambiguous');
    expect(classifyProviderFailure({ status: 500 })).toBe('ambiguous');
    expect(classifyProviderFailure({ status: 503 })).toBe('ambiguous');
    expect(classifyProviderFailure(new Error('network'))).toBe('ambiguous');
    expect(classifyProviderFailure(undefined)).toBe('ambiguous');
  });
});

describe('isTerminalStripeCommand', () => {
  it('only succeeded and rejected are terminal', () => {
    expect(isTerminalStripeCommand({ status: 'succeeded' })).toBe(true);
    expect(isTerminalStripeCommand({ status: 'rejected' })).toBe(true);
    for (const status of ['prepared', 'pending_settlement', 'provider_started', 'ambiguous', 'needs_reconciliation']) {
      expect(isTerminalStripeCommand({ status })).toBe(false);
    }
    expect(isTerminalStripeCommand(null)).toBe(false);
  });
});

describe('RPC plumbing', () => {
  it('reserves through the service-only RPC, passing the frozen id and hash', async () => {
    const rpc = vi.fn(async () => ({ id: 'cmd-1', status: 'prepared' }));
    const row = await reserveStripePaymentCommand(dbStub(rpc), {
      stripeObjectId: 'ch_1',
      stripeEventId: 'evt_1',
      action: 'record_payment',
      realmId: '934',
      intent: { amount_cents: 100000 },
      invoiceId: 'inv-1',
    });

    expect(row).toEqual({ id: 'cmd-1', status: 'prepared' });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0];
    expect(fn).toBe('reserve_stripe_payment_command');
    expect(params.p_stripe_object_id).toBe('ch_1');
    expect(params.p_action).toBe('record_payment');
    expect(params.p_stripe_event_id).toBe('evt_1');
    expect(params.p_invoice_id).toBe('inv-1');
    expect(params.p_provider_request_id).toMatch(/^upr-s-p-[0-9a-f]{40}$/);
    expect(params.p_intent_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an unknown action before touching the database', async () => {
    const rpc = vi.fn();
    await expect(reserveStripePaymentCommand(dbStub(rpc), {
      stripeObjectId: 'ch_1', action: 'drain_bank', realmId: '1', intent: {},
    })).rejects.toThrow(/Unknown Stripe command action/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('unwraps a PostgREST array response', async () => {
    const rpc = vi.fn(async () => [{ id: 'cmd-9', status: 'succeeded' }]);
    await expect(getStripePaymentCommand(dbStub(rpc), { stripeObjectId: 'ch_1', action: 'book_fee' }))
      .resolves.toEqual({ id: 'cmd-9', status: 'succeeded' });
  });

  it('truncates a long error rather than letting the write fail', async () => {
    const rpc = vi.fn(async () => ({ id: 'cmd-1' }));
    await finalizeStripePaymentCommand(dbStub(rpc), 'cmd-1', {
      status: 'ambiguous',
      error: 'x'.repeat(900),
    });
    expect(rpc.mock.calls[0][1].p_error).toHaveLength(500);
  });

  it('passes a null error through as null, not the string "null"', async () => {
    const rpc = vi.fn(async () => ({ id: 'cmd-1' }));
    await finalizeStripePaymentCommand(dbStub(rpc), 'cmd-1', { status: 'succeeded' });
    expect(rpc.mock.calls[0][1].p_error).toBeNull();
  });

  it('starts a command by id', async () => {
    const rpc = vi.fn(async () => ({ id: 'cmd-1', status: 'provider_started' }));
    await startStripePaymentCommand(dbStub(rpc), 'cmd-1');
    expect(rpc).toHaveBeenCalledWith('start_stripe_payment_command', { p_command_id: 'cmd-1' });
  });
});
