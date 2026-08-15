// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: Conversations.resume.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   Leave the office Messages tab for longer than half a minute, then come back.
 *   Everything must be exactly as you left it: the reply you were typing, the
 *   conversation you had open, and your place in it. Only actually losing access
 *   to the chat is allowed to take those away.
 *
 *   This one MOUNTS the real page — the source-text checks in
 *   tests/qa/unit/conversation-access-lease.test.js prove the wiring exists, and
 *   they kept passing while resume still flashed spinners and jumped the scroll,
 *   because the tokens they look for were all present. Behavior needs running it.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom/client, react-router-dom, @tanstack/react-query, vitest
 *   Internal:  ./Conversations, @/components/conversations/messageUtils
 *   Data:      reads/writes → mocked db + real localStorage drafts
 *
 * NOTES / GOTCHAS:
 *   - Time is advanced with setSystemTime, NOT advanceTimersByTime. A suspended
 *     browser tab does not fire 30 seconds of queued timers on resume; it wakes
 *     and runs the visibilitychange handler. Firing the timers instead also spins
 *     forever here, because the lease-expiry effect reschedules itself at 0ms once
 *     the proof is stale.
 *   - The page's own poll self-suspends on document.hidden, which is WHY the lease
 *     is allowed to age out. Do not "fix" a failure by leaving the tab visible.
 *   - useAuth must return the SAME db object every render. A fresh literal makes
 *     every db-dependent callback unstable and the mount never settles.
 * ════════════════════════════════════════════════
 */
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDraft } from '@/components/conversations/messageUtils';
import Conversations from './Conversations';

const CONV_ID = '11111111-1111-4111-8111-111111111111';
const LEASE_MS = 30_000;
const realDateNow = Date.now;
let clockOffset = 0;

const mocks = vi.hoisted(() => {
  const select = vi.fn();
  const rpc = vi.fn();
  return {
    select,
    rpc,
    toast: vi.fn(),
    // ONE db object for the whole run. The real AuthContext guarantees a stable
    // db identity (page-lifecycle.md §2, src/lib/stableDb.js); returning a fresh
    // literal per render instead makes loadConversations a new callback every
    // render, so its effect re-fires forever and the mount never settles — the
    // suite hangs with no output rather than failing.
    db: { select, rpc },
    employee: { id: 'emp-1', role: 'admin', is_active: true },
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: mocks.db,
    employee: mocks.employee,
    pwaOwnerLease: null,
  }),
}));
vi.mock('@/hooks/useLookup', () => ({ default: () => ({ data: [] }) }));
vi.mock('@/lib/realtime', () => ({
  subscribeToMessages: () => () => {},
  subscribeToConversations: () => () => {},
  getAuthHeader: async () => ({}),
}));
vi.mock('@/lib/toast', () => ({ toast: mocks.toast, err: vi.fn(), ok: vi.fn() }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: vi.fn(), notify: vi.fn(), selection: vi.fn() }));
vi.mock('@/lib/conversationUnread', () => ({ setMyConversationUnreadState: vi.fn(async () => {}) }));

const CONTACT = {
  id: 'contact-1',
  name: 'Dana Rivera',
  phone: '+18015550123',
  email: null,
  company: null,
  role: 'customer',
  dnd: false,
  dnd_at: null,
  opt_in_status: true,
  opt_in_source: 'form',
  opt_in_at: '2026-01-01T00:00:00Z',
  opt_out_at: null,
  opt_out_reason: null,
};

const CONVERSATION = {
  id: CONV_ID,
  title: 'Dana Rivera',
  status: 'needs_response',
  unread_count: 0,
  job_id: null,
  last_message_at: '2026-08-14T17:00:00Z',
  last_message_preview: 'Sounds good',
  conversation_participants: [
    { contact_id: CONTACT.id, phone: CONTACT.phone, role: 'customer', contacts: CONTACT },
  ],
};

// Non-UUID ids keep the historical-author lookup disabled, so the thread renders
// without another network mock.
const MESSAGES = [{
  id: 'msg-1',
  type: 'sms_inbound',
  body: 'Can you come Thursday?',
  status: 'received',
  sent_by: null,
  sender_contact_id: CONTACT.id,
  media_urls: null,
  error_code: null,
  error_message: null,
  num_segments: 1,
  client_request_id: null,
  created_at: '2026-08-14T17:00:00Z',
}];

let container;
let root;
let currentSearch;
let inboxRows;
let scrollSpy;
// When set, the inbox refresh parks here until the test releases it. Without
// this the mocked fetch resolves in the same microtask as the resume sweep, so
// the unproven window is invisible and every assertion after it is vacuous.
let heldInboxRefresh;

function defer() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}


// Mirrors ?c= out to the test. Written in an effect, not during render: a render
// is not allowed to mutate anything outside itself.
function SearchProbe() {
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  useEffect(() => { currentSearch = search; }, [search]);
  return null;
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  Object.defineProperty(document, 'hidden', { value: state === 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function settle(times = 8) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Offset Date.now by hand rather than using fake timers. React's scheduler
  // reads the clock too, and freezing it wedges act() into an infinite wait —
  // the suite hangs with no output instead of failing. performance.now(), which
  // React actually schedules on, is left alone.
  clockOffset = 0;
  Date.now = () => realDateNow.call(Date) + clockOffset;
  localStorage.clear();
  currentSearch = '';
  inboxRows = [CONVERSATION];
  scrollSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollSpy;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });

  heldInboxRefresh = null;
  mocks.select.mockImplementation(async (table) => {
    if (table === 'conversations') {
      if (heldInboxRefresh) await heldInboxRefresh.promise;
      return inboxRows;
    }
    if (table === 'messages') return MESSAGES.slice().reverse();
    return [];
  });
  mocks.rpc.mockResolvedValue([]);

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.replaceChildren();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  Date.now = realDateNow;
  clockOffset = 0;
  vi.clearAllMocks();
});

async function openThread() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/conversations']}>
          <SearchProbe />
          <Conversations />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  const row = container.querySelector('.conv-item');
  expect(row, 'the inbox row must render before a thread can open').toBeTruthy();
  await act(async () => { row.click(); });
  await settle();
}

function typeDraft(text) {
  const composer = container.querySelector('.conv-compose-input');
  expect(composer, 'the composer renders only behind a proven lease').toBeTruthy();
  composer.innerText = text;
  composer.textContent = text;
  act(() => { composer.dispatchEvent(new Event('input', { bubbles: true })); });
}

// Hide the tab, let the lease age out, come back.
// Hide the tab, let the lease age out, come back — and hold the re-proof open so
// the unproven window can actually be inspected.
async function hideForLeaseThenResume() {
  setVisibility('hidden');
  await settle(2);
  clockOffset = LEASE_MS + 5_000;
  scrollSpy.mockClear();
  heldInboxRefresh = defer();
  setVisibility('visible');
  await settle(4);

  // WHILE UNPROVEN: protected server content is off the screen. If this ever
  // stops holding, every assertion after the resume is vacuous — which is the
  // whole reason it is asserted rather than assumed.
  expect(
    container.textContent,
    'the expiry sweep must hide the thread while access is unproven',
  ).not.toContain(MESSAGES[0].body);

  const release = heldInboxRefresh.release;
  heldInboxRefresh = null;
  await act(async () => { release(); await Promise.resolve(); });
  await settle(12);
}

describe('Conversations — resume after the access lease expires', () => {
  it('keeps the draft, the open thread and the route across a 35s tab-hide', async () => {
    await openThread();
    expect(container.textContent).toContain('Can you come Thursday?');
    expect(currentSearch).toBe(`c=${CONV_ID}`);

    typeDraft('On my way Thursday at 9');
    expect(getDraft(CONV_ID)).toBe('On my way Thursday at 9');

    await hideForLeaseThenResume();

    // The original defect: both of these were destroyed by the resume sweep.
    expect(getDraft(CONV_ID), 'expiry must not erase the draft').toBe('On my way Thursday at 9');
    expect(currentSearch, 'expiry must not strip ?c=').toBe(`c=${CONV_ID}`);
    // And the thread is back, not left on the list.
    expect(container.textContent).toContain('Can you come Thursday?');
    expect(container.querySelector('.conv-compose-input')?.textContent)
      .toBe('On my way Thursday at 9');
    // A clock tick is not a denial, so the user is never told they lost access.
    expect(mocks.toast).not.toHaveBeenCalledWith(
      'You no longer have access to this chat',
      'info',
    );
  });

  // 2026-08-14 review finding. The fix above restored the thread by re-running the
  // COLD-OPEN effect, because activeAccessAuthorized alone could not tell "new
  // thread selected" from "same thread re-proven". That flipped msgLoading (a
  // third spinner), rearmed justOpenedRef and hard-replaced the message array,
  // so a reader who tabbed away mid-thread came back scrolled to the bottom.
  it('restores silently: no page spinner and no scroll jump when nothing new arrived', async () => {
    await openThread();
    typeDraft('typing while the lease ages out');

    await hideForLeaseThenResume();

    // .loading-page is the route-level spinner primitive msgLoading renders. It
    // belongs to a cold open only — never to a resume.
    expect(
      container.querySelector('.loading-page'),
      'resume must not render the cold-open spinner',
    ).toBeNull();
    // The restore must not re-anchor the reader. scrollIntoView is the exact
    // mechanism scrollToBottom uses, so a silent restore never calls it.
    expect(
      scrollSpy,
      'resume must not scroll the thread; the reader keeps their place',
    ).not.toHaveBeenCalled();
    // …and it genuinely restored rather than staying blank.
    expect(container.textContent).toContain('Can you come Thursday?');
  });

  it('still destroys the draft and the route when the refresh proves access is gone', async () => {
    await openThread();
    typeDraft('draft that must not survive a real denial');

    setVisibility('hidden');
    await settle(2);
    clockOffset = LEASE_MS + 5_000;
    inboxRows = [];               // the server no longer lists this chat
    setVisibility('visible');
    await settle(12);

    expect(getDraft(CONV_ID), 'a proven denial must erase the draft').toBe('');
    expect(currentSearch, 'a proven denial must drop the thread route').toBe('');
    expect(container.textContent).not.toContain('Can you come Thursday?');
    expect(mocks.toast).toHaveBeenCalledWith(
      'You no longer have access to this chat',
      'info',
    );
  });
});
