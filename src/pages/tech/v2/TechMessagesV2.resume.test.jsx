// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: TechMessagesV2.resume.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The reported field bug, rendered: a technician has a conversation open, puts
 *   the phone away for more than half a minute, and comes back. The thread must
 *   still be there — not thrown back to the conversation list, not reloaded from
 *   scratch. This mounts the real messaging screen and checks the open thread is
 *   never taken down and put back up across that resume. It also checks the
 *   opposite case: when the server answers that the technician is no longer in
 *   the chat, the thread DOES close and everything it had is erased.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom/client, react-router-dom, @tanstack/react-query, vitest
 *   Internal:  ./TechMessagesV2, ./messages/accessRevocation, @/lib/techQuery,
 *              @/components/conversations/conversationAccessState
 *   Data:      reads  → none (get_tech_conversations is a test double)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The list, thread and composer views are test doubles ON PURPOSE. What broke
 *     was the PANE's mount decision plus what survives in the cache, and rendering
 *     the real ThreadView would drag in i18n, Capacitor and the whole bubble stack
 *     without adding proof. The router, the QueryClient, the pane host, the access
 *     module and the resume hook are all real — the seam under test is untouched.
 *   - A mount COUNTER is the assertion, not "is it on screen". A remount that
 *     lands in the same frame still cold-loads the thread and throws the scroll to
 *     the newest message, and that is exactly what the tech reported.
 *   - Resume is simulated with setSystemTime and NO timer advance, because that is
 *     what iOS suspension does: the wall clock moves, the pending timers do not
 *     fire until the app is resumed. Advancing timers instead would fire the poll
 *     mid-background and prove something that never happens on a phone.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTechQueryMemory, techKeys } from '@/lib/techQuery';
import { CONVERSATION_ACCESS_REPROVE_GRACE_MS } from '@/components/conversations/conversationAccessState';

const probe = vi.hoisted(() => ({
  threadMounts: 0, threadUnmounts: 0, listRenders: 0, search: '',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ db: globalThis.__uprTestDb, employee: { id: 'employee-1', role: 'field_tech' } }),
}));
vi.mock('./messages/useConvoMutations.js', () => ({
  useConvoMutations: () => ({ setUnread: vi.fn(), markAllRead: vi.fn(), enableDnd: vi.fn() }),
}));
// The inbox is deliberately EMPTY for the whole test. On resume its own lease is
// stale too, so useTechConversations returns nothing until it re-proves — which
// means the open thread cannot borrow its conversation row from the list. That is
// the real resume state, and the state in which the pane used to drop to the list.
vi.mock('./messages/useTechConversations.js', () => ({
  useTechConversations: () => ({
    conversations: [],
    statusCounts: {},
    isColdStart: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock('./messages/ConvoList.jsx', () => ({
  default: () => {
    probe.listRenders += 1;
    return <div data-testid="convo-list">list</div>;
  },
}));
vi.mock('./messages/NewConversationView.jsx', () => ({ default: () => <div>new</div> }));
vi.mock('./messages/ThreadView.jsx', () => {
  // Named + capitalised so the mount/unmount effect is a legal component hook.
  function ThreadViewProbe({ convId, conv }) {
    React.useEffect(() => {
      probe.threadMounts += 1;
      return () => { probe.threadUnmounts += 1; };
    }, []);
    return <div data-testid="thread-view" data-conv-id={convId}>{conv?.title}</div>;
  }
  return { default: ThreadViewProbe };
});

const { default: TechMessagesV2 } = await import('./TechMessagesV2.jsx');

const CONVERSATION = { id: 'conv-1', title: 'Wagner basement', status: 'active' };
const THREAD_PAGES = { pages: [[{ id: 'm1', body: 'water heater is leaking' }]] };
const T0 = new Date('2026-08-14T18:00:00.000Z');

let container;
let root;
let client;
let rpc;

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// Reports the live URL so the ?c= half of a revocation can be asserted — losing
// the thread while the deep link survives would walk straight back into it.
function LocationProbe() {
  probe.search = useLocation().search;
  return null;
}

function threadIsOpen() {
  return Boolean(container.querySelector('[data-testid="thread-view"]'));
}

// React Query commits a settled query through notifyManager, which schedules on a
// zero-delay timer. Under fake timers that timer never runs on its own, so the
// flush drains microtasks AND the 0ms slot. It deliberately advances no further:
// a real advance would fire the 30s lease timer and change what is being tested.
async function flush() {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });
  }
}

async function mountPane() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tech/conversations?c=conv-1']}>
          <Routes>
            <Route
              path="/tech/conversations"
              element={<><TechMessagesV2 active /><LocationProbe /></>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

// Reach the state the tech is in before the phone goes in the pocket: access
// proven, thread on screen, its messages cached.
async function openAProvenThread() {
  rpc = vi.fn(async () => ({ conversations: [CONVERSATION] }));
  await mountPane();
  await flush();
  expect(threadIsOpen()).toBe(true);
  expect(probe.threadMounts).toBe(1);
  client.setQueryData(techKeys.thread('conv-1'), THREAD_PAGES);
}

// iOS suspension: the wall clock moves past the 30s lease, pending timers do not
// fire, then the app comes back to the foreground.
async function suspendPastTheLeaseAndResume() {
  setVisibility('hidden');
  vi.setSystemTime(new Date(T0.getTime() + 35_000));
  await act(async () => { setVisibility('visible'); });
  await flush();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  probe.threadMounts = 0;
  probe.threadUnmounts = 0;
  probe.listRenders = 0;
  probe.search = '';
  setVisibility('visible');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.__uprTestDb = { rpc: (...args) => rpc(...args) };
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
  delete globalThis.__uprTestDb;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TechMessagesV2 — resume past the access lease', () => {
  it('never unmounts the open thread across expiry → successful re-proof', async () => {
    await openAProvenThread();

    // Hold the re-proof open so the mid-flight frame — the one the tech actually
    // sees on resume — can be asserted rather than skipped over.
    let answerReproof;
    rpc = vi.fn(() => new Promise((resolve) => { answerReproof = resolve; }));
    await suspendPastTheLeaseAndResume();

    // MID RE-PROOF. Before the fix this frame showed the conversation list.
    expect(threadIsOpen()).toBe(true);
    expect(probe.threadUnmounts).toBe(0);
    // …and its messages are still cached, so the thread has nothing to cold-load
    // and no reason to snap a mid-history scroll back to the newest message.
    expect(client.getQueryData(techKeys.thread('conv-1'))).toEqual(THREAD_PAGES);

    await act(async () => { answerReproof({ conversations: [CONVERSATION] }); });
    await flush();

    // AFTER: same instance throughout. One mount, zero unmounts, cache intact.
    expect(threadIsOpen()).toBe(true);
    expect(probe.threadMounts).toBe(1);
    expect(probe.threadUnmounts).toBe(0);
    expect(client.getQueryData(techKeys.thread('conv-1'))).toEqual(THREAD_PAGES);
    // The lease is genuinely renewed, not merely tolerated: the grace is closed
    // and the tombstone is gone.
    const access = client.getQueryData(techKeys.conversationAccess('employee-1', 'conv-1'));
    expect(access.conversation).toMatchObject({ id: 'conv-1' });
    expect(access.accessProofExpired).toBeUndefined();
  });

  it('ejects and purges when the re-proof proves the tech was removed', async () => {
    await openAProvenThread();

    let answerReproof;
    rpc = vi.fn(() => new Promise((resolve) => { answerReproof = resolve; }));
    await suspendPastTheLeaseAndResume();
    expect(threadIsOpen()).toBe(true);

    // The server says: not a member. This is the case the grace must never soften.
    await act(async () => { answerReproof({ conversations: [] }); });
    await flush();

    expect(threadIsOpen()).toBe(false);
    expect(probe.threadUnmounts).toBe(1);
    expect(container.querySelector('[data-testid="convo-list"]')).toBeTruthy();
    expect(client.getQueryData(techKeys.thread('conv-1'))).toBeUndefined();
    // A denial is total: the access probe's own cache goes as well, so nothing is
    // left to re-render the thread from…
    expect(client.getQueryData(techKeys.conversationAccess('employee-1', 'conv-1')))
      .toBeUndefined();
    // …and ?c= is dropped, so a reload cannot walk straight back into it.
    expect(probe.search).not.toContain('conv-1');
  });

  it('closes the thread and empties the cache when the re-proof never answers', async () => {
    await openAProvenThread();

    // Offline: the probe hangs. The grace is a bounded loan, not a licence.
    rpc = vi.fn(() => new Promise(() => {}));
    await suspendPastTheLeaseAndResume();
    expect(threadIsOpen()).toBe(true);

    await act(async () => { vi.advanceTimersByTime(CONVERSATION_ACCESS_REPROVE_GRACE_MS); });
    await flush();

    expect(threadIsOpen()).toBe(false);
    expect(probe.threadUnmounts).toBe(1);
    expect(client.getQueryData(techKeys.thread('conv-1'))).toBeUndefined();
    // Still EXPIRED, not DENIED: the route keeps re-proving rather than revoking.
    expect(client.getQueryData(techKeys.conversationAccess('employee-1', 'conv-1')))
      .toMatchObject({ conversation: null, accessProofExpired: true });
  });
});
