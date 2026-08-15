// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: useThread.frozen.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When the app can no longer confirm a technician still belongs to a chat, the
 *   messages already on screen are allowed to stay for a few seconds while it
 *   re-checks. This makes sure that during those seconds the app only SHOWS what
 *   it already had — it must not go and fetch newer messages, must not listen for
 *   incoming ones, and must not tell the server the chat has been read.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom/client, @tanstack/react-query, vitest
 *   Internal:  ./useThread
 *   Data:      reads  → none (the message fetch and the realtime channel are doubles)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a SECURITY test, not a performance one. The applied policy on
 *     public.messages is `messages_authenticated_select USING
 *     (messaging_can_access_conversations())` — page-level, with no conversation
 *     predicate. The per-conversation form lives in 20260731213100, which
 *     initiative-status.md records as UNAPPLIED. So a fetch issued for a
 *     conversation the technician was just removed from would return real rows,
 *     and this client-side gate is what stops it being issued.
 *   - `enabled` is the single choke point: it gates the pages query (and its
 *     reconnect refetch), the resume refetch, the realtime subscription and the
 *     mark-read write. Asserting through it is why one flag is enough.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTechQueryMemory, techKeys } from '@/lib/techQuery';

const spies = vi.hoisted(() => ({
  select: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  markRead: vi.fn(async () => {}),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { select: spies.select, rpc: vi.fn() },
    employee: { id: 'employee-1', full_name: 'Moroni Tech' },
  }),
}));
vi.mock('@/hooks/useLookup', () => ({ default: () => ({ data: [] }) }));
vi.mock('@/lib/realtime', () => ({
  subscribeToMessages: spies.subscribe,
  getAuthHeader: async () => ({}),
}));
vi.mock('@/lib/conversationUnread', () => ({ setMyConversationUnreadState: spies.markRead }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: vi.fn(), ok: vi.fn(), err: vi.fn() }));

const { useThread } = await import('./useThread');

const CACHED = {
  pages: [[{ id: 'm1', type: 'sms_inbound', body: 'already on screen', created_at: '2026-08-14T18:00:00Z' }]],
  pageParams: [null],
};

let container;
let root;
let client;
let latest;

function Probe({ frozen }) {
  const api = useThread('conv-1', { active: true, frozen });
  React.useEffect(() => { latest = api; });
  return null;
}

async function render(frozen) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe frozen={frozen} />
      </QueryClientProvider>,
    );
  });
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function resume() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  spies.select.mockReset().mockResolvedValue([]);
  spies.subscribe.mockReset().mockReturnValue(() => {});
  spies.markRead.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(techKeys.thread('conv-1'), CACHED);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.replaceChildren();
  client.clear();
  clearTechQueryMemory();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.restoreAllMocks();
});

describe('useThread frozen through the re-prove grace', () => {
  it('renders the cache it already had and acquires nothing', async () => {
    await render(true);

    // Still shows what was already proven — freezing is not blanking, which is
    // the whole point of holding the thread instead of unmounting it.
    expect(latest.messages.map((m) => m.body)).toEqual(['already on screen']);
    expect(latest.isColdStart).toBe(false);

    // …but every acquisition path is shut. The message fetch is the one that
    // matters most: on a real resume it fires on the SAME visibilitychange edge
    // that records the expiry, and it would merge in messages posted after a
    // removal.
    expect(spies.select).not.toHaveBeenCalled();
    expect(spies.subscribe).not.toHaveBeenCalled();
    // Mark-read is a WRITE. An expired lease must not send one either.
    expect(spies.markRead).not.toHaveBeenCalled();

    await act(async () => { resume(); });
    expect(spies.select).not.toHaveBeenCalled();
  });

  it('resumes fetching, subscribing and marking read once the lease is re-proven', async () => {
    await render(false);

    expect(spies.subscribe).toHaveBeenCalledWith('conv-1', expect.any(Function));
    expect(spies.markRead).toHaveBeenCalledWith(expect.anything(), ['conv-1'], false);

    await act(async () => { resume(); });
    for (let turn = 0; turn < 5; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(spies.select).toHaveBeenCalled();
    expect(spies.select.mock.calls[0][0]).toBe('messages');
  });
});
