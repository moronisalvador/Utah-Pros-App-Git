/**
 * ════════════════════════════════════════════════
 * FILE: qbo-auth.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Verifies QuickBooks authorization keeps bearer verification on the caller's
 *   bounded transport and fails closed before any employee database lookup when
 *   that transport times out.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo-auth.js
 *   Data:      none (database and transport are in-memory spies)
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { authorizeQboBrowserRequest, authorizeQboRequest } from './qbo-auth.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-key' };

function bearerRequest() {
  return new Request('https://app.test/api/qbo-payment', {
    headers: { Authorization: 'Bearer session-token' },
  });
}

describe('QuickBooks bearer authorization transport', () => {
  it('uses the caller-provided bounded transport for bearer authentication', async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }));
    const db = { select: vi.fn().mockResolvedValue([{ id: 'employee-1', role: 'admin', is_active: true, is_external: false }]) };

    const result = await authorizeQboBrowserRequest(bearerRequest(), ENV, db, transport);

    expect(result).toMatchObject({ ok: true, via: 'bearer' });
    expect(transport).toHaveBeenCalledWith('https://db.test/auth/v1/user', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
    expect(db.select).toHaveBeenCalledOnce();
  });

  it('fails closed on a bounded-transport timeout before database or provider work', async () => {
    const timeout = vi.fn().mockRejectedValue(new DOMException('The operation timed out', 'AbortError'));
    const db = { select: vi.fn() };

    const result = await authorizeQboRequest(bearerRequest(), ENV, db, timeout);

    expect(result).toEqual({ ok: false, status: 502, error: 'Authorization check failed' });
    expect(timeout).toHaveBeenCalledOnce();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('preserves the trusted webhook-secret bypass without invoking a bearer transport', async () => {
    const transport = vi.fn();
    const request = new Request('https://app.test/api/qbo-payment', { headers: { 'x-webhook-secret': 'trusted' } });

    const result = await authorizeQboRequest(request, { ...ENV, QBO_WEBHOOK_SECRET: 'trusted' }, { select: vi.fn() }, transport);

    expect(result).toEqual({ ok: true, via: 'webhook' });
    expect(transport).not.toHaveBeenCalled();
  });
});
