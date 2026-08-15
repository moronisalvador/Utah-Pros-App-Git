/**
 * ════════════════════════════════════════════════
 * FILE: collections-chat-qbo-availability.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a collections-chat request about information already on the
 *   screen still receives an answer when QuickBooks is unavailable.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  collections-chat.js and mocked worker helpers
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - All database and provider behavior is mocked; this test never contacts either service.
 * ════════════════════════════════════════════════
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  requireTraffic: vi.fn(),
  getConnection: vi.fn(),
  recordRun: vi.fn(),
}));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboBrowserRequest: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({ insert: vi.fn() }),
}));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: (...args) => h.getConnection(...args),
  qboFetch: vi.fn(),
}));
vi.mock('../lib/qbo-provider-traffic.js', () => ({
  requireQboProviderTraffic: (...args) => h.requireTraffic(...args),
  isQboProviderTrafficDisabled: (error) => error?.code === 'qbo_provider_traffic_disabled',
}));
vi.mock('./qbo-provider-traffic-response.js', () => ({
  qboProviderTrafficDisabledRouteResponse: vi.fn(),
}));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: (...args) => h.recordRun(...args) }));

import { onRequestPost } from './collections-chat.js';

const request = () => new Request('https://app.test/api/collections-chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Summarize the visible overdue total.' }] }),
});
const env = { ANTHROPIC_API_KEY: 'test-key' };

beforeEach(() => {
  vi.clearAllMocks();
  h.requireTraffic.mockRejectedValue(Object.assign(new Error('maintenance'), { code: 'qbo_provider_traffic_disabled' }));
  h.getConnection.mockResolvedValue(null);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    stop_reason: 'end_turn', content: [{ type: 'text', text: 'Use the overdue total shown on screen.' }],
  }), { status: 200 }));
});
afterEach(() => vi.restoreAllMocks());

describe('collections-chat local-only availability', () => {
  it('answers a local-only turn while the QBO provider gate is closed', async () => {
    const response = await onRequestPost({ request: request(), env });
    await expect(response.json()).resolves.toEqual({ reply: 'Use the overdue total shown on screen.' });
    expect(h.requireTraffic).not.toHaveBeenCalled();
    expect(h.getConnection).not.toHaveBeenCalled();
  });

  it('answers a local-only turn while QuickBooks is disconnected', async () => {
    const response = await onRequestPost({ request: request(), env });
    expect(response.status).toBe(200);
    expect(h.requireTraffic).not.toHaveBeenCalled();
    expect(h.getConnection).not.toHaveBeenCalled();
  });
});
