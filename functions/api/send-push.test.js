/**
 * ════════════════════════════════════════════════
 * FILE: send-push.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the notification diagnostic can target only the company owner's own
 *   iPhone with fixed copy and a fixed destination. It rejects attempts to pick
 *   another employee or provide arbitrary notification content.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./send-push.js
 *   Data:      none (authentication, database, and Apple delivery are fakes)
 *
 * NOTES / GOTCHAS:
 *   - No real provider call or notification is sent.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {},
  send: vi.fn(),
}));

vi.mock('../lib/supabase.js', () => ({
  supabase: vi.fn(() => h.db),
}));
vi.mock('../lib/auth.js', () => ({
  requireOwner: (...args) => h.auth(...args),
}));
vi.mock('../lib/apns.js', () => ({
  sendNativePushToEmployee: (...args) => h.send(...args),
}));

const { onRequestPost } = await import('./send-push.js');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function request(body) {
  return new Request('https://dev.utahpros.app/api/send-push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://dev.utahpros.app',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({
    user: { id: 'auth-owner' },
    employee: {
      id: 'employee-owner',
      email: 'moroni@utah-pros.com',
      role: 'admin',
    },
  });
  h.send.mockResolvedValue({ sent: 1, attempted: 1, pruned: 0 });
});

describe('POST /api/send-push', () => {
  it('sends only the fixed owner self-test with a stable request identity', async () => {
    const env = { APNS_ENV: 'sandbox' };
    const response = await onRequestPost({
      request: request({ request_id: REQUEST_ID }),
      env,
    });

    expect(response.status).toBe(200);
    expect(h.send).toHaveBeenCalledWith({
      db: h.db,
      env,
      employeeId: 'employee-owner',
      typeKey: 'owner.native_push_test',
      eventKey: `owner-native-push-test:${REQUEST_ID}`,
    });
  });

  it.each([
    { request_id: REQUEST_ID, employee_id: 'employee-victim' },
    { request_id: REQUEST_ID, title: 'Arbitrary copy' },
    { request_id: REQUEST_ID, data: { url: '/admin' } },
    { request_id: 'not-a-uuid' },
  ])('rejects employee selection and arbitrary message fields', async (body) => {
    const response = await onRequestPost({
      request: request(body),
      env: {},
    });

    expect(response.status).toBe(400);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('does not call APNs when owner authorization fails', async () => {
    h.auth.mockResolvedValue({ error: 'Insufficient role', status: 403 });

    const response = await onRequestPost({
      request: request({ request_id: REQUEST_ID }),
      env: {},
    });

    expect(response.status).toBe(403);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('reports missing provider configuration as unavailable', async () => {
    h.send.mockResolvedValue({
      sent: 0,
      attempted: 0,
      pruned: 0,
      skipped: true,
      reason: 'apns_not_configured',
    });

    const response = await onRequestPost({
      request: request({ request_id: REQUEST_ID }),
      env: {},
    });

    expect(response.status).toBe(503);
  });
});
