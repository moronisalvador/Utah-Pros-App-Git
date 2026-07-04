/**
 * ════════════════════════════════════════════════
 * FILE: useBillingSettings.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Payment Settings save behaves safely: when a save to the server
 *   fails, the screen must put the old value back instead of pretending the new
 *   one stuck. These are money settings, so a silent "looks saved but wasn't"
 *   is the exact bug this guards against.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./useBillingSettings (the makeBillingSave factory under test)
 *   Data:      reads → none · writes → none (pure logic; RPC is stubbed)
 *
 * NOTES / GOTCHAS:
 *   - vitest runs in plain node here (no jsdom), so we test the DOM-free
 *     `makeBillingSave` factory directly against a tiny in-memory state
 *     container that mimics React's setState (value or updater fn).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';
import { makeBillingSave } from './useBillingSettings';

// Minimal React-style state container.
function container(initial) {
  let state = { ...initial };
  return {
    getSettings: () => state,
    setSettings: (u) => { state = typeof u === 'function' ? u(state) : u; },
    peek: () => state,
  };
}

describe('makeBillingSave — revert-on-error', () => {
  it('restores the prior value when the RPC rejects', async () => {
    const c = container({ accept_ach: 'true', surcharge_pct: '3' });
    const rpc = vi.fn().mockRejectedValue(new Error('network down'));
    const onError = vi.fn();
    const save = makeBillingSave({ rpc, getSettings: c.getSettings, setSettings: c.setSettings, onError });

    const ok = await save('accept_ach', false);

    expect(ok).toBe(false);
    expect(rpc).toHaveBeenCalledWith('set_billing_setting', { p_key: 'accept_ach', p_value: 'false' });
    // The failed key is rolled back to its exact prior value...
    expect(c.peek().accept_ach).toBe('true');
    // ...and untouched keys are left alone.
    expect(c.peek().surcharge_pct).toBe('3');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('keeps the new value on a successful save', async () => {
    const c = container({ default_terms: 'net_30' });
    const rpc = vi.fn().mockResolvedValue(null);
    const save = makeBillingSave({ rpc, getSettings: c.getSettings, setSettings: c.setSettings });

    const ok = await save('default_terms', 'net_15');

    expect(ok).toBe(true);
    expect(c.peek().default_terms).toBe('net_15');
  });

  it('applies the optimistic value on screen before the RPC resolves', async () => {
    const c = container({ accept_card: 'false' });
    let resolveRpc;
    const rpc = vi.fn(() => new Promise((res) => { resolveRpc = res; }));
    const save = makeBillingSave({ rpc, getSettings: c.getSettings, setSettings: c.setSettings });

    const p = save('accept_card', true);
    // Optimistic update is visible immediately, before the RPC settles.
    expect(c.peek().accept_card).toBe('true');
    resolveRpc(null);
    await p;
    expect(c.peek().accept_card).toBe('true');
  });

  it('a failed save does not clobber a concurrent unrelated key', async () => {
    // Simulates two saves in flight: the failing one must only revert its own key.
    const c = container({ accept_card: 'false', accept_ach: 'false' });
    const failRpc = vi.fn().mockRejectedValue(new Error('boom'));
    const failing = makeBillingSave({ rpc: failRpc, getSettings: c.getSettings, setSettings: c.setSettings });

    const p = failing('accept_card', true);          // optimistic accept_card='true'
    c.setSettings((cur) => ({ ...cur, accept_ach: 'true' })); // a separate change lands meanwhile
    await p;                                           // accept_card reverts to 'false'

    expect(c.peek().accept_card).toBe('false');       // reverted
    expect(c.peek().accept_ach).toBe('true');          // preserved
  });
});
