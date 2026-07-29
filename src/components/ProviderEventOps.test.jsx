/**
 * ════════════════════════════════════════════════
 * FILE: ProviderEventOps.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders the provider-event queue without a browser to prove failures are
 *   understandable, actionable, and distinct from an honestly empty queue.
 *
 * DEPENDS ON:
 *   Packages:  react-dom/server, vitest
 *   Internal:  ./ProviderEventOps.jsx
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({
  getAuthHeader: async () => ({}),
}));

import { ProviderEventList } from './ProviderEventOps.jsx';

const EVENT = {
  id: '79d5a4cd-7c76-4944-82dd-a5dd4379be22',
  direction: 'outbound',
  message_type: 'sms',
  error_code: 'CALLRAIL_OUTBOUND_UNMATCHED',
  processing_state: 'failed',
  processing_attempts: 8,
  sender_address: '385-360-4121',
  recipient_address: '385-314-5700',
  received_at: '2026-07-27T00:06:01.266Z',
};

describe('ProviderEventList', () => {
  it('shows the exact failure, parties, state, and safe actions', () => {
    const output = renderToStaticMarkup(
      <ProviderEventList
        events={[EVENT]}
        busyId={null}
        isResolveArmed={() => false}
        onRetry={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    expect(output).toContain('CALLRAIL_OUTBOUND_UNMATCHED');
    expect(output).toContain('385-360-4121');
    expect(output).toContain('385-314-5700');
    expect(output).toContain('Retry');
    expect(output).toContain('Mark resolved');
    expect(output).not.toContain('message body');
  });

  it('uses the shared success-empty state only for a successfully empty queue', () => {
    const output = renderToStaticMarkup(
      <ProviderEventList
        events={[]}
        busyId={null}
        isResolveArmed={() => false}
        onRetry={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    expect(output).toContain('No unresolved provider events');
  });
});
