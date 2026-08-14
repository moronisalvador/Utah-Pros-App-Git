/**
 * ════════════════════════════════════════════════
 * FILE: accessRevocation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a person loses saved conversation details as soon as their
 *   permission is removed. It also makes sure unrelated conversations stay
 *   available and connection problems do not look like lost access.
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query, vitest
 *   Internal:  src/lib/techQuery, ./accessRevocation
 *   Data:      reads  → none (in-memory test doubles only)
 *              writes → none (in-memory test doubles only)
 *
 * NOTES / GOTCHAS:
 *   - This test creates temporary saved results and browser storage; it never connects to a live database.
 * ════════════════════════════════════════════════
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearTechQueryMemory, techKeys } from '@/lib/techQuery';
import {
  CONVERSATION_ACCESS_ACCOUNT_CHANGED,
  CONVERSATION_ACCESS_PROOF_EXPIRED,
  CONVERSATION_INBOX_ACCESS_UNVERIFIED,
  hasFreshTechConversationAccess,
  hasFreshTechConversationInboxAccess,
  isConversationAccessDenied,
  isConversationSendAccessDenied,
  loadTechConversationAccess,
  loadTechConversationInboxAccess,
  pruneConversationFromInbox,
  purgeConversationAccess,
  purgeConversationInboxAccess,
  purgeExpiredConversationInboxAccess,
  renewTechConversationAccessLease,
  techConversationInboxAccessError,
} from './accessRevocation';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  clearTechQueryMemory();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('conversation access denial classification', () => {
  it('treats only database authentication/authorization failures as access loss', () => {
    expect(isConversationAccessDenied({ status: 401 })).toBe(true);
    expect(isConversationAccessDenied({ status: 403 })).toBe(true);
    expect(isConversationAccessDenied({ status: 500 })).toBe(false);
    expect(isConversationAccessDenied(new Error('offline'))).toBe(false);
  });

  it('does not mistake consent or recipient 403 responses for membership removal', () => {
    expect(isConversationSendAccessDenied(403, 'CONVERSATION_NOT_AUTHORIZED')).toBe(true);
    expect(isConversationSendAccessDenied(401, 'SESSION_EXPIRED')).toBe(true);
    expect(isConversationSendAccessDenied(403, 'DND_ACTIVE')).toBe(false);
    expect(isConversationSendAccessDenied(403, 'NO_CONSENT')).toBe(false);
  });
});

describe('pruneConversationFromInbox', () => {
  it('removes the row and reconciles unread and status totals without going negative', () => {
    expect(pruneConversationFromInbox({
      conversations: [
        { id: 'conversation-1', status: 'active', unread_count: 3 },
        { id: 'conversation-2', status: 'active', unread_count: 0 },
      ],
      unread_total: 2,
      status_counts: { active: 2 },
    }, 'conversation-1')).toEqual({
      conversations: [
        { id: 'conversation-2', status: 'active', unread_count: 0 },
      ],
      unread_total: 0,
      status_counts: { active: 1 },
    });
  });
});

describe('purgeConversationAccess', () => {
  it('erases only the revoked thread plus every sensitive directory and its draft', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    const inbox = {
      conversations: [
        { id: 'conversation-1', status: 'active', unread_count: 1 },
        { id: 'conversation-2', status: 'active', unread_count: 0 },
      ],
      unread_total: 1,
      status_counts: { active: 2 },
    };

    client.setQueryData(techKeys.thread('conversation-1'), { pages: [[{ body: 'private' }]] });
    client.setQueryData(techKeys.thread('conversation-2'), { pages: [[{ body: 'keep' }]] });
    client.setQueryData(techKeys.conversationAccess('employee-1', 'conversation-1'), true);
    client.setQueryData(['conversation-members', 'employee-1', 'conversation-1'], [{ id: 'private' }]);
    client.setQueryData(['message-author-directory', 'employee-1', ['message-1']], [{ id: 'private' }]);
    client.setQueryData(techKeys.convos(), inbox);
    client.setQueryData(techKeys.convos('unread'), inbox);

    purgeConversationAccess(client, 'conversation-1');

    expect(client.getQueryData(techKeys.thread('conversation-1'))).toBeUndefined();
    expect(client.getQueryData(techKeys.thread('conversation-2'))).toEqual({
      pages: [[{ body: 'keep' }]],
    });
    expect(client.getQueryData(techKeys.conversationAccess('employee-1', 'conversation-1')))
      .toBeUndefined();
    expect(client.getQueryData(['conversation-members', 'employee-1', 'conversation-1']))
      .toBeUndefined();
    expect(client.getQueryData(['message-author-directory', 'employee-1', ['message-1']]))
      .toBeUndefined();
    expect(client.getQueryData(techKeys.convos()).conversations.map(({ id }) => id))
      .toEqual(['conversation-2']);
    expect(client.getQueryData(techKeys.convos('unread')).unread_total).toBe(0);
    expect(removeItem).toHaveBeenCalledWith('upr:conv-draft:conversation-1');
  });
});

describe('purgeConversationInboxAccess', () => {
  it('enumerates every cached row and clears every draft before whole-inbox removal', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:31.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    client.setQueryData(techKeys.convos(), {
      conversations: [{ id: 'conversation-1', title: 'Private title', last_message_preview: 'Private preview' }],
      unread_total: 1,
      status_counts: {},
    });
    client.setQueryData(techKeys.convos('unread'), {
      conversations: [
        { id: 'conversation-1', title: 'Private title', last_message_preview: 'Private preview' },
        { id: 'conversation-2', title: 'Second title', last_message_preview: 'Second preview' },
      ],
      unread_total: 1,
      status_counts: {},
    });
    client.setQueryData(techKeys.thread('conversation-1'), {
      pages: [[{ body: 'first private thread' }]],
    });
    client.setQueryData(techKeys.thread('conversation-2'), {
      pages: [[{ body: 'second private thread' }]],
    });

    purgeConversationInboxAccess(client);

    expect(client.getQueryData(techKeys.convos()).conversations).toEqual([]);
    expect(client.getQueryData(techKeys.convos('unread')).conversations).toEqual([]);
    expect(client.getQueryData(techKeys.thread('conversation-1'))).toBeUndefined();
    expect(client.getQueryData(techKeys.thread('conversation-2'))).toBeUndefined();
    expect(removeItem.mock.calls).toEqual([
      ['upr:conv-draft:conversation-1'],
      ['upr:conv-draft:conversation-2'],
    ]);
  });
});

describe('request-start actor access proof', () => {
  it('preserves exact-key order and unchanged row identity on a successful tech refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    const client = new QueryClient();
    const queryKey = techKeys.convos();
    const stable = {
      id: 'stable',
      title: 'Stable',
      conversation_participants: [{ contact_id: 'contact-1' }],
    };
    const changed = { id: 'changed', title: 'Old title', optimistic: true };
    client.setQueryData(queryKey, {
      conversations: [stable, changed, { id: 'removed', title: 'Removed' }],
      unread_total: 0,
      status_counts: {},
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    const fresh = [
      { id: 'changed', title: 'Fresh title' },
      {
        id: 'stable',
        title: 'Stable',
        conversation_participants: [{ contact_id: 'contact-1' }],
      },
      { id: 'appended', title: 'New row' },
    ];
    const db = {
      rpc: vi.fn((name) => Promise.resolve(
        name === 'get_my_conversation_access_snapshot'
          ? []
          : {
            conversations: fresh,
            unread_total: 0,
            status_counts: {},
          },
      )),
    };

    const result = await loadTechConversationInboxAccess({
      db,
      queryClient: client,
      queryKey,
      accountOwner: 'employee-1',
      params: { p_limit: 50 },
    });

    expect(result.conversations.map(({ id }) => id)).toEqual([
      'stable',
      'changed',
      'appended',
    ]);
    expect(result.conversations[0]).toBe(stable);
    expect(result.conversations[1]).toEqual({
      id: 'changed',
      title: 'Fresh title',
      optimistic: true,
    });
    expect(result.conversations[1]).not.toBe(changed);
    expect(result.conversations[2]).toBe(fresh[2]);
    expect(result.accessProofExpired).toBe(false);
  });

  it('individually proves and purges successful inbox omissions plus access-only caches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    const queryKey = techKeys.convos();
    client.setQueryData(queryKey, {
      conversations: [
        { id: 'omitted-row', title: 'Removed' },
        { id: 'allowed', title: 'Keep' },
      ],
      actorAccessVerifiedAt: Date.now(),
    });
    client.setQueryData(techKeys.thread('omitted-row'), {
      pages: [[{ body: 'private omitted row' }]],
    });
    client.setQueryData(
      techKeys.conversationAccess('employee-1', 'omitted-row'),
      { conversation: { id: 'omitted-row' } },
    );
    client.setQueryData(
      ['conversation-members', 'employee-1', 'omitted-row'],
      [{ id: 'private member' }],
    );
    client.setQueryData(
      techKeys.conversationAccess('employee-1', 'access-only'),
      { conversation: { id: 'access-only' } },
    );
    client.setQueryData(techKeys.thread('thread-only'), {
      pages: [[{ body: 'private standalone thread' }]],
    });
    client.setQueryData(
      ['conversation-members', 'employee-1', 'thread-only'],
      [{ id: 'private standalone member' }],
    );
    const db = {
      rpc: vi.fn((name) => {
        if (name === 'get_my_conversation_access_snapshot') return Promise.resolve([]);
        return Promise.resolve({
          conversations: [{ id: 'allowed', title: 'Keep' }],
          unread_total: 0,
          status_counts: {},
        });
      }),
    };

    const result = await loadTechConversationInboxAccess({
      db,
      queryClient: client,
      queryKey,
      accountOwner: 'employee-1',
      params: { p_limit: 50, p_search: null, p_status: null },
    });

    expect(result.conversations).toEqual([{ id: 'allowed', title: 'Keep' }]);
    expect(db.rpc).toHaveBeenCalledWith('get_my_conversation_access_snapshot', {
      p_conversation_ids: ['omitted-row'],
    });
    expect(client.getQueryData(techKeys.thread('omitted-row'))).toBeUndefined();
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-1', 'omitted-row'),
    )).toMatchObject({ conversation: null, accountOwner: 'employee-1' });
    expect(client.getQueryData(
      ['conversation-members', 'employee-1', 'omitted-row'],
    )).toBeUndefined();
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-1', 'access-only'),
    )).toEqual({ conversation: { id: 'access-only' } });
    expect(client.getQueryData(techKeys.thread('thread-only'))).toEqual({
      pages: [[{ body: 'private standalone thread' }]],
    });
    expect(removeItem.mock.calls).toEqual(expect.arrayContaining([
      ['upr:conv-draft:omitted-row'],
    ]));
  });

  it('does not treat a filtered inbox omission as revocation when the snapshot allows it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    const queryKey = techKeys.convos('unread');
    client.setQueryData(queryKey, {
      conversations: [{ id: 'now-read', title: 'Still authorized' }],
      actorAccessVerifiedAt: Date.now(),
    });
    const db = {
      rpc: vi.fn((name) => Promise.resolve(
        name === 'get_my_conversation_access_snapshot'
          ? [{ conversation_id: 'now-read' }]
          : { conversations: [], unread_total: 0, status_counts: {} },
      )),
    };

    await loadTechConversationInboxAccess({
      db,
      queryClient: client,
      queryKey,
      accountOwner: 'employee-1',
      params: { p_limit: 50, p_search: null, p_status: 'unread' },
    });

    expect(removeItem).not.toHaveBeenCalled();
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-1', 'now-read'),
    )).toBeUndefined();
  });

  it('preserves an unread-to-read draft beyond 30s while default snapshots allow it, then purges on denial', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const storage = new Map([
      ['upr:conv-draft:now-read', 'unfinished private reply'],
    ]);
    const removeItem = vi.fn((key) => storage.delete(key));
    vi.stubGlobal('localStorage', {
      get length() { return storage.size; },
      getItem: (key) => storage.get(key) || null,
      key: (index) => [...storage.keys()][index] || null,
      removeItem,
    });
    const client = new QueryClient();
    const filteredKey = techKeys.convos('unread');
    const defaultKey = techKeys.convos();
    client.setQueryData(filteredKey, {
      conversations: [{ id: 'now-read', title: 'Moved outside unread filter' }],
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    client.setQueryData(techKeys.thread('now-read'), {
      pages: [[{ body: 'private thread' }]],
    });
    let snapshotAllows = true;
    const db = {
      rpc: vi.fn((name) => Promise.resolve(
        name === 'get_my_conversation_access_snapshot'
          ? (snapshotAllows ? [{ conversation_id: 'now-read' }] : [])
          : { conversations: [], unread_total: 0, status_counts: {} },
      )),
    };
    const loadDefault = async () => {
      const result = await loadTechConversationInboxAccess({
        db,
        queryClient: client,
        queryKey: defaultKey,
        accountOwner: 'employee-1',
        params: { p_limit: 50, p_search: null, p_status: null },
        revalidateAllCachedAccess: true,
      });
      client.setQueryData(defaultKey, result);
    };

    await loadTechConversationInboxAccess({
      db,
      queryClient: client,
      queryKey: filteredKey,
      accountOwner: 'employee-1',
      params: { p_limit: 50, p_search: null, p_status: 'unread' },
    });
    vi.advanceTimersByTime(15_000);
    await loadDefault();
    vi.advanceTimersByTime(15_000);
    await loadDefault();

    expect(storage.get('upr:conv-draft:now-read')).toBe('unfinished private reply');
    expect(client.getQueryData(techKeys.thread('now-read'))).toEqual({
      pages: [[{ body: 'private thread' }]],
    });

    snapshotAllows = false;
    vi.advanceTimersByTime(5_000);
    await loadDefault();

    expect(storage.has('upr:conv-draft:now-read')).toBe(false);
    expect(client.getQueryData(techKeys.thread('now-read'))).toBeUndefined();
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-1', 'now-read'),
    )).toMatchObject({ conversation: null, accountOwner: 'employee-1' });
    expect(removeItem).toHaveBeenCalledWith('upr:conv-draft:now-read');
  });

  it('bounds the default sensitive-cache snapshot to batches of 200', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', { length: 0, removeItem: vi.fn() });
    const client = new QueryClient();
    const ids = Array.from({ length: 401 }, (_value, index) => `cached-${index}`);
    ids.forEach((conversationId) => {
      client.setQueryData(techKeys.thread(conversationId), {
        pages: [[{ body: 'private' }]],
      });
    });
    const snapshotBatches = [];
    const db = {
      rpc: vi.fn((name, args) => {
        if (name === 'get_my_conversation_access_snapshot') {
          snapshotBatches.push(args.p_conversation_ids);
          return Promise.resolve(args.p_conversation_ids.map((conversationId) => ({
            conversation_id: conversationId,
          })));
        }
        return Promise.resolve({
          conversations: [],
          unread_total: 0,
          status_counts: {},
        });
      }),
    };

    await loadTechConversationInboxAccess({
      db,
      queryClient: client,
      queryKey: techKeys.convos(),
      accountOwner: 'employee-1',
      params: { p_limit: 50 },
      revalidateAllCachedAccess: true,
    });

    expect(snapshotBatches.map((batch) => batch.length)).toEqual([200, 200, 1]);
    expect(snapshotBatches.flat()).toEqual(ids);
  });

  it('drops lease-only registry entries instead of polling or purging them forever', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', {
      length: 0,
      getItem: () => null,
      removeItem,
    });
    const client = new QueryClient();
    renewTechConversationAccessLease({
      queryClient: client,
      conversationId: 'orphan',
      verifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    const db = {
      rpc: vi.fn().mockResolvedValue({
        conversations: [],
        unread_total: 0,
        status_counts: {},
      }),
    };

    await loadTechConversationInboxAccess({
      db,
      queryClient: client,
      queryKey: techKeys.convos(),
      accountOwner: 'employee-1',
      params: { p_limit: 50 },
      revalidateAllCachedAccess: true,
    });
    vi.advanceTimersByTime(30_001);

    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('does not resnapshot a tombstone and replaces it before a reauthorized row is clicked', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', {
      length: 0,
      getItem: () => null,
      removeItem: vi.fn(),
    });
    const client = new QueryClient();
    const accessKey = techKeys.conversationAccess('employee-1', 'restored');
    await loadTechConversationAccess({
      db: { rpc: vi.fn().mockResolvedValue({ conversations: [] }) },
      queryClient: client,
      conversationId: 'restored',
      accountOwner: 'employee-1',
    });
    expect(client.getQueryData(accessKey)).toMatchObject({ conversation: null });

    const emptyInboxDb = {
      rpc: vi.fn().mockResolvedValue({
        conversations: [],
        unread_total: 0,
        status_counts: {},
      }),
    };
    await loadTechConversationInboxAccess({
      db: emptyInboxDb,
      queryClient: client,
      queryKey: techKeys.convos(),
      accountOwner: 'employee-1',
      params: { p_limit: 50 },
      revalidateAllCachedAccess: true,
    });
    expect(emptyInboxDb.rpc).toHaveBeenCalledTimes(1);
    expect(emptyInboxDb.rpc).not.toHaveBeenCalledWith(
      'get_my_conversation_access_snapshot',
      expect.anything(),
    );

    vi.advanceTimersByTime(1);
    const restoredConversation = { id: 'restored', title: 'Restored access' };
    await loadTechConversationInboxAccess({
      db: {
        rpc: vi.fn().mockResolvedValue({
          conversations: [restoredConversation],
          unread_total: 0,
          status_counts: {},
        }),
      },
      queryClient: client,
      queryKey: techKeys.convos(),
      accountOwner: 'employee-1',
      params: { p_limit: 50 },
      revalidateAllCachedAccess: true,
    });

    const clickProbe = vi.fn();
    const observer = new QueryObserver(client, {
      queryKey: accessKey,
      queryFn: clickProbe,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    expect(observer.getCurrentResult().data).toMatchObject({
      conversation: restoredConversation,
      accountOwner: 'employee-1',
    });
    expect(hasFreshTechConversationAccess(
      observer.getCurrentResult().data,
      'employee-1',
      'restored',
    )).toBe(true);
    expect(clickProbe).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('cannot let an older per-ID positive overwrite a newer denial', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    const client = new QueryClient();
    const olderRequest = deferred();
    const olderPositive = loadTechConversationAccess({
      db: { rpc: vi.fn(() => olderRequest.promise) },
      queryClient: client,
      conversationId: 'raced',
      accountOwner: 'employee-1',
    });
    vi.advanceTimersByTime(1);
    await loadTechConversationAccess({
      db: { rpc: vi.fn().mockResolvedValue({ conversations: [] }) },
      queryClient: client,
      conversationId: 'raced',
      accountOwner: 'employee-1',
    });
    olderRequest.resolve({
      conversations: [{ id: 'raced', title: 'Stale positive' }],
    });

    await expect(olderPositive).rejects.toMatchObject({
      code: CONVERSATION_ACCESS_PROOF_EXPIRED,
    });
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-1', 'raced'),
    )).toMatchObject({ conversation: null });
  });

  it('cannot let an older per-ID denial overwrite a newer positive lease', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    const client = new QueryClient();
    const accessKey = techKeys.conversationAccess('employee-1', 'raced');
    const olderRequest = deferred();
    const olderNegative = loadTechConversationAccess({
      db: { rpc: vi.fn(() => olderRequest.promise) },
      queryClient: client,
      conversationId: 'raced',
      accountOwner: 'employee-1',
    });
    vi.advanceTimersByTime(1);
    const newerPositive = await loadTechConversationAccess({
      db: {
        rpc: vi.fn().mockResolvedValue({
          conversations: [{ id: 'raced', title: 'Current positive' }],
        }),
      },
      queryClient: client,
      conversationId: 'raced',
      accountOwner: 'employee-1',
    });
    client.setQueryData(accessKey, newerPositive);
    olderRequest.resolve({ conversations: [] });

    await expect(olderNegative).rejects.toMatchObject({
      code: CONVERSATION_ACCESS_PROOF_EXPIRED,
    });
    expect(client.getQueryData(accessKey)).toEqual(newerPositive);
  });

  it('keeps an observed access query attached and publishes a tombstone at lease expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    const queryKey = techKeys.conversationAccess('employee-1', 'active');
    const observer = new QueryObserver(client, {
      queryKey,
      enabled: false,
      queryFn: vi.fn(),
    });
    const observed = [];
    const unsubscribe = observer.subscribe((result) => observed.push(result.data));
    client.setQueryData(queryKey, {
      conversation: { id: 'active', title: 'Private title' },
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    client.setQueryData(techKeys.thread('active'), {
      pages: [[{ body: 'private body' }]],
    });
    client.setQueryData(techKeys.convos(), {
      conversations: [{ id: 'active', title: 'Private title' }],
      unread_total: 0,
      status_counts: {},
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    renewTechConversationAccessLease({
      queryClient: client,
      conversationId: 'active',
      verifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });

    vi.advanceTimersByTime(29_999);
    expect(observer.getCurrentResult().data?.conversation?.id).toBe('active');
    vi.advanceTimersByTime(1);

    expect(observer.getCurrentResult().data).toMatchObject({
      conversation: null,
      accountOwner: 'employee-1',
      // Expiry, not denial: the tombstone says "re-prove" so the pane keeps the
      // route and the parked draft instead of revoking.
      accessProofExpired: true,
    });
    expect(observed.at(-1)).toMatchObject({ conversation: null });
    expect(client.getQueryCache().find({ queryKey, exact: true })?.getObserversCount()).toBe(1);
    expect(client.getQueryData(techKeys.thread('active'))).toBeUndefined();
    expect(client.getQueryData(techKeys.convos())).toMatchObject({
      conversations: [],
      accessProofExpired: true,
    });
    expect(techConversationInboxAccessError(
      client.getQueryData(techKeys.convos()),
      null,
    )).toMatchObject({ code: CONVERSATION_INBOX_ACCESS_UNVERIFIED });
    // The tech's own typed draft survives a clock expiry (a 35s app background
    // must not destroy their work); only a proven denial clears it.
    expect(removeItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('publishes an authoritative negative result into an observed access query in place', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    const client = new QueryClient();
    const queryKey = techKeys.conversationAccess('employee-1', 'active');
    const observer = new QueryObserver(client, {
      queryKey,
      enabled: false,
      queryFn: vi.fn(),
    });
    const unsubscribe = observer.subscribe(() => {});
    client.setQueryData(queryKey, {
      conversation: { id: 'active' },
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });

    const result = await loadTechConversationAccess({
      db: {
        rpc: vi.fn().mockResolvedValue({ conversations: [] }),
      },
      queryClient: client,
      conversationId: 'active',
      accountOwner: 'employee-1',
    });

    expect(result.conversation).toBeNull();
    expect(observer.getCurrentResult().data).toEqual(result);
    expect(client.getQueryCache().find({ queryKey, exact: true })?.getObserversCount()).toBe(1);
    expect(hasFreshTechConversationAccess(
      observer.getCurrentResult().data,
      'employee-1',
      'active',
    )).toBe(false);
    unsubscribe();
  });

  it('retains fresh observed inbox data across a background error and can recover after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    vi.stubGlobal('localStorage', { removeItem: vi.fn() });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = techKeys.convos();
    const failedRequest = deferred();
    const recoveredRequest = deferred();
    let requestCount = 0;
    const observer = new QueryObserver(client, {
      queryKey,
      enabled: false,
      retry: false,
      queryFn: () => {
        requestCount += 1;
        return requestCount === 1 ? failedRequest.promise : recoveredRequest.promise;
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    const verifiedAt = Date.now();
    const cached = {
      conversations: [{ id: 'conversation-1', title: 'Private title' }],
      unread_total: 0,
      status_counts: {},
      actorAccessVerifiedAt: verifiedAt,
      accountOwner: 'employee-1',
    };
    client.setQueryData(queryKey, cached);
    renewTechConversationAccessLease({
      queryClient: client,
      conversationId: 'conversation-1',
      verifiedAt,
      accountOwner: 'employee-1',
    });

    const failedRefetch = observer.refetch();
    failedRequest.reject(new Error('offline'));
    await failedRefetch;

    expect(observer.getCurrentResult()).toMatchObject({
      isError: true,
      data: cached,
    });
    expect(hasFreshTechConversationInboxAccess(
      observer.getCurrentResult().data,
      'employee-1',
    )).toBe(true);

    vi.advanceTimersByTime(30_000);
    expect(observer.getCurrentResult().data.conversations).toEqual([]);
    expect(observer.getCurrentResult().data.accessProofExpired).toBe(true);
    expect(client.getQueryCache().find({ queryKey, exact: true })?.getObserversCount()).toBe(1);
    expect(hasFreshTechConversationInboxAccess(
      observer.getCurrentResult().data,
      'employee-1',
    )).toBe(false);
    expect(techConversationInboxAccessError(
      observer.getCurrentResult().data,
      observer.getCurrentResult().error,
    )).toMatchObject({ code: CONVERSATION_INBOX_ACCESS_UNVERIFIED });

    const recovery = observer.refetch();
    recoveredRequest.resolve({
      conversations: [{ id: 'conversation-1', title: 'Fresh title' }],
      unread_total: 0,
      status_counts: {},
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    await recovery;

    expect(observer.getCurrentResult()).toMatchObject({
      isSuccess: true,
      data: {
        conversations: [{ id: 'conversation-1', title: 'Fresh title' }],
      },
    });
    expect(observer.getCurrentResult().data.accessProofExpired).toBeUndefined();
    unsubscribe();
  });

  it('cannot let a superseded account inbox response purge or repopulate same-ID caches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    const request = deferred();
    const pending = loadTechConversationInboxAccess({
      db: { rpc: vi.fn(() => request.promise) },
      queryClient: client,
      queryKey: techKeys.convos(),
      accountOwner: 'employee-a',
      params: { p_limit: 50 },
    });

    clearTechQueryMemory();
    client.setQueryData(techKeys.convos(), {
      conversations: [{ id: 'same-id', title: 'Account B' }],
      actorAccessVerifiedAt: Date.now(),
      accountOwner: 'employee-b',
    });
    client.setQueryData(techKeys.thread('same-id'), {
      pages: [[{ body: 'Account B body' }]],
    });
    request.resolve({
      conversations: [{ id: 'same-id', title: 'Late Account A' }],
      unread_total: 0,
      status_counts: {},
    });

    await expect(pending).rejects.toMatchObject({
      code: CONVERSATION_ACCESS_ACCOUNT_CHANGED,
    });
    expect(client.getQueryData(techKeys.convos()).conversations).toEqual([
      { id: 'same-id', title: 'Account B' },
    ]);
    expect(client.getQueryData(techKeys.thread('same-id'))).toEqual({
      pages: [[{ body: 'Account B body' }]],
    });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('cannot let a superseded account thread response or timer purge account B', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    renewTechConversationAccessLease({
      queryClient: client,
      conversationId: 'same-id',
      verifiedAt: Date.now(),
      accountOwner: 'employee-a',
    });
    const request = deferred();
    const pending = loadTechConversationAccess({
      db: { rpc: vi.fn(() => request.promise) },
      queryClient: client,
      conversationId: 'same-id',
      accountOwner: 'employee-a',
    });

    clearTechQueryMemory();
    client.setQueryData(
      techKeys.conversationAccess('employee-b', 'same-id'),
      {
        conversation: { id: 'same-id', title: 'Account B' },
        actorAccessVerifiedAt: Date.now(),
        accountOwner: 'employee-b',
      },
    );
    client.setQueryData(techKeys.thread('same-id'), {
      pages: [[{ body: 'Account B body' }]],
    });
    vi.advanceTimersByTime(30_001);
    request.resolve({
      conversations: [{ id: 'same-id', title: 'Late Account A' }],
    });

    await expect(pending).rejects.toMatchObject({
      code: CONVERSATION_ACCESS_ACCOUNT_CHANGED,
    });
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-b', 'same-id'),
    )?.conversation?.title).toBe('Account B');
    expect(client.getQueryData(techKeys.thread('same-id'))).toEqual({
      pages: [[{ body: 'Account B body' }]],
    });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('rejects and purges a late successful whole-inbox response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    client.setQueryData(techKeys.convos(), {
      conversations: [{ id: 'cached', title: 'Private title' }],
      actorAccessVerifiedAt: Date.now(),
    });
    renewTechConversationAccessLease({
      queryClient: client,
      conversationId: 'cached',
      verifiedAt: Date.now(),
      accountOwner: 'employee-1',
    });
    let resolveRequest;
    const pending = loadTechConversationInboxAccess({
      db: {
        rpc: () => new Promise((resolve) => { resolveRequest = resolve; }),
      },
      queryClient: client,
      accountOwner: 'employee-1',
      params: { p_limit: 50 },
    });

    vi.advanceTimersByTime(30_001);
    resolveRequest({
      conversations: [{ id: 'late-success', title: 'Must not appear' }],
      unread_total: 0,
      status_counts: {},
    });

    await expect(pending).rejects.toMatchObject({
      code: CONVERSATION_ACCESS_PROOF_EXPIRED,
    });
    expect(client.getQueryData(techKeys.convos()).conversations).toEqual([]);
    // A slow round trip proves slowness, not removal — the draft survives.
    expect(removeItem).not.toHaveBeenCalledWith('upr:conv-draft:cached');
  });

  it('rejects and purges a late successful active-thread response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    client.setQueryData(techKeys.thread('active'), {
      pages: [[{ body: 'private body' }]],
    });
    let resolveRequest;
    const pending = loadTechConversationAccess({
      db: {
        rpc: () => new Promise((resolve) => { resolveRequest = resolve; }),
      },
      queryClient: client,
      conversationId: 'active',
      accountOwner: 'employee-1',
    });

    vi.advanceTimersByTime(30_001);
    resolveRequest({
      conversations: [{ id: 'active', title: 'Late success' }],
    });

    await expect(pending).rejects.toMatchObject({
      code: CONVERSATION_ACCESS_PROOF_EXPIRED,
    });
    expect(client.getQueryData(techKeys.thread('active'))).toBeUndefined();
    // A slow round trip proves slowness, not removal — the draft survives.
    expect(removeItem).not.toHaveBeenCalledWith('upr:conv-draft:active');
  });

  it('resume sweep hides every expired conversation but keeps every draft', () => {
    // The background/resume path: purgeExpiredConversationInboxAccess runs for
    // EVERY leased conversation on resume, so before 2026-08-14 a 35s app
    // background destroyed every draft in the inbox, not just the open one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    const client = new QueryClient();
    ['conversation-1', 'conversation-2'].forEach((conversationId) => {
      client.setQueryData(techKeys.thread(conversationId), {
        pages: [[{ body: `${conversationId} private body` }]],
      });
      renewTechConversationAccessLease({
        queryClient: client,
        conversationId,
        verifiedAt: Date.now(),
        accountOwner: 'employee-1',
      });
    });

    // Simulate the suspended-timer resume: 35s pass, then the sweep runs.
    vi.setSystemTime(new Date('2026-07-31T18:00:35.000Z'));
    const purged = purgeExpiredConversationInboxAccess(client, {
      accountOwner: 'employee-1',
    });

    expect(purged).toBe(true);
    expect(client.getQueryData(techKeys.thread('conversation-1'))).toBeUndefined();
    expect(client.getQueryData(techKeys.thread('conversation-2'))).toBeUndefined();
    expect(client.getQueryData(
      techKeys.conversationAccess('employee-1', 'conversation-1'),
    )).toMatchObject({ conversation: null, accessProofExpired: true });
    expect(removeItem).not.toHaveBeenCalled();
  });
});
