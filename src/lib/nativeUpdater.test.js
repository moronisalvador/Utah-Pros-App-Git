/**
 * ════════════════════════════════════════════════
 * FILE: nativeUpdater.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves a native bundle cannot be accepted just because JavaScript imported
 *   or React mounted. OTA must be explicitly enabled and a reviewed application
 *   health checkpoint must be supplied.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  nativeUpdater
 *   Data:      none (native updater fakes only)
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  updater: {
    current: vi.fn(),
    getLatest: vi.fn(),
    notifyAppReady: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: native.isNativePlatform },
}));

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: native.updater,
}));

import {
  checkForUpdate,
  getCurrentBundleInfo,
  isNativeOtaEnabled,
  markBundleReady,
} from './nativeUpdater.js';

beforeEach(() => {
  vi.clearAllMocks();
  native.isNativePlatform.mockReturnValue(true);
  native.updater.notifyAppReady.mockResolvedValue(undefined);
});

describe('native OTA fail-closed boundary', () => {
  it('requires the exact reviewed enable value', () => {
    expect(isNativeOtaEnabled({ VITE_NATIVE_OTA_ENABLED: 'true' })).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', '1', true]) {
      expect(isNativeOtaEnabled({ VITE_NATIVE_OTA_ENABLED: value })).toBe(false);
    }
  });

  it('never acknowledges a disabled or health-unverified bundle', async () => {
    await expect(markBundleReady({
      env: { VITE_NATIVE_OTA_ENABLED: 'false' },
      healthVerified: true,
      updater: native.updater,
    })).resolves.toEqual({ ok: false, reason: 'ota_disabled' });
    await expect(markBundleReady({
      env: { VITE_NATIVE_OTA_ENABLED: 'true' },
      healthVerified: false,
      updater: native.updater,
    })).resolves.toEqual({ ok: false, reason: 'health_unverified' });
    expect(native.updater.notifyAppReady).not.toHaveBeenCalled();
  });

  it('acknowledges exactly once only after both gates pass', async () => {
    await expect(markBundleReady({
      env: { VITE_NATIVE_OTA_ENABLED: 'true' },
      healthVerified: true,
      updater: native.updater,
    })).resolves.toEqual({ ok: true });
    expect(native.updater.notifyAppReady).toHaveBeenCalledOnce();
  });

  it('keeps updater metadata calls inert while OTA is disabled', async () => {
    const env = { VITE_NATIVE_OTA_ENABLED: 'false' };
    await expect(checkForUpdate({ env, updater: native.updater }))
      .resolves.toBe(null);
    await expect(getCurrentBundleInfo({ env, updater: native.updater }))
      .resolves.toBe(null);
    expect(native.updater.getLatest).not.toHaveBeenCalled();
    expect(native.updater.current).not.toHaveBeenCalled();
  });
});
