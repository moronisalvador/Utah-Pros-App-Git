/**
 * ════════════════════════════════════════════════
 * FILE: MessagingSetupPanel.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the admin messaging panel stays read-only, uses the dedicated text
 *   route, filters ineligible senders, and keeps RCS fallback disabled.
 *
 * DEPENDS ON:
 *   Packages:  vitest, react-dom/server
 *   Internal:  ./MessagingSetupPanel
 * ════════════════════════════════════════════════
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));
vi.mock('@/lib/toast', () => ({ ok: vi.fn(), err: vi.fn() }));

import {
  MessagingSetupView,
  messagingLoadFailure,
  requestMessagingSetup,
} from './MessagingSetupPanel';

const callbacks = {
  onSelectOption: vi.fn(),
  onLoadOptions: vi.fn(),
  onCopyWebhook: vi.fn(),
  onCopyHandoff: vi.fn(),
  onRefresh: vi.fn(),
};

const status = {
  environment: 'preview',
  transport: {
    schema_mode: 'foundation',
    send_mode: 'disabled',
    mode_mutable_in_app: false,
    outbound_enabled: false,
  },
  callrail: {
    credential_configured: true,
    account_resolved: true,
    company_configured: false,
    tracking_number_configured: false,
    signing_key_configured: false,
    text_webhook: { path: '/api/callrail-text-webhook', configured: false },
    ready_for_activation: false,
  },
  health: {
    checked: true,
    pending_events: 0,
    ambiguous_attempts: 0,
    pending_notifications: 0,
  },
  blockers: [
    { code: 'CALLRAIL_COMPANY_MISSING', scope: 'configuration' },
    { code: 'MESSAGING_SEND_DISABLED', scope: 'activation' },
  ],
};

const options = {
  companies: [{
    id: 'COM-safe',
    name: 'Utah Pros',
    senders: [{
      tracker_id: 'TRK-safe',
      tracker_name: 'Main Office',
      tracker_type: 'source',
      tracking_number: '+18015550100',
      sms_supported: true,
      sms_enabled: true,
    }],
  }],
};

describe('MessagingSetupPanel', () => {
  it('renders disabled mode, the dedicated text route, and the RCS no-fallback warning', () => {
    const output = renderToStaticMarkup(
      <MessagingSetupView
        {...callbacks}
        status={status}
        options={null}
        optionsState="idle"
        selectedOptionId=""
      />,
    );

    expect(output).toContain('Sending disabled');
    expect(output).toContain('/api/callrail-text-webhook');
    expect(output).toContain('MESSAGING_SEND_MODE');
    expect(output).toContain('Twilio can automatically fall back from RCS to SMS/MMS');
    expect(output).toContain('explicit no-fallback behavior');
    expect(output).not.toContain('CALLRAIL_SIGNING_KEY');
    expect(output).not.toContain('?secret=');
    expect(output).not.toContain('Enable CallRail');
  });

  it('shows an eligible sender as a non-activating handoff selection', () => {
    const output = renderToStaticMarkup(
      <MessagingSetupView
        {...callbacks}
        status={status}
        options={options}
        optionsState="ready"
        selectedOptionId="COM-safe:TRK-safe:+18015550100"
      />,
    );

    expect(output).toContain('Main Office');
    expect(output).toContain('(801) 555-0100');
    expect(output).toContain('Selected for operator handoff');
    expect(output).toContain('CALLRAIL_COMPANY_ID=COM-safe');
    expect(output).toContain('CALLRAIL_TRACKING_NUMBER=+18015550100');
    expect(output).toContain('Copy activation handoff');
  });

  it('filters trackers that are not both SMS-supported and SMS-enabled', () => {
    const mixedOptions = {
      companies: [{
        id: 'COM-1',
        name: 'Utah Pros',
        senders: [
          { tracker_id: 'eligible', tracker_name: 'Eligible', tracking_number: '+18015550100', sms_supported: true, sms_enabled: true },
          { tracker_id: 'unsupported', tracker_name: 'Unsupported', tracking_number: '+18015550101', sms_supported: false, sms_enabled: true },
          { tracker_id: 'disabled', tracker_name: 'Disabled', tracking_number: '+18015550102', sms_supported: true, sms_enabled: false },
        ],
      }],
    };
    const output = renderToStaticMarkup(
      <MessagingSetupView
        {...callbacks}
        status={status}
        options={mixedOptions}
        optionsState="ready"
        selectedOptionId=""
      />,
    );

    expect(output).toContain('Eligible');
    expect(output).not.toContain('Unsupported');
    expect(output).not.toContain('Disabled');
  });

  it('maps backend health blockers to plain admin guidance', () => {
    const blockerStatus = {
      ...status,
      blockers: [
        { code: 'CALLRAIL_ATTEMPTS_AMBIGUOUS', scope: 'health' },
        { code: 'FUTURE_SAFE_BLOCKER', scope: 'configuration' },
      ],
    };
    const output = renderToStaticMarkup(
      <MessagingSetupView
        {...callbacks}
        status={blockerStatus}
        options={null}
        optionsState="idle"
        selectedOptionId=""
      />,
    );

    expect(output).toContain('One or more CallRail sends require reconciliation.');
    expect(output).toContain('Future Safe Blocker');
  });

  it('marks missing health evidence as not ready instead of assuming zero backlog', () => {
    const output = renderToStaticMarkup(
      <MessagingSetupView
        {...callbacks}
        status={{ ...status, health: {} }}
        options={null}
        optionsState="idle"
        selectedOptionId=""
      />,
    );

    expect(output).toContain('Not ready: </span>No shared messaging recovery backlog');
  });

  it('uses GET-only no-store requests and propagates safe API failures', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    const authHeader = vi.fn(async () => ({ Authorization: 'Bearer test' }));

    await expect(requestMessagingSetup('callrail-options', { fetcher, authHeader }))
      .resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/messaging-setup?action=callrail-options',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer test' },
        cache: 'no-store',
      },
    );

    const failingFetcher = vi.fn(async () => ({
      ok: false,
      statusText: 'Unavailable',
      json: async () => ({ error: 'Messaging setup unavailable' }),
    }));
    await expect(requestMessagingSetup(undefined, { fetcher: failingFetcher, authHeader }))
      .rejects.toThrow('Messaging setup unavailable');
  });

  it('classifies cold failures as retryable errors and refresh failures as stale-data banners', () => {
    expect(messagingLoadFailure({ cold: true, hasStatus: false })).toEqual({
      loadError: 'Messaging setup status is unavailable.',
      refreshError: '',
    });
    expect(messagingLoadFailure({ cold: false, hasStatus: true })).toEqual({
      loadError: '',
      refreshError: 'Messaging setup status could not be refreshed.',
    });
  });
});
