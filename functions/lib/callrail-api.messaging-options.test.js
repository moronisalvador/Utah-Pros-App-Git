import { describe, expect, it, vi } from 'vitest';
import {
  CallRailDiscoveryError,
  discoverCallRailMessagingOptions,
} from './callrail-api.js';

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('discoverCallRailMessagingOptions', () => {
  it('returns only active SMS-enabled tracking numbers and strips call-flow data', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({
        total_pages: 1,
        trackers: [
          {
            id: 'TRK1',
            name: 'Main line',
            type: 'source',
            status: 'active',
            sms_supported: true,
            sms_enabled: true,
            tracking_numbers: ['+18015550100'],
            destination_number: '+18015550999',
            call_flow: { secret: 'not-for-browser' },
            company: { id: 'COM1', name: 'Utah Pros' },
          },
          {
            id: 'TRK2',
            status: 'disabled',
            sms_supported: true,
            sms_enabled: true,
            tracking_numbers: ['+18015550200'],
            company: { id: 'COM1', name: 'Utah Pros' },
          },
          {
            id: 'TRK3',
            status: 'active',
            sms_supported: true,
            sms_enabled: false,
            tracking_numbers: ['+18015550300'],
            company: { id: 'COM1', name: 'Utah Pros' },
          },
        ],
      }));

    const result = await discoverCallRailMessagingOptions('stored-key', {
      accountId: 'ACC1',
      fetcher,
    });

    expect(result).toEqual([{
      id: 'COM1',
      name: 'Utah Pros',
      senders: [{
        option_id: 'TRK1:+18015550100',
        tracker_id: 'TRK1',
        tracker_name: 'Main line',
        tracker_type: 'source',
        tracking_number: '+18015550100',
        sms_supported: true,
        sms_enabled: true,
      }],
    }]);
    expect(JSON.stringify(result)).not.toContain('destination_number');
    expect(JSON.stringify(result)).not.toContain('not-for-browser');
    expect(fetcher.mock.calls[0][0]).toContain('/a/ACC1/trackers.json');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toContain('stored-key');
    expect(fetcher.mock.calls[0][2]).toBe(5_000);
  });

  it('fails closed rather than returning a truncated inventory', async () => {
    const fetcher = vi.fn()
      .mockResolvedValue(json({ total_pages: 99, trackers: [] }));

    await expect(discoverCallRailMessagingOptions('stored-key', {
      accountId: 'ACC1',
      fetcher,
      maxPages: 99,
    })).rejects.toMatchObject({ code: 'CALLRAIL_DISCOVERY_TRUNCATED' });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'CALLRAIL_CREDENTIAL_REJECTED', 503],
    [403, 'CALLRAIL_CREDENTIAL_REJECTED', 503],
    [429, 'CALLRAIL_DISCOVERY_RATE_LIMITED', 429],
    [500, 'CALLRAIL_DISCOVERY_UNAVAILABLE', 503],
  ])('maps provider %s without exposing its body', async (upstreamStatus, code, status) => {
    const fetcher = vi.fn(async () => json({ raw: 'provider detail' }, upstreamStatus));

    await expect(discoverCallRailMessagingOptions('stored-key', { accountId: 'ACC1', fetcher }))
      .rejects.toMatchObject({ code, status });
  });

  it('maps a timeout to a safe discovery error', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('socket timeout with sensitive detail');
    });

    await expect(discoverCallRailMessagingOptions('stored-key', { accountId: 'ACC1', fetcher }))
      .rejects.toEqual(expect.any(CallRailDiscoveryError));
  });

  it('requires a pre-resolved account instead of guessing across accounts', async () => {
    const fetcher = vi.fn();

    await expect(discoverCallRailMessagingOptions('stored-key', { fetcher }))
      .rejects.toMatchObject({ code: 'CALLRAIL_ACCOUNT_ID_MISSING' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
