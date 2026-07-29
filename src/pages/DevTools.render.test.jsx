/**
 * ════════════════════════════════════════════════
 * FILE: DevTools.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves an ops-health deep link opens Dev Tools on the Provider Events panel
 *   instead of leaving the owner on the default Feature Flags tab.
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

const { default: DevTools } = await import('./DevTools.jsx');

describe('DevTools ops-health deep link', () => {
  it('opens the messaging provider-events subtab from the alert URL', () => {
    const output = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dev-tools?tab=messaging&sub=events']}>
        <DevTools />
      </MemoryRouter>,
    );

    expect(output).toContain('Provider event queue marker');
    expect(output).not.toContain('Loading flags');
  });
});
