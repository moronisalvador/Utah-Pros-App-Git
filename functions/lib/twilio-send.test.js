import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  resolveCredential: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock('./credentials.js', () => ({
  resolveCredential: (...args) => h.resolveCredential(...args),
}));
vi.mock('./http.js', () => ({
  fetchWithTimeout: (...args) => h.fetchWithTimeout(...args),
}));

import { sendMessage } from './twilio.js';

const CREDENTIALS = {
  accountSid: 'ACtest',
  authToken: 'secret',
  messagingServiceSid: 'MGtest',
  phoneNumber: null,
};

beforeEach(() => {
  h.resolveCredential.mockReset();
  h.fetchWithTimeout.mockReset();
  h.resolveCredential.mockResolvedValue(CREDENTIALS);
});

describe('Twilio outbound ambiguity boundary', () => {
  it('marks only a provider-request failure as ambiguous', async () => {
    h.fetchWithTimeout.mockRejectedValue(new Error('connection reset'));

    await expect(sendMessage({}, {
      to: '+15551112222',
      body: 'Hello',
    })).rejects.toMatchObject({
      message: 'connection reset',
      ambiguous: true,
    });
  });

  it('does not mark credential resolution failure as ambiguous', async () => {
    const error = new Error('credentials unavailable');
    error.code = 'TWILIO_NOT_CONFIGURED';
    h.resolveCredential.mockRejectedValue(error);

    await expect(sendMessage({}, {
      to: '+15551112222',
      body: 'Hello',
    })).rejects.toMatchObject({
      code: 'TWILIO_NOT_CONFIGURED',
    });
    expect(error.ambiguous).toBeUndefined();
    expect(h.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('keeps a conclusive Twilio rejection non-ambiguous', async () => {
    h.fetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({
      code: 21_611,
      message: 'Destination cannot receive SMS',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));

    const error = await sendMessage({}, {
      to: '+15551112222',
      body: 'Hello',
    }).catch((caught) => caught);

    expect(error.message).toContain('Twilio send failed:');
    expect(error.ambiguous).toBeUndefined();
  });

  it('marks an unreadable successful provider response as ambiguous', async () => {
    h.fetchWithTimeout.mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn(async () => {
        throw new Error('truncated response');
      }),
    });

    await expect(sendMessage({}, {
      to: '+15551112222',
      body: 'Hello',
    })).rejects.toMatchObject({
      message: 'truncated response',
      ambiguous: true,
    });
  });

  it('marks a successful response without a message identity as ambiguous', async () => {
    h.fetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({
      status: 'queued',
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(sendMessage({}, {
      to: '+15551112222',
      body: 'Hello',
    })).rejects.toMatchObject({
      ambiguous: true,
    });
  });
});
