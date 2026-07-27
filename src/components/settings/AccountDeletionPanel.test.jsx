/**
 * ════════════════════════════════════════════════
 * FILE: AccountDeletionPanel.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the shared account-deletion panel starts safely in both desktop
 *   and field-app presentations.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, vitest
 *   Internal:  @/components/settings/AccountDeletionPanel
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Server rendering intentionally observes only the cold-loading state; the
 *     source contract test covers the RPC and route integrations.
 * ════════════════════════════════════════════════
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ db: { rpc: vi.fn() } }),
}));

vi.mock('@/lib/toast', () => ({
  toast: vi.fn(),
}));

import AccountDeletionPanel from '@/components/settings/AccountDeletionPanel';

describe('AccountDeletionPanel presentation', () => {
  it('uses the existing desktop settings panel without exposing the action before status loads', () => {
    const output = renderToStaticMarkup(<AccountDeletionPanel />);

    expect(output).toContain('class="settings-panel"');
    expect(output).toContain('Loading account deletion status');
    expect(output).not.toContain('Request account deletion');
  });

  it('uses the field Settings card and its 48px control vocabulary', () => {
    const output = renderToStaticMarkup(<AccountDeletionPanel variant="tech" />);

    expect(output).toContain('class="tech-settings-card"');
    expect(output).toContain('Loading account deletion status');
  });
});
