import { describe, expect, it, vi } from 'vitest';
import {
  CallRailDiscoveryError,
  resolveCallRailAccountAliases,
} from './callrail-api.js';

function accountsResponse(accounts, status = 200, extra = {}) {
  return new Response(JSON.stringify({ accounts, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveCallRailAccountAliases', () => {
  it('proves a cached numeric id belongs to the current masked resource id', async () => {
    const fetcher = vi.fn(async () => accountsResponse([{
      id: 'ACC-current',
      numeric_id: 635117922,
    }]));

    await expect(resolveCallRailAccountAliases(
      'server-secret',
      '635117922',
      { fetcher },
    )).resolves.toEqual(['635117922', 'ACC-current']);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.callrail.com/v3/a.json?fields=numeric_id&per_page=250&page=1',
      {
        headers: {
          Authorization: 'Token token="server-secret"',
        },
      },
      5000,
    );
  });

  it('returns both identities when the masked id is configured', async () => {
    const fetcher = vi.fn(async () => accountsResponse([{
      id: 'ACC-current',
      numeric_id: 635117922,
    }]));

    await expect(resolveCallRailAccountAliases(
      'server-secret',
      'ACC-current',
      { fetcher },
    )).resolves.toEqual(['ACC-current', '635117922']);
  });

  it('does not accept an unrelated API-visible account', async () => {
    const fetcher = vi.fn(async () => accountsResponse([{
      id: 'ACC-other',
      numeric_id: 111111111,
    }]));

    await expect(resolveCallRailAccountAliases(
      'server-secret',
      '635117922',
      { fetcher },
    )).resolves.toBeNull();
  });

  it('searches the bounded account inventory without treating page one as definitive', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(accountsResponse([{
        id: 'ACC-other',
        numeric_id: 111111111,
      }], 200, { total_pages: 2 }))
      .mockResolvedValueOnce(accountsResponse([{
        id: 'ACC-current',
        numeric_id: 635117922,
      }], 200, { total_pages: 2 }));

    await expect(resolveCallRailAccountAliases(
      'server-secret',
      '635117922',
      { fetcher },
    )).resolves.toEqual(['635117922', 'ACC-current']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails explicitly when the account inventory exceeds the bounded lookup', async () => {
    const fetcher = vi.fn(async () => accountsResponse([], 200, { total_pages: 5 }));

    await expect(resolveCallRailAccountAliases(
      'server-secret',
      '635117922',
      { fetcher },
    )).rejects.toMatchObject({ code: 'CALLRAIL_DISCOVERY_TRUNCATED' });
  });

  it('fails closed when CallRail cannot prove the aliases', async () => {
    const fetcher = vi.fn(async () => accountsResponse([], 503));

    await expect(resolveCallRailAccountAliases(
      'server-secret',
      '635117922',
      { fetcher },
    )).rejects.toBeInstanceOf(CallRailDiscoveryError);
  });
});
