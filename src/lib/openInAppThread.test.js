/**
 * ════════════════════════════════════════════════
 * FILE: openInAppThread.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that tapping Message keeps the tech inside UPR. The important cases are
 *   the unhappy ones: no contact, or the server call failing. In both, the tech must
 *   still land in the app's own messaging screen — never back in the phone's SMS app,
 *   because a text sent from a personal number never reaches the customer's UPR
 *   thread and nobody in the office can see it.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/openInAppThread.js
 * ════════════════════════════════════════════════
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({
  getAuthHeader: async () => ({ Authorization: 'Bearer test-token' }),
}));
vi.mock('@/lib/toast', () => ({ err: vi.fn() }));

const { openInAppThread, threadHref, pickerHref } = await import('./openInAppThread.js');

const okResponse = (body) => ({ ok: true, json: async () => body });

describe('openInAppThread', () => {
  it('opens the resolved thread for a contact', async () => {
    const navigate = vi.fn();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, conversation: { id: 'conv-1' } }));

    await openInAppThread(navigate, 'contact-1', { fetchFn });

    expect(navigate).toHaveBeenCalledWith(threadHref('conv-1'));
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/api/message-conversations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ contact_id: 'contact-1' });
    // The browser must go through the Worker, never the privileged RPC directly.
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('falls back to the in-app picker when there is no contact', async () => {
    const navigate = vi.fn();
    const fetchFn = vi.fn();

    await openInAppThread(navigate, null, { fetchFn });

    expect(navigate).toHaveBeenCalledWith(pickerHref());
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stays in the app and reports the error when the lookup fails', async () => {
    const navigate = vi.fn();
    const onError = vi.fn();
    const fetchFn = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'nope' }) }));

    await openInAppThread(navigate, 'contact-1', { fetchFn, onError });

    expect(onError).toHaveBeenCalledWith('nope');
    expect(navigate).toHaveBeenCalledWith(pickerHref());
  });

  it('never routes to a native sms: link', async () => {
    const navigate = vi.fn();
    const fetchFn = vi.fn(async () => okResponse({ ok: true, conversation: { id: 'c' } }));

    await openInAppThread(navigate, 'contact-1', { fetchFn });
    await openInAppThread(navigate, null, { fetchFn });

    for (const [target] of navigate.mock.calls) {
      expect(String(target).startsWith('/tech/conversations')).toBe(true);
      expect(String(target)).not.toMatch(/^sms:/);
    }
  });
});
