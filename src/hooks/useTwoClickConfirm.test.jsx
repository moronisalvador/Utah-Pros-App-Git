// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: useTwoClickConfirm.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that tapping a delete button twice by accident — one quick
 *   double-tap, the way anyone's thumb slips on a phone — does NOT delete
 *   anything. Until 2026-08-19 it did, on every destructive button in the app.
 *
 * WHY IT EXISTS:
 *   The two-click confirm's entire justification is that it is harder to trigger
 *   by accident than a dialog. That claim was never tested, and it was false: the
 *   hook armed and became confirmable in the same tick, so the second half of a
 *   double-tap ran the action. The owner guessed it ("can be accidentally hit")
 *   before any test did.
 *
 *   This renders the hook the way real callers use it and fires real clicks,
 *   rather than asserting on the hook's internals — the defect lived in the gap
 *   between the hook and the caller's ternary, which a unit test of `arm()`
 *   alone would have sailed past.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTwoClickConfirm } from './useTwoClickConfirm';

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.useRealTimers();
});

/** The canonical caller shape from the hook's own usage note. */
function DeleteButton({ onDelete, armDelayMs = 350 }) {
  // Tests opt IN, because the hook defaults to 0 until the 13 call sites are
  // migrated — see the hook's header. `armDelayMs={0}` below is the default
  // path every shipped caller is on today.
  const { isArmed, isPending, arm } = useTwoClickConfirm(3500, armDelayMs);
  return (
    <button onClick={() => (isArmed('k') ? onDelete() : arm('k'))}>
      {isPending('k') ? 'Confirm' : 'Delete'}
    </button>
  );
}

const btn = () => host.querySelector('button');
const click = async () => { await act(async () => { btn().click(); }); };

describe('useTwoClickConfirm — a double-tap must not destroy anything', () => {
  it('two immediate taps do NOT run the action', async () => {
    // THE REGRESSION. Before the guard this fired once.
    const onDelete = vi.fn();
    await act(async () => { root.render(<DeleteButton onDelete={onDelete} />); });
    await click();
    await click();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('still shows "Confirm" immediately, so the button does not feel dead', async () => {
    // The guard must not cost responsiveness: the label is driven by isPending,
    // which flips on the first tap even though the action stays closed.
    const onDelete = vi.fn();
    await act(async () => { root.render(<DeleteButton onDelete={onDelete} />); });
    expect(btn().textContent).toBe('Delete');
    await click();
    expect(btn().textContent).toBe('Confirm');
  });

  it('a deliberate second tap after the window DOES run the action', async () => {
    // The pattern still has to work, or the fix is just a break.
    vi.useFakeTimers();
    const onDelete = vi.fn();
    await act(async () => { root.render(<DeleteButton onDelete={onDelete} />); });
    await click();
    await act(async () => { vi.advanceTimersByTime(400); });
    await click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('rapid repeated tapping never accumulates into a confirm', async () => {
    // Each too-early tap RE-ARMS, restarting the window — so holding a finger on
    // the button cannot brute-force its way through.
    const onDelete = vi.fn();
    await act(async () => { root.render(<DeleteButton onDelete={onDelete} />); });
    for (let i = 0; i < 8; i += 1) await click();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('disarms on its own after the timeout, so a stray armed button cannot linger', async () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    await act(async () => { root.render(<DeleteButton onDelete={onDelete} />); });
    await click();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(btn().textContent).toBe('Delete');
    await click();               // this only re-arms
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('armDelayMs=0 — TODAY\'S DEFAULT — still lets a double-tap through', async () => {
    // Not an escape hatch: this is what every shipped caller currently does, and
    // it is the open gap the hook's header names. Asserted so the exposure is
    // visible in CI rather than only in prose, and so flipping the default is a
    // deliberate act that turns this test red.
    const onDelete = vi.fn();
    await act(async () => { root.render(<DeleteButton onDelete={onDelete} armDelayMs={0} />); });
    await click();
    await click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('gating the ACTION on isPending would reopen the hole — documented shape', async () => {
    // Not a style check: this is the one wiring mistake that silently undoes the
    // fix, so it is demonstrated rather than only described in a comment.
    function WrongButton({ onDelete }) {
      const { isPending, arm } = useTwoClickConfirm();
      return <button onClick={() => (isPending('k') ? onDelete() : arm('k'))}>x</button>;
    }
    const onDelete = vi.fn();
    await act(async () => { root.render(<WrongButton onDelete={onDelete} />); });
    await click();
    await click();
    expect(onDelete, 'isPending must never gate the action').toHaveBeenCalledTimes(1);
  });
});
