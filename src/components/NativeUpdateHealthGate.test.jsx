// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: NativeUpdateHealthGate.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves native update acceptance stays closed while account startup is
 *   incomplete, failed, expired, or caught by a route error boundary. Only a
 *   completed healthy startup and rendered route pass.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  NativeUpdateHealthGate
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/lib/nativeUpdater', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    markBundleReady: vi.fn(),
  };
});

import { useAuth } from '@/contexts/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import NativeUpdateHealthGate from './NativeUpdateHealthGate';
import {
  isNativeUpdateHealthVerified,
  markBundleReady,
} from '@/lib/nativeUpdater';
import {
  resetNativeRouteHealthForTest,
} from '@/lib/nativeRouteHealth';

let container;
let root;

function BrokenRoute() {
  throw new Error('route render failed');
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  resetNativeRouteHealthForTest();
  useAuth.mockReturnValue({
    loading: false,
    error: null,
    sessionExpired: false,
  });
  markBundleReady.mockReset();
  markBundleReady.mockResolvedValue({ ok: true });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('native update application health checkpoint', () => {
  it('accepts only an explicitly completed auth startup and healthy route', () => {
    expect(isNativeUpdateHealthVerified({
      loading: false,
      error: null,
      sessionExpired: false,
      routeHealthy: true,
    })).toBe(true);

    for (const state of [
      {
        loading: true,
        error: null,
        sessionExpired: false,
        routeHealthy: true,
      },
      {
        loading: false,
        error: new Error('boot failed'),
        sessionExpired: false,
        routeHealthy: true,
      },
      {
        loading: false,
        error: null,
        sessionExpired: true,
        routeHealthy: true,
      },
      {
        loading: false,
        error: null,
        sessionExpired: false,
        routeHealthy: false,
      },
      {
        loading: undefined,
        error: null,
        sessionExpired: false,
        routeHealthy: true,
      },
    ]) {
      expect(isNativeUpdateHealthVerified(state)).toBe(false);
    }
  });

  it('acknowledges a healthy rendered route once', async () => {
    await act(async () => {
      root.render(<NativeUpdateHealthGate />);
    });

    expect(markBundleReady).toHaveBeenCalledOnce();
    expect(markBundleReady).toHaveBeenCalledWith({ healthVerified: true });
  });

  it('does not acknowledge a route whose render failure was caught', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      root.render(
        <>
          <ErrorBoundary section="Broken route">
            <BrokenRoute />
          </ErrorBoundary>
          <NativeUpdateHealthGate />
        </>,
      );
    });

    expect(markBundleReady).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
