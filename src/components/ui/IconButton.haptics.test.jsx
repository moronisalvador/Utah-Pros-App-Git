// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: IconButton.haptics.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   Icon-only controls retain their light haptic by default, while narrowly scoped
 *   surfaces can opt out where a separate explicit action owns confirmation haptics.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IconButton from './IconButton';
import { impact } from '@/lib/nativeHaptics';

vi.mock('@/lib/nativeHaptics', () => ({ impact: vi.fn() }));

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.replaceChildren();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.clearAllMocks();
});

describe('IconButton haptic contract', () => {
  it('keeps the current light haptic default', async () => {
    await act(async () => { root.render(<IconButton label="Edit">✎</IconButton>); });
    await act(async () => { container.querySelector('button').click(); });
    expect(impact).toHaveBeenCalledOnce();
    expect(impact).toHaveBeenCalledWith('light');
  });

  it('allows a caller to opt out without disabling the button', async () => {
    const onClick = vi.fn();
    await act(async () => { root.render(<IconButton label="Close" haptic={false} onClick={onClick}>✕</IconButton>); });
    await act(async () => { container.querySelector('button').click(); });
    expect(onClick).toHaveBeenCalledOnce();
    expect(impact).not.toHaveBeenCalled();
  });
});
