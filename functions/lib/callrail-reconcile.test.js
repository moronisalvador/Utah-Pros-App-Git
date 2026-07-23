import { describe, expect, it, vi } from 'vitest';

import {
  CallrailReconcileError,
  findCallrailAttemptOutcome,
} from './callrail-reconcile.js';

const ATTEMPT = {
  id: 'attempt-1',
  message_id: 'message-1',
  provider: 'callrail',
  state: 'ambiguous',
  recipient_address: '+18015551212',
  submitted_body: 'Rep: Exact customer message',
  started_at: '2026-07-23T18:00:00.000Z',
};
const MESSAGE = {
  id: 'message-1',
  provider: 'callrail',
  recipient_address: '+18015551212',
  body: 'Exact customer message',
};
const CONFIG = {
  accountId: 'ACC-test',
  apiKey: 'secret-test-key',
  companyId: 'COM-test',
  trackingNumber: '+13853360611',
};

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function conversation(messages, overrides = {}) {
  return {
    id: 'provider-conv-1',
    company_id: 'COM-test',
    customer_phone_number: '+18015551212',
    current_tracking_number: '+13853360611',
    messages,
    ...overrides,
  };
}

describe('CallRail ambiguous attempt reconciliation', () => {
  it('finds one exact outgoing provider result without sending', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({
        conversations: [conversation([], { messages: undefined })],
      }))
      .mockResolvedValueOnce(response(conversation([{
        id: 23456,
        content: ATTEMPT.submitted_body,
        created_at: '2026-07-23T18:00:08.000Z',
        direction: 'outgoing',
        type: 'sms',
      }])));

    const result = await findCallrailAttemptOutcome({
      attempt: ATTEMPT,
      message: MESSAGE,
      config: CONFIG,
      now: new Date('2026-07-23T18:05:00.000Z'),
      fetchImpl,
    });

    expect(result).toMatchObject({
      providerMessageId: '23456',
      providerConversationId: 'provider-conv-1',
      providerStatus: 'sent',
      confirmed: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.callrail\.com\/v3\/a\/ACC-test\/text-messages\.json\?/,
    );
    expect(fetchImpl.mock.calls[0][0]).not.toContain('secret-test-key');
  });

  it('uses a known provider conversation and recognizes a provider failure', async () => {
    const fetchImpl = vi.fn(async () => response(conversation([{
      id: 'msg-error',
        content: ATTEMPT.submitted_body,
      created_at: '2026-07-23T18:00:20.000Z',
      status: 'error',
      direction: 'outgoing',
      type: 'sms',
    }])));
    const result = await findCallrailAttemptOutcome({
      attempt: { ...ATTEMPT, provider_conversation_id: 'provider-conv-1' },
      message: MESSAGE,
      config: CONFIG,
      now: new Date('2026-07-23T18:05:00.000Z'),
      fetchImpl,
    });
    expect(result).toMatchObject({ confirmed: false, providerStatus: 'error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when CallRail appends or changes the body', async () => {
    const fetchImpl = vi.fn(async () => response(conversation([{
      id: 'msg-1',
      content: `${ATTEMPT.submitted_body} Reply STOP to opt out.`,
      created_at: '2026-07-23T18:00:08.000Z',
      status: 'sent',
      direction: 'outgoing',
    }])));
    await expect(findCallrailAttemptOutcome({
      attempt: { ...ATTEMPT, provider_conversation_id: 'provider-conv-1' },
      message: MESSAGE,
      config: CONFIG,
      now: new Date('2026-07-23T18:05:00.000Z'),
      fetchImpl,
    })).rejects.toMatchObject({
      code: 'CALLRAIL_RECONCILE_MESSAGE_NOT_FOUND',
      retryable: true,
    });
  });

  it('fails closed for multiple time-and-content matches', async () => {
    const providerMessage = {
      content: ATTEMPT.submitted_body,
      created_at: '2026-07-23T18:00:08.000Z',
      status: 'sent',
      direction: 'outgoing',
    };
    const fetchImpl = vi.fn(async () => response(conversation([
      { ...providerMessage, id: 'msg-1' },
      { ...providerMessage, id: 'msg-2' },
    ])));
    await expect(findCallrailAttemptOutcome({
      attempt: { ...ATTEMPT, provider_conversation_id: 'provider-conv-1' },
      message: MESSAGE,
      config: CONFIG,
      now: new Date('2026-07-23T18:05:00.000Z'),
      fetchImpl,
    })).rejects.toMatchObject({
      code: 'CALLRAIL_RECONCILE_MESSAGE_AMBIGUOUS',
      retryable: false,
    });
  });

  it('refuses incomplete ledger identity before provider access', async () => {
    const fetchImpl = vi.fn();
    await expect(findCallrailAttemptOutcome({
      attempt: { ...ATTEMPT, message_id: null },
      message: MESSAGE,
      config: CONFIG,
      fetchImpl,
    })).rejects.toBeInstanceOf(CallrailReconcileError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
