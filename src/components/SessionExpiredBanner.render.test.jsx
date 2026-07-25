/**
 * ════════════════════════════════════════════════
 * FILE: SessionExpiredBanner.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "your session expired" bar appears exactly when it should and
 *   stays out of the way the rest of the time. The bar is the only thing telling
 *   someone their saves are silently failing, so "shows up when the session is
 *   dead" and "never covers the login form" both need pinning.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server
 *   Internal:  ./SessionExpiredBanner.jsx (AuthContext + router are mocked)
 *
 * NOTES / GOTCHAS:
 *   - renderToStaticMarkup, not a DOM render: vitest runs in plain node here.
 *     Matches uiPrimitives.render.test.jsx / settingsPrimitives.render.test.jsx.
 *   - vi.hoisted for the mock state — vi.mock factories are hoisted above the
 *     imports, so a plain const would be in the temporal dead zone.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  auth: { sessionExpired: false, logout: async () => {} },
  loc: { pathname: '/invoices/5c897ba0' },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('react-router-dom', () => ({
  useLocation: () => mocks.loc,
  useNavigate: () => () => {},
}));

import SessionExpiredBanner from './SessionExpiredBanner.jsx';

describe('SessionExpiredBanner', () => {
  beforeEach(() => {
    mocks.auth.sessionExpired = false;
    mocks.loc.pathname = '/invoices/5c897ba0';
  });

  it('renders nothing on the normal path (session healthy)', () => {
    expect(renderToStaticMarkup(<SessionExpiredBanner />)).toBe('');
  });

  it('announces itself and offers a way back in once the session is unrecoverable', () => {
    mocks.auth.sessionExpired = true;
    const out = renderToStaticMarkup(<SessionExpiredBanner />);
    expect(out).toContain('role="alert"');       // screen readers get it too
    expect(out).toContain('Your session expired');
    expect(out).toContain('Sign in again');
  });

  it('stays hidden on the auth screens, where it would cover the form it points at', () => {
    mocks.auth.sessionExpired = true;
    for (const path of ['/login', '/set-password', '/set-password#type=recovery']) {
      mocks.loc.pathname = path;
      expect(renderToStaticMarkup(<SessionExpiredBanner />)).toBe('');
    }
  });

  it('uses theme-independent colors — the dark re-tone is scoped to .tech-layout, which it sits outside of', () => {
    mocks.auth.sessionExpired = true;
    const out = renderToStaticMarkup(<SessionExpiredBanner />);
    // Solid --danger bar with --accent-text on it: both are :root-level and are
    // NOT re-toned by [data-theme="dark"] .tech-layout (index.css:4617), so the
    // contrast survives in both themes. A tinted --danger-bg would NOT.
    expect(out).toContain('background:var(--danger)');
    expect(out).not.toContain('var(--danger-bg)');
  });
});
