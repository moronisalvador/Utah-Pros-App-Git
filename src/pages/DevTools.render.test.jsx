/**
 * ════════════════════════════════════════════════
 * FILE: DevTools.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves an ops-health deep link opens Dev Tools on the Provider Events panel
 *   instead of leaving the owner on the default Feature Flags tab, and keeps
 *   both owner notification delivery controls reachable from their exact URL.
 *
 * DEPENDS ON:
 *   Packages:  react-dom/server, react-router-dom, vitest
 *   Internal:  ./DevTools.jsx
 *   Data:      none — authentication and the event panel are mocked
 * ════════════════════════════════════════════════
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    employee: {
      id: 'owner-1',
      full_name: 'Moroni Salvador',
      email: 'moroni@utah-pros.com',
      role: 'admin',
    },
    db: {},
    featureFlags: {},
    isFeatureEnabled: () => true,
  }),
}));
vi.mock('@/components/ProviderEventOps', () => ({
  default: () => <div>Provider event queue marker</div>,
}));
vi.mock('@/components/DeliverabilityHealth', () => ({
  default: () => <div>Deliverability marker</div>,
}));
vi.mock('@/lib/realtime', () => ({
  getAuthHeader: async () => ({}),
}));

import {
  featureFlagUpsertArgs,
  oopPricingRolloutState,
} from '@/lib/oopPricingRollout';
import { FEATURE_FLAG_REGISTRY } from '@/lib/featureFlags';

const { default: DevTools } = await import('./DevTools.jsx');

describe('DevTools ops-health deep link', () => {
  it('auto-registers OOP pricing fail closed until the owner explicitly enables it', () => {
    expect(FEATURE_FLAG_REGISTRY.find((flag) => flag.key === 'tool:oop_pricing')).toMatchObject({
      enabled: false,
      category: 'tool',
    });
  });

  it('distinguishes the OOP owner preview from global availability', () => {
    const ownerId = 'owner-1';

    expect(oopPricingRolloutState({ enabled: false, force_disabled: false, dev_only_user_id: ownerId }, ownerId)).toBe('preview');
    expect(oopPricingRolloutState({ enabled: true, force_disabled: false, dev_only_user_id: ownerId }, ownerId)).toBe('global');
    expect(oopPricingRolloutState({ enabled: false, force_disabled: false, dev_only_user_id: null }, ownerId)).toBe('hidden');
    expect(oopPricingRolloutState({ enabled: true, force_disabled: true, dev_only_user_id: ownerId }, ownerId)).toBe('force_disabled');
  });

  it('builds the global activation write without losing preview or force-disable state', () => {
    const flag = {
      key: 'tool:oop_pricing',
      enabled: false,
      force_disabled: false,
      dev_only_user_id: 'owner-1',
      category: 'tool',
      label: 'OOP Pricing',
      description: 'Controls the OOP calculator.',
    };

    expect(featureFlagUpsertArgs(flag, {
      enabled: true,
      updatedBy: 'owner-1',
    })).toEqual({
      p_key: 'tool:oop_pricing',
      p_enabled: true,
      p_dev_only_user_id: 'owner-1',
      p_category: 'tool',
      p_label: 'OOP Pricing',
      p_description: 'Controls the OOP calculator.',
      p_updated_by: 'owner-1',
      p_force_disabled: false,
    });
    expect(featureFlagUpsertArgs(
      { ...flag, force_disabled: true },
      { enabled: true, updatedBy: 'owner-1' },
    ).p_force_disabled).toBe(true);
  });

  it('opens the messaging provider-events subtab from the alert URL', () => {
    const output = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dev-tools?tab=messaging&sub=events']}>
        <DevTools />
      </MemoryRouter>,
    );

    expect(output).toContain('Provider event queue marker');
    expect(output).not.toContain('Loading flags');
  });

  it('opens the owner notification diagnostics from its exact advanced URL', () => {
    const output = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dev-tools?tab=advanced&sub=notifications']}>
        <DevTools />
      </MemoryRouter>,
    );

    expect(output).toContain('Owner notification delivery tests');
    expect(output).toContain('Test all four channels');
    expect(output).toContain('Real-world 15-type delivery sweep');
    expect(output).toContain('Test all 15 notification types');
    expect(output).toContain('45 owner-only type/surface checks');
    expect(output).toContain('Preview every notification type');
    expect(output).not.toContain('RPC Test Runner');
  });
});
