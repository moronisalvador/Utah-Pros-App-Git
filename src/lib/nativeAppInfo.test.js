/**
 * ════════════════════════════════════════════════
 * FILE: nativeAppInfo.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks native installed-version behavior without invoking Capacitor or iOS.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  nativeAppInfo.js
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import { getInstalledAppInfo } from './nativeAppInfo.js';

describe('getInstalledAppInfo', () => {
  it('does not load the native plugin in web/PWA builds', async () => {
    const loadAppPlugin = vi.fn();

    await expect(getInstalledAppInfo({
      native: false,
      loadAppPlugin,
    })).resolves.toEqual({ state: 'web' });

    expect(loadAppPlugin).not.toHaveBeenCalled();
  });

  it('returns the installed bundle version and build', async () => {
    const getInfo = vi.fn().mockResolvedValue({
      version: '1.0.0',
      build: '42.1',
      name: 'UPR',
      id: 'com.utahprosrestoration.upr',
    });

    await expect(getInstalledAppInfo({
      native: true,
      loadAppPlugin: vi.fn().mockResolvedValue({ App: { getInfo } }),
    })).resolves.toEqual({
      state: 'ready',
      version: '1.0.0',
      build: '42.1',
    });
  });

  it.each([
    ['plugin rejection', () => Promise.reject(new Error('missing bridge'))],
    ['missing version', () => Promise.resolve({
      App: { getInfo: () => Promise.resolve({ version: '', build: '42' }) },
    })],
    ['missing build', () => Promise.resolve({
      App: { getInfo: () => Promise.resolve({ version: '1.0.0' }) },
    })],
  ])('reports unavailable for %s without guessing', async (_label, loadAppPlugin) => {
    await expect(getInstalledAppInfo({
      native: true,
      loadAppPlugin,
    })).resolves.toEqual({ state: 'unavailable' });
  });
});
