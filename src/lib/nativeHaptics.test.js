/**
 * ════════════════════════════════════════════════
 * FILE: nativeHaptics.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the native selection-feedback lifecycle used by participant controls.
 *
 * DEPENDS ON:
 *   Packages:  vitest, @capacitor/core, @capacitor/haptics
 *   Internal:  ./nativeHaptics.js
 *   Data:      reads  → mocked native/reduced-motion state
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Capacitor emits iOS selection feedback from selectionChanged(), not start().
 *   - The public helper remains fire-and-forget, so tests wait for the mocked
 *     promise chain rather than awaiting selection().
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cap = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }));
const haptics = vi.hoisted(() => ({
  impact: vi.fn(),
  notification: vi.fn(),
  selectionStart: vi.fn(),
  selectionChanged: vi.fn(),
  selectionEnd: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: cap }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: haptics,
  ImpactStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const { selection } = await import('./nativeHaptics.js');

beforeEach(() => {
  vi.clearAllMocks();
  cap.isNativePlatform.mockReturnValue(true);
  haptics.selectionStart.mockResolvedValue();
  haptics.selectionChanged.mockResolvedValue();
  haptics.selectionEnd.mockResolvedValue();
});

describe('native selection feedback', () => {
  it('serially starts, emits the selection change, and ends the generator', async () => {
    const order = [];
    haptics.selectionStart.mockImplementation(async () => { order.push('start'); });
    haptics.selectionChanged.mockImplementation(async () => { order.push('changed'); });
    haptics.selectionEnd.mockImplementation(async () => { order.push('end'); });

    expect(selection()).toBeUndefined();

    await vi.waitFor(() => expect(haptics.selectionEnd).toHaveBeenCalledOnce());
    expect(order).toEqual(['start', 'changed', 'end']);
  });

  it('still ends the generator when the feedback call rejects', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    haptics.selectionChanged.mockRejectedValue(new Error('selection unavailable'));

    selection();

    await vi.waitFor(() => expect(haptics.selectionEnd).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    expect(warning).toHaveBeenCalledWith('Haptics.selection failed:', 'selection unavailable');
    warning.mockRestore();
  });

  it('does not touch the native generator when Reduce Motion is enabled', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    });
    try {
      selection();
      expect(haptics.selectionStart).not.toHaveBeenCalled();
      expect(haptics.selectionChanged).not.toHaveBeenCalled();
      expect(haptics.selectionEnd).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
