/**
 * ════════════════════════════════════════════════
 * FILE: TechMore.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders the PWA More screen for both a field technician and an admin. This
 *   catches invalid lazy-module exports, missing admin icons, and render-time
 *   failures before a deploy can strand an installed PWA behind its route
 *   error boundary.
 *
 * DEPENDS ON:
 *   Packages: react-dom/server, react-router-dom, vitest
 *   Internal: TechMore, AuthContext, i18n
 *   Data: none — authentication and database access are mocked
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  role: 'field_tech',
  adminMobile: false,
  billing: true,
  // The CRM lead nav keys public.crm_lead_access() resolves server-side. A
  // field tech holds neither, so the Lead Center row must not render for them.
  navKeys: [],
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { rpc: vi.fn(async () => []) },
    employee: { id: 'employee-1', role: authState.role },
    isFeatureEnabled: (key) => (
      key === 'page:admin_mobile'
        ? authState.adminMobile
        : key === 'feature:billing' ? authState.billing : true
    ),
    canAccess: (navKey) => authState.role === 'admin' || authState.navKeys.includes(navKey),
  }),
}));

const { default: i18n } = await import('@/i18n');
const { default: TechMore } = await import('@/pages/tech/TechMore');

function renderMore() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/tech/more']}>
      <TechMore />
    </MemoryRouter>,
  );
}

afterEach(() => {
  authState.role = 'field_tech';
  authState.adminMobile = false;
  authState.billing = true;
  i18n.changeLanguage('en');
});

describe('TechMore PWA render contract', () => {
  it('renders the ordinary field-tech More screen', () => {
    const output = renderMore();

    expect(output).toContain('More');
    expect(output).toContain('/tech/settings');
    expect(output).not.toContain('/tech/admin/dash');
  });

  it('renders every enabled admin row and icon without throwing', () => {
    authState.role = 'admin';
    authState.adminMobile = true;

    const output = renderMore();

    expect(output).toContain('/tech/admin/dash');
    expect(output).toContain('/tech/admin/collections');
    expect(output).toContain('/tech/admin/invoice/new');
    expect(output).toContain('/tech/admin/estimate/new');
    expect(output).toContain('/tech/admin/leads');
  });

  it('hides financial-document create rows when billing is disabled', () => {
    authState.role = 'admin';
    authState.adminMobile = true;
    authState.billing = false;

    const output = renderMore();

    expect(output).not.toContain('/tech/admin/invoice/new');
    expect(output).not.toContain('/tech/admin/estimate/new');
    expect(output).toContain('/tech/admin/leads');
  });
});
