/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-callback.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the QuickBooks OAuth callback returns to Integrations and refuses a
 *   different accounting company before exchanging or storing credentials. It
 *   also proves upstream OAuth errors are never copied into the redirect URL.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./quickbooks-callback.js
 *
 * NOTES / GOTCHAS:
 *   - QuickBooks and Supabase are local test doubles; no provider is contacted.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({
  existingRealm: null,
  linkedTables: new Set(),
  exchange: vi.fn(),
  save: vi.fn(),
  company: vi.fn(),
  db: null,
  boundedFetch: vi.fn(),
  supabaseFetch: null,
  providerTrafficEnabled: true,
}));

vi.mock('../lib/quickbooks.js', () => ({
  exchangeCodeForTokens: (...args) => state.exchange(...args),
  saveTokens: (...args) => state.save(...args),
  fetchCompanyName: (...args) => state.company(...args),
  qboEnvironment: vi.fn(() => 'sandbox'),
}));
vi.mock('../lib/http.js', () => ({ fetchWithTimeout: state.boundedFetch }));
vi.mock('../lib/supabase.js', () => ({ supabase: (_env, fetchImpl) => {
  state.supabaseFetch = fetchImpl;
  return state.db;
} }));

import {
  appBaseFrom, buildReturnLocation, onRequestGet, QBO_RETURN_PATH,
} from './quickbooks-callback.js';

function callbackRequest(realmId = 'realm-1') {
  return new Request(`https://app.test/api/quickbooks-callback?code=code-1&state=state-1&realmId=${realmId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.existingRealm = null;
  state.linkedTables = new Set();
  state.supabaseFetch = null;
  state.providerTrafficEnabled = true;
  state.exchange.mockResolvedValue({ access_token: 'access', refresh_token: 'refresh' });
  state.save.mockResolvedValue({ realm_id: 'realm-1' });
  state.company.mockResolvedValue(null);
  state.db = {
    select: vi.fn(async (table, query) => {
      if (table === 'integration_config' && query.includes('qbo_oauth_state')) return [{ value: 'state-1' }];
      if (table === 'integration_config' && query.includes('qbo_oauth_user')) return [];
      if (table === 'integration_config' && query.includes('qbo_provider_traffic_enabled')) return state.providerTrafficEnabled ? [{ value: 'true' }] : [];
      if (table === 'integration_credentials') return state.existingRealm ? [{ realm_id: state.existingRealm }] : [];
      if (state.linkedTables.has(table)) return [{ id: 'linked-row' }];
      return [];
    }),
    update: vi.fn(async () => []),
    delete: vi.fn(async () => []),
  };
});

describe('quickbooks-callback redirect target (P2 retarget)', () => {
  it('returns to /settings/integrations, not the retired /dev-tools tab', () => {
    expect(QBO_RETURN_PATH).toBe('/settings/integrations');
    const loc = buildReturnLocation('https://dev.utahpros.app', 'connected');
    expect(loc).toBe('https://dev.utahpros.app/settings/integrations?qbo=connected');
    expect(loc).not.toContain('/dev-tools');
  });

  it('carries the qbo status through each return state', () => {
    for (const status of ['connected', 'error', 'badstate']) {
      const loc = buildReturnLocation('https://app.test', status);
      expect(loc).toBe(`https://app.test/settings/integrations?qbo=${status}`);
    }
  });

  it('does not reflect an upstream OAuth error description into the redirect URL', async () => {
    const privateDetail = 'private Intuit account and customer detail';
    const request = new Request(`https://app.test/api/quickbooks-callback?error=access_denied&error_description=${encodeURIComponent(privateDetail)}`);

    const response = await onRequestGet({ request, env: { APP_BASE_URL: 'https://app.test' } });
    const location = new URL(response.headers.get('Location'));

    expect(location.searchParams.get('qbo')).toBe('error');
    expect(location.searchParams.get('msg')).toBe('QuickBooks connection could not be completed. Start a new connection attempt.');
    expect(location.toString()).not.toContain(encodeURIComponent(privateDetail));
    expect(state.exchange).not.toHaveBeenCalled();
  });

  it('appends a truncated msg (≤200 chars) only when provided', () => {
    expect(buildReturnLocation('https://app.test', 'error')).not.toContain('msg=');

    const long = 'x'.repeat(500);
    const loc = buildReturnLocation('https://app.test', 'error', long);
    const msg = new URL(loc).searchParams.get('msg');
    expect(msg).toHaveLength(200);
    expect(new URL(loc).pathname).toBe('/settings/integrations');
  });

  it('appBaseFrom prefers APP_BASE_URL, else the redirect-URI origin', () => {
    expect(appBaseFrom({ APP_BASE_URL: 'https://utahpros.app' })).toBe('https://utahpros.app');
    expect(appBaseFrom({ QBO_REDIRECT_URI: 'https://dev.utahpros.app/api/quickbooks-callback' }))
      .toBe('https://dev.utahpros.app');
    expect(appBaseFrom({})).toBe('https://dev.utahpros.app');
  });

  it('allows a same-company reconnect and preserves the callback contract', async () => {
    state.existingRealm = 'realm-1';

    const response = await onRequestGet({
      request: callbackRequest('realm-1'),
      env: { APP_BASE_URL: 'https://app.test' },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://app.test/settings/integrations?qbo=connected');
    expect(state.exchange).toHaveBeenCalledOnce();
    expect(state.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ realm_id: 'realm-1', environment: 'sandbox' }),
    );
    expect(state.company).toHaveBeenCalledWith(
      expect.anything(),
      { expectedRealmId: 'realm-1' },
    );
  });

  it('does not persist a provider-derived company name when maintenance closes during its fetch', async () => {
    state.company.mockImplementationOnce(async () => {
      state.providerTrafficEnabled = false;
      return 'Acme Restoration';
    });
    const response = await onRequestGet({ request: callbackRequest('realm-1'), env: { APP_BASE_URL: 'https://app.test' } });
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('Location')).searchParams.get('qbo')).toBe('connected');
    expect(state.db.update).not.toHaveBeenCalled();
  });

  it('keeps the successful callback connected when optional company-name enrichment fails', async () => {
    const privateDetail = 'private upstream tenant and refresh-token detail';
    state.company.mockRejectedValueOnce(Object.assign(new Error(privateDetail), {
      code: 'unsafe code with spaces',
      status: 999,
    }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await onRequestGet({ request: callbackRequest('realm-1'), env: { APP_BASE_URL: 'https://app.test' } });
      expect(new URL(response.headers.get('Location')).searchParams.get('qbo')).toBe('connected');
      expect(state.save).toHaveBeenCalledOnce();
      expect(state.db.delete).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(privateDetail);
      expect(warning).toHaveBeenCalledWith(
        '[quickbooks-callback] post-save follow-up failed',
        { step: 'company-name-fetch', code: 'unknown', status: null },
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('keeps the successful callback connected when either transient-state cleanup delete fails', async () => {
    const privateDetail = 'private OAuth state and provider response body';
    state.db.delete
      .mockRejectedValueOnce(Object.assign(new Error(privateDetail), { code: 'cleanup_503', status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error(privateDetail), { code: '<unsafe>', status: 999 }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await onRequestGet({ request: callbackRequest('realm-1'), env: { APP_BASE_URL: 'https://app.test' } });
      expect(new URL(response.headers.get('Location')).searchParams.get('qbo')).toBe('connected');
      expect(state.save).toHaveBeenCalledOnce();
      expect(state.db.delete).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(warning.mock.calls)).not.toContain(privateDetail);
      expect(warning).toHaveBeenNthCalledWith(1,
        '[quickbooks-callback] post-save follow-up failed',
        { step: 'transient-state-delete:qbo_oauth_state', code: 'cleanup_503', status: 503 },
      );
      expect(warning).toHaveBeenNthCalledWith(2,
        '[quickbooks-callback] post-save follow-up failed',
        { step: 'transient-state-delete:qbo_oauth_user', code: 'unknown', status: null },
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('redirects to a fresh reconnect when maintenance closes after the one-time code is consumed but before credentials persist', async () => {
    state.exchange.mockImplementationOnce(async () => {
      state.providerTrafficEnabled = false;
      return { access_token: 'access', refresh_token: 'refresh' };
    });

    const response = await onRequestGet({ request: callbackRequest('realm-1'), env: { APP_BASE_URL: 'https://app.test' } });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location'));
    expect(location.searchParams.get('qbo')).toBe('error');
    expect(location.searchParams.get('msg')).toMatch(/reconnect after maintenance/i);
    expect(state.exchange).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('rejects a different company before token exchange or credential writes', async () => {
    state.existingRealm = 'realm-A';

    const response = await onRequestGet({
      request: callbackRequest('realm-B'),
      env: { APP_BASE_URL: 'https://app.test' },
    });

    const location = new URL(response.headers.get('Location'));
    expect(location.searchParams.get('qbo')).toBe('error');
    expect(location.searchParams.get('msg')).toMatch(/different company/i);
    expect(state.exchange).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('rejects realm-less legacy credentials when any QBO-linked row exists', async () => {
    state.linkedTables.add('invoices');

    const response = await onRequestGet({
      request: callbackRequest('realm-1'),
      env: { APP_BASE_URL: 'https://app.test' },
    });

    const location = new URL(response.headers.get('Location'));
    expect(location.searchParams.get('qbo')).toBe('error');
    expect(location.searchParams.get('msg')).toMatch(/no company attribution/i);
    expect(state.exchange).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('treats a realm-only command ledger as a link and rejects before token exchange', async () => {
    state.linkedTables.add('qbo_invoice_commands');

    const response = await onRequestGet({
      request: callbackRequest('realm-B'),
      env: { APP_BASE_URL: 'https://app.test' },
    });

    const location = new URL(response.headers.get('Location'));
    expect(location.searchParams.get('qbo')).toBe('error');
    expect(location.searchParams.get('msg')).toMatch(/no company attribution/i);
    expect(state.exchange).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it('does not persist a connection when Intuit rejects the token exchange', async () => {
    const privateDetail = 'authorization code expired with private upstream body';
    state.exchange.mockRejectedValue(new Error(privateDetail));

    const response = await onRequestGet({
      request: callbackRequest('realm-1'),
      env: { APP_BASE_URL: 'https://app.test' },
    });

    const location = new URL(response.headers.get('Location'));
    expect(location.searchParams.get('qbo')).toBe('error');
    expect(location.searchParams.get('msg')).toBe('QuickBooks connection could not be completed. Start a new connection attempt.');
    expect(location.toString()).not.toContain(encodeURIComponent(privateDetail));
    expect(state.save).not.toHaveBeenCalled();
  });
});
