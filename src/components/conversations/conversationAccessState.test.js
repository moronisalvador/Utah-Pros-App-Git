/**
 * ════════════════════════════════════════════════
 * FILE: conversationAccessState.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a person can see conversation information only while their
 *   recent permission check is still valid. It also checks that old results
 *   and saved drafts are cleared when access ends or the signed-in person changes.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./messageUtils, ./conversationAccessState
 *   Data:      reads  → none (in-memory test doubles only)
 *              writes → none (in-memory test doubles only)
 *
 * NOTES / GOTCHAS:
 *   - This test never connects to a live database; its request and storage behavior are mocked.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft } from './messageUtils';
import {
  CONVERSATION_ACCESS_LEASE_MS,
  createConversationAccessRequestGuard,
  hasConversationAccess,
  reconcileAccessibleConversations,
  revalidateConversationAccessAfterResume,
  revokeConversationsOmittedFromProof,
  runConversationAccessProbe,
  scheduleConversationAccessExpiry,
} from './conversationAccessState';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('conversation access lease expiry', () => {
  it('purges an idle cached inbox at the 30s boundary without requiring an open thread', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const onExpire = vi.fn();

    scheduleConversationAccessExpiry({
      verifiedAt: Date.now(),
      onExpire,
    });

    vi.advanceTimersByTime(CONVERSATION_ACCESS_LEASE_MS - 1);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful response that resolves more than 30s after request start', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    let resolveRequest;
    const onExpired = vi.fn();
    const probe = runConversationAccessProbe({
      request: () => new Promise((resolve) => { resolveRequest = resolve; }),
      onExpired,
    });

    vi.advanceTimersByTime(CONVERSATION_ACCESS_LEASE_MS);
    resolveRequest([{ id: 'must-not-authorize' }]);

    await expect(probe).resolves.toEqual({
      accepted: false,
      requestStartedAt: Date.parse('2026-07-31T18:00:00.000Z'),
      value: null,
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('rejects an older response that resolves after a newer actor-scoped proof', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const requestGuard = createConversationAccessRequestGuard();
    let resolveOlder;
    let resolveNewer;
    const older = runConversationAccessProbe({
      request: () => new Promise((resolve) => { resolveOlder = resolve; }),
      requestGuard,
    });
    vi.advanceTimersByTime(1);
    const newer = runConversationAccessProbe({
      request: () => new Promise((resolve) => { resolveNewer = resolve; }),
      requestGuard,
    });

    resolveNewer([{ id: 'newest-authorized-row' }]);
    await expect(newer).resolves.toMatchObject({
      accepted: true,
      value: [{ id: 'newest-authorized-row' }],
    });

    resolveOlder([{ id: 'stale-row-that-must-not-return' }]);
    await expect(older).resolves.toMatchObject({
      accepted: false,
      superseded: true,
      value: null,
    });
  });

  it('treats a response and rejection after lifecycle invalidation as inert', async () => {
    const requestGuard = createConversationAccessRequestGuard();
    let resolveRequest;
    let rejectRequest;
    const resolvedProbe = runConversationAccessProbe({
      request: () => new Promise((resolve) => { resolveRequest = resolve; }),
      requestGuard,
    });
    requestGuard.invalidate();
    resolveRequest([{ id: 'ended-account-row' }]);
    await expect(resolvedProbe).resolves.toMatchObject({
      accepted: false,
      superseded: true,
      value: null,
    });

    const rejectedProbe = runConversationAccessProbe({
      request: () => new Promise((_resolve, reject) => { rejectRequest = reject; }),
      requestGuard,
    });
    requestGuard.invalidate();
    rejectRequest(new Error('ended account network failure'));
    await expect(rejectedProbe).resolves.toMatchObject({
      accepted: false,
      superseded: true,
      value: null,
    });
  });

  it('purges expired cached drafts synchronously on resume before revalidation starts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:31.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    let resolveRequest;
    const revalidate = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));

    const pending = revalidateConversationAccessAfterResume({
      purgeExpired: () => {
        revokeConversationsOmittedFromProof({
          cachedConversations: [{ id: 'expired-with-no-active-thread' }],
          authorizedConversations: [],
          leasedConversationIds: ['expired-with-no-active-thread'],
          onRevoke: clearDraft,
        });
      },
      revalidate,
    });

    expect(removeItem).toHaveBeenCalledWith(
      'upr:conv-draft:expired-with-no-active-thread',
    );
    expect(revalidate).toHaveBeenCalledTimes(1);
    resolveRequest('offline');
    return expect(pending).resolves.toBe('offline');
  });
});

describe('successful actor-scoped inbox reconciliation', () => {
  it('clears every omitted conversation draft and lease before accepting fresh rows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T18:00:00.000Z'));
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { removeItem });
    let resolveRequest;
    const accessLeases = new Map([
      ['removed-row', Date.now()],
      ['removed-lease-only', Date.now()],
      ['allowed', Date.now()],
    ]);
    const probe = runConversationAccessProbe({
      request: () => new Promise((resolve) => { resolveRequest = resolve; }),
    });

    vi.advanceTimersByTime(500);
    resolveRequest([{ id: 'allowed' }]);
    const result = await probe;
    expect(result.accepted).toBe(true);

    revokeConversationsOmittedFromProof({
      cachedConversations: [
        { id: 'removed-row' },
        { id: 'allowed' },
      ],
      authorizedConversations: result.value,
      leasedConversationIds: accessLeases.keys(),
      onRevoke: (conversationId) => {
        accessLeases.delete(conversationId);
        clearDraft(conversationId);
      },
    });

    expect(removeItem.mock.calls).toEqual([
      ['upr:conv-draft:removed-row'],
      ['upr:conv-draft:removed-lease-only'],
    ]);
    expect([...accessLeases.keys()]).toEqual(['allowed']);
  });
});

describe('reconcileAccessibleConversations', () => {
  it('drops rows absent from a successful actor-scoped refresh', () => {
    const previous = [
      { id: 'revoked', title: 'Private thread' },
      { id: 'allowed', title: 'Old title', optimistic: true },
    ];
    const fresh = [{ id: 'allowed', title: 'Fresh title' }];

    expect(reconcileAccessibleConversations(previous, fresh, true)).toEqual([
      { id: 'allowed', title: 'Fresh title', optimistic: true },
    ]);
  });

  it('keeps the current list unchanged when no authoritative array is supplied', () => {
    const previous = [{ id: 'allowed' }];
    expect(reconcileAccessibleConversations(previous, null, true)).toBe(previous);
  });

  it('keeps silent-refresh order and exact identity for unchanged rows', () => {
    const stable = {
      id: 'stable',
      title: 'Stable',
      conversation_participants: [{ contact_id: 'contact-1' }],
    };
    const changed = { id: 'changed', title: 'Old title', optimistic: true };
    const removed = { id: 'removed', title: 'Revoked' };
    const fresh = [
      { id: 'changed', title: 'Fresh title' },
      {
        id: 'stable',
        title: 'Stable',
        conversation_participants: [{ contact_id: 'contact-1' }],
      },
      { id: 'appended', title: 'New chat' },
    ];

    const result = reconcileAccessibleConversations(
      [stable, changed, removed],
      fresh,
      true,
    );

    expect(result.map(({ id }) => id)).toEqual(['stable', 'changed', 'appended']);
    expect(result[0]).toBe(stable);
    expect(result[1]).toEqual({
      id: 'changed',
      title: 'Fresh title',
      optimistic: true,
    });
    expect(result[1]).not.toBe(changed);
    expect(result[2]).toBe(fresh[2]);
  });
});

describe('hasConversationAccess', () => {
  it('requires the exact conversation in an authoritative actor-scoped list', () => {
    expect(hasConversationAccess([{ id: 'allowed' }], 'allowed')).toBe(true);
    expect(hasConversationAccess([{ id: 'allowed' }], 'revoked')).toBe(false);
    expect(hasConversationAccess(null, 'allowed')).toBe(false);
  });
});
