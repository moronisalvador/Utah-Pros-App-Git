/**
 * ════════════════════════════════════════════════
 * FILE: OfflineStatusPill.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the online-first release exposes local review/recovery without an
 *   automatic resend action.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server
 *   Internal:  OfflineStatusPill, useOfflineQueue
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { renderToStaticMarkup } from 'react-dom/server';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const queueState = vi.hoisted(() => ({
  pendingCount: 0,
  errorCount: 3,
  blockedCount: 1,
  quarantinedCount: 0,
  rolloutReady: true,
  legacyRecoveryRequired: false,
  unsupportedRecoveryRequired: false,
  inspectionUnavailable: false,
  storageState: {
    status: 'ready',
    code: null,
    guidance: null,
  },
  loadBlocked: vi.fn(),
  resolveBlocked: vi.fn(),
  retryOfflineStorage: vi.fn(),
  discardLegacyOfflineData: vi.fn(),
}));

vi.mock('@/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => queueState,
}));

import OfflineStatusPill from './OfflineStatusPill.jsx';

describe('OfflineStatusPill', () => {
  beforeEach(() => {
    Object.assign(queueState, {
      pendingCount: 0,
      errorCount: 3,
      blockedCount: 1,
      quarantinedCount: 0,
      rolloutReady: true,
      legacyRecoveryRequired: false,
      unsupportedRecoveryRequired: false,
      inspectionUnavailable: false,
      storageState: {
        status: 'ready',
        code: null,
        guidance: null,
      },
    });
  });

  it('renders manual review without an automatic retry action', () => {
    const markup = renderToStaticMarkup(<OfflineStatusPill />);
    expect(markup).toContain('1 need review');
    expect(markup).not.toContain('2 failed');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it('surfaces quarantined records even when there is no blocked reminder', () => {
    Object.assign(queueState, {
      errorCount: 0,
      blockedCount: 0,
      quarantinedCount: 4,
    });
    const markup = renderToStaticMarkup(<OfflineStatusPill />);
    expect(markup).toContain('4 quarantined');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('surfaces blocked-open and legacy rollout states separately', () => {
    Object.assign(queueState, {
      quarantinedCount: 2,
      rolloutReady: false,
      legacyRecoveryRequired: true,
      storageState: {
        status: 'blocked',
        code: 'OFFLINE_DB_OPEN_BLOCKED',
        guidance: 'Close other UPR tabs, then reload.',
      },
    });
    let markup = renderToStaticMarkup(<OfflineStatusPill />);
    expect(markup).toContain('Offline storage blocked');

    queueState.storageState = {
      status: 'ready',
      code: null,
      guidance: null,
    };
    markup = renderToStaticMarkup(<OfflineStatusPill />);
    expect(markup).toContain('Legacy work blocked');
  });

  it('fails closed when offline ownership inspection is unavailable', () => {
    Object.assign(queueState, {
      errorCount: 0,
      blockedCount: 0,
      rolloutReady: false,
      inspectionUnavailable: true,
    });

    const markup = renderToStaticMarkup(<OfflineStatusPill />);
    expect(markup).toContain('Offline inspection blocked');
    expect(markup).toContain('aria-expanded="false"');
  });
});
