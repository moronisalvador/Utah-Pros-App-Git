/**
 * ════════════════════════════════════════════════
 * FILE: accessRevocation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Erases one no-longer-authorized chat from the technician's in-memory inbox,
 *   thread, participant, author, and draft caches before returning to the list.
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query (QueryClient contract)
 *   Internal:  @/lib/techQuery, @/components/conversations/messageUtils
 *   Data:      reads/writes → in-memory React Query state and the exact local
 *                       draft key for the removed conversation
 *
 * NOTES / GOTCHAS:
 *   - Only 401/403 prove immediate authorization loss. A network timeout may keep
 *     the view stable only inside the short successful-access lease; lease expiry
 *     purges it even when the network cannot prove the server-side decision.
 *   - EXPIRED is not DENIED (2026-08-14). Lease expiry hides protected server
 *     content (thread cache, inbox row, member/author directories) but preserves
 *     the tech's own localStorage draft and plants a tombstone marked
 *     accessProofExpired so the pane re-proves instead of revoking the route.
 *     Only a proven denial — a probe/snapshot that omits the conversation, or a
 *     401/403 — clears the draft. Backgrounding the app past the 30s lease used
 *     to destroy the half-typed draft and exit the open thread on resume
 *     (page-lifecycle.md minimize test); expiry now restores both after re-proof.
 *   - Raw thread bodies and inbox previews are also excluded from disk persistence;
 *     this helper closes the same-account in-memory removal window.
 * ════════════════════════════════════════════════
 */

import { clearDraft, getDraft } from '@/components/conversations/messageUtils';
import {
  conversationAccessLeaseIsFresh,
  reconcileAccessibleConversations,
  runConversationAccessProbe,
  scheduleConversationAccessExpiry,
} from '@/components/conversations/conversationAccessState';
import {
  captureTechQueryAccountGeneration,
  registerTechQueryAccountGenerationListener,
  TECH_QUERY_KINDS,
  techKeys,
  techQueryAccountGenerationIsCurrent,
} from '@/lib/techQuery';

export const CONVERSATION_ACCESS_PROOF_EXPIRED = 'CONVERSATION_ACCESS_PROOF_EXPIRED';
export const CONVERSATION_ACCESS_ACCOUNT_CHANGED = 'CONVERSATION_ACCESS_ACCOUNT_CHANGED';
export const CONVERSATION_INBOX_ACCESS_UNVERIFIED = 'CONVERSATION_INBOX_ACCESS_UNVERIFIED';

const conversationLeasesByClient = new WeakMap();
const conversationLeaseMaps = new Set();

registerTechQueryAccountGenerationListener(() => {
  conversationLeaseMaps.forEach((leases) => {
    leases.forEach((lease) => lease.cancel?.());
    leases.clear();
  });
});

function conversationLeaseMap(queryClient) {
  let leases = conversationLeasesByClient.get(queryClient);
  if (!leases) {
    leases = new Map();
    conversationLeasesByClient.set(queryClient, leases);
    conversationLeaseMaps.add(leases);
  }
  return leases;
}

function clearConversationLease(queryClient, conversationId) {
  const leases = conversationLeasesByClient.get(queryClient);
  const lease = leases?.get(conversationId);
  lease?.cancel?.();
  leases?.delete(conversationId);
}

function expiredProofError() {
  const error = new Error('Conversation access proof expired before the response arrived');
  error.code = CONVERSATION_ACCESS_PROOF_EXPIRED;
  return error;
}

function accountChangedError() {
  const error = new Error('Conversation access probe belongs to an ended account');
  error.code = CONVERSATION_ACCESS_ACCOUNT_CHANGED;
  return error;
}

export function renewTechConversationAccessLease({
  queryClient,
  conversationId,
  verifiedAt,
  accountOwner,
  accountGeneration = captureTechQueryAccountGeneration(),
  now = Date.now(),
} = {}) {
  if (
    !queryClient
    || !conversationId
    || !accountOwner
    || !conversationAccessLeaseIsFresh(verifiedAt, now)
    || !techQueryAccountGenerationIsCurrent(accountGeneration)
  ) {
    return false;
  }
  const leases = conversationLeaseMap(queryClient);
  const current = leases.get(conversationId);
  // An older filtered/snapshot proof cannot shorten or overwrite a newer
  // active-thread proof for the same conversation.
  if (current && current.verifiedAt > verifiedAt) return false;
  current?.cancel?.();
  const lease = {
    accountOwner,
    accountGeneration,
    verifiedAt,
    cancel: null,
  };
  lease.cancel = scheduleConversationAccessExpiry({
    verifiedAt,
    onExpire: () => {
      const latest = leases.get(conversationId);
      if (latest !== lease) return;
      if (
        latest.accountOwner !== accountOwner
        || !techQueryAccountGenerationIsCurrent(accountGeneration)
      ) {
        leases.delete(conversationId);
        return;
      }
      recordConversationAccessExpired({
        queryClient,
        conversationId,
        accountOwner,
        verifiedAt,
      });
    },
  });
  leases.set(conversationId, lease);
  return true;
}

export function isConversationAccessDenied(error) {
  return error?.status === 401 || error?.status === 403;
}

export function isConversationSendAccessDenied(status, code) {
  return status === 401 || code === 'CONVERSATION_NOT_AUTHORIZED';
}

export function hasFreshTechConversationInboxAccess(
  data,
  accountOwner,
  now = Date.now(),
) {
  return Boolean(
    data?.accountOwner === accountOwner
    && !data?.accessProofExpired
    && conversationAccessLeaseIsFresh(data?.actorAccessVerifiedAt, now),
  );
}

export function techConversationInboxAccessError(data, queryError) {
  if (!data?.accessProofExpired) return queryError || null;
  const error = new Error('Could not confirm conversation access. Check your connection and try again.');
  error.code = CONVERSATION_INBOX_ACCESS_UNVERIFIED;
  return error;
}

export function hasFreshTechConversationAccess(
  data,
  accountOwner,
  conversationId,
  now = Date.now(),
) {
  return Boolean(
    data?.accountOwner === accountOwner
    && data?.conversation?.id === conversationId
    && conversationAccessLeaseIsFresh(data?.actorAccessVerifiedAt, now),
  );
}

export function pruneConversationFromInbox(
  data,
  conversationId,
  { accessProofExpired = false } = {},
) {
  if (!data || !Array.isArray(data.conversations)) return data;
  const removed = data.conversations.find((conversation) => conversation.id === conversationId);
  if (!removed) return data;

  const statusCounts = { ...(data.status_counts || {}) };
  if (
    removed.status
    && Number.isFinite(Number(statusCounts[removed.status]))
    && Number(statusCounts[removed.status]) > 0
  ) {
    statusCounts[removed.status] = Number(statusCounts[removed.status]) - 1;
  }

  return {
    ...data,
    conversations: data.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    ),
    unread_total: Math.max(
      0,
      Number(data.unread_total || 0) - Number(removed.unread_count || 0),
    ),
    status_counts: statusCounts,
    ...(
      accessProofExpired || data.accessProofExpired
        ? { accessProofExpired: true }
        : {}
    ),
  };
}

export function purgeConversationAccess(
  queryClient,
  conversationId,
  { accessTombstone = null, preserveDraft = false } = {},
) {
  if (!queryClient || !conversationId) return;

  clearConversationLease(queryClient, conversationId);
  if (accessTombstone?.accountOwner) {
    queryClient.setQueryData(
      techKeys.conversationAccess(accessTombstone.accountOwner, conversationId),
      accessTombstone,
    );
  }
  queryClient.removeQueries({
    queryKey: techKeys.thread(conversationId),
    exact: true,
  });
  queryClient.removeQueries({
    predicate: (query) => (
      query.queryKey?.[0] === 'tech'
      && query.queryKey?.[1] === TECH_QUERY_KINDS.CONVERSATION_ACCESS
      && query.queryKey?.[3] === conversationId
      && (
        !accessTombstone?.accountOwner
        || query.queryKey?.[2] !== accessTombstone.accountOwner
      )
    ),
  });
  queryClient.removeQueries({
    predicate: (query) => (
      query.queryKey?.[0] === 'conversation-members'
      && query.queryKey?.[2] === conversationId
    ),
  });
  queryClient.removeQueries({
    queryKey: ['message-author-directory'],
  });
  queryClient.setQueriesData(
    { queryKey: ['tech', TECH_QUERY_KINDS.CONVOS] },
    (data) => pruneConversationFromInbox(data, conversationId, {
      accessProofExpired: Boolean(accessTombstone),
    }),
  );
  // The draft is the tech's OWN typed text, not server content: it renders only
  // behind a fresh lease, so hiding needs no key removal. Destroy it only when
  // access is actually gone (denial / account boundary), never on clock expiry.
  if (!preserveDraft) clearDraft(conversationId);
}

function recordConversationAccessDenied({
  queryClient,
  conversationId,
  accountOwner,
  verifiedAt,
}) {
  purgeConversationAccess(queryClient, conversationId, {
    accessTombstone: {
      conversation: null,
      actorAccessVerifiedAt: verifiedAt,
      accountOwner,
    },
  });
}

// Expiry ≠ denial: the clock ran out on the last proof, but no probe has said
// "not a member". Hide every piece of protected server content exactly like a
// denial, but keep the tech's own draft, and mark the tombstone so the pane
// keeps ?c= and re-proves instead of revoking. A later probe that genuinely
// omits the conversation still lands in recordConversationAccessDenied.
export function recordConversationAccessExpired({
  queryClient,
  conversationId,
  accountOwner,
  verifiedAt,
}) {
  purgeConversationAccess(queryClient, conversationId, {
    accessTombstone: {
      conversation: null,
      actorAccessVerifiedAt: verifiedAt,
      accountOwner,
      accessProofExpired: true,
    },
    preserveDraft: true,
  });
}

function replaceOlderConversationAccessTombstone({
  queryClient,
  conversationId,
  accountOwner,
  verifiedAt,
  conversation = null,
}) {
  const queryKey = techKeys.conversationAccess(accountOwner, conversationId);
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  const cached = query?.state?.data;
  if (cached?.conversation !== null) return true;
  if (Number(cached?.actorAccessVerifiedAt || 0) > verifiedAt) return false;
  if (conversation) {
    queryClient.setQueryData(queryKey, {
      conversation,
      actorAccessVerifiedAt: verifiedAt,
      accountOwner,
    });
    return true;
  }
  if (query.getObserversCount() > 0) {
    // Keep the active QueryObserver attached, but reset its negative result and
    // force its single-conversation query to obtain the full row.
    void queryClient.resetQueries({ queryKey, exact: true });
    return true;
  }
  queryClient.removeQueries({ queryKey, exact: true });
  return true;
}

// Explicit whole-inbox cleanup is reserved for account/lifecycle boundaries.
// Normal offline expiry is per conversation so one stale proof cannot erase an
// unrelated ID whose actor-scoped proof is newer.
export function purgeConversationInboxAccess(queryClient) {
  if (!queryClient) return;

  // Enumerate before removal: each row can own a local draft and thread/access
  // caches that are not descendants of the inbox query key.
  cachedTechConversationIds(queryClient).forEach((conversationId) => {
    purgeConversationAccess(queryClient, conversationId);
  });
  queryClient.setQueriesData(
    { queryKey: ['tech', TECH_QUERY_KINDS.CONVOS] },
    (data) => (
      data
        ? {
          ...data,
          conversations: [],
          unread_total: 0,
          status_counts: {},
          actorAccessVerifiedAt: 0,
        }
        : data
    ),
  );
}

export function purgeExpiredConversationInboxAccess(queryClient, {
  accountOwner,
  accountGeneration = captureTechQueryAccountGeneration(),
  now = Date.now(),
} = {}) {
  if (!queryClient) return false;
  const leases = conversationLeasesByClient.get(queryClient);
  let purged = false;
  leases?.forEach((lease, conversationId) => {
    if (
      lease.accountGeneration !== accountGeneration
      || lease.accountOwner !== accountOwner
      || !techQueryAccountGenerationIsCurrent(lease.accountGeneration)
    ) {
      lease.cancel?.();
      leases.delete(conversationId);
      return;
    }
    if (!conversationAccessLeaseIsFresh(lease.verifiedAt, now)) {
      recordConversationAccessExpired({
        queryClient,
        conversationId,
        accountOwner,
        verifiedAt: lease.verifiedAt,
      });
      purged = true;
    }
  });
  let markedExpiredList = false;
  queryClient.setQueriesData(
    { queryKey: ['tech', TECH_QUERY_KINDS.CONVOS] },
    (data) => {
      if (
        data?.accountOwner === accountOwner
        && !conversationAccessLeaseIsFresh(data.actorAccessVerifiedAt, now)
      ) {
        markedExpiredList = true;
        return { ...data, accessProofExpired: true };
      }
      return data;
    },
  );
  return purged || markedExpiredList;
}

export function cachedTechConversationIds(queryClient, {
  accountOwner,
  includeDrafts = false,
  includeInbox = true,
  includeLeases = true,
} = {}) {
  if (!queryClient) return [];
  const conversationIds = new Set();
  queryClient.getQueryCache().getAll().forEach((query) => {
    const queryKey = query.queryKey || [];
    if (
      includeInbox
      && queryKey[0] === 'tech'
      && queryKey[1] === TECH_QUERY_KINDS.CONVOS
    ) {
      (query.state?.data?.conversations || []).forEach((conversation) => {
        if (conversation?.id) conversationIds.add(conversation.id);
      });
      return;
    }
    if (
      queryKey[0] === 'tech'
      && queryKey[1] === TECH_QUERY_KINDS.THREAD
      && queryKey[2]
    ) {
      conversationIds.add(queryKey[2]);
      return;
    }
    if (
      queryKey[0] === 'tech'
      && queryKey[1] === TECH_QUERY_KINDS.CONVERSATION_ACCESS
      && queryKey[3]
      && (!accountOwner || queryKey[2] === accountOwner)
      // A denial tombstone is terminal until a newer positive proof appears; it
      // must not keep nominating itself for every default-inbox snapshot.
      && query.state?.data?.conversation?.id === queryKey[3]
    ) {
      conversationIds.add(queryKey[3]);
      return;
    }
    if (
      queryKey[0] === 'conversation-members'
      && queryKey[2]
      && (!accountOwner || queryKey[1] === accountOwner)
    ) {
      conversationIds.add(queryKey[2]);
    }
  });
  if (includeLeases) {
    conversationLeasesByClient.get(queryClient)?.forEach((lease, conversationId) => {
      if (!accountOwner || lease.accountOwner === accountOwner) {
        conversationIds.add(conversationId);
      }
    });
  }
  if (includeDrafts && typeof localStorage !== 'undefined') {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('upr:conv-draft:')) {
          conversationIds.add(key.slice('upr:conv-draft:'.length));
        }
      }
    } catch {
      // Opaque storage must not prevent cache-backed IDs from being revalidated.
    }
  }
  return [...conversationIds];
}

function pruneOrphanedConversationLeases(queryClient, accountOwner, accountGeneration) {
  const leases = conversationLeasesByClient.get(queryClient);
  if (!leases) return;
  const cacheBackedIds = new Set(cachedTechConversationIds(queryClient, {
    accountOwner,
    includeDrafts: true,
    includeLeases: false,
  }));
  leases.forEach((lease, conversationId) => {
    const belongsToCurrentAccount = (
      lease.accountOwner === accountOwner
      && lease.accountGeneration === accountGeneration
      && techQueryAccountGenerationIsCurrent(lease.accountGeneration)
    );
    const hasDraft = Boolean(getDraft(conversationId));
    if (!belongsToCurrentAccount || (!cacheBackedIds.has(conversationId) && !hasDraft)) {
      lease.cancel?.();
      leases.delete(conversationId);
    }
  });
}

export async function loadTechConversationInboxAccess({
  db,
  queryClient,
  queryKey,
  accountOwner,
  accountGeneration = captureTechQueryAccountGeneration(),
  params,
  revalidateAllCachedAccess = false,
  now,
}) {
  if (!accountOwner) throw new Error('Conversation inbox access requires an account owner');
  const assertCurrentAccount = () => {
    if (!techQueryAccountGenerationIsCurrent(accountGeneration)) {
      throw accountChangedError();
    }
  };
  assertCurrentAccount();
  const previouslyVisibleIds = new Set(
    ((queryKey ? queryClient.getQueryData(queryKey) : null)?.conversations || [])
      .map((conversation) => conversation?.id)
      .filter(Boolean),
  );
  const proof = await runConversationAccessProbe({
    request: () => db.rpc('get_tech_conversations', params),
    now,
  });
  assertCurrentAccount();
  if (!proof.accepted) throw expiredProofError();
  const authorizedIds = new Set(
    (proof.value?.conversations || [])
      .map((conversation) => conversation?.id)
      .filter(Boolean),
  );
  if (revalidateAllCachedAccess) {
    pruneOrphanedConversationLeases(queryClient, accountOwner, accountGeneration);
  }
  const candidateSource = revalidateAllCachedAccess
    ? cachedTechConversationIds(queryClient, {
      accountOwner,
      includeDrafts: true,
    })
    : [...previouslyVisibleIds];
  const candidateIds = [...new Set(candidateSource)]
    .filter((conversationId) => !authorizedIds.has(conversationId));

  // A filtered/search/paginated inbox omission is not authorization proof.
  // Filtered views check only their exact prior page. The always-mounted default
  // query additionally checks sensitive cache/draft IDs outside its capped top 50.
  // Both use bounded actor-derived snapshots rather than N single-ID probes.
  const snapshotAuthorizedIds = new Set();
  for (let index = 0; index < candidateIds.length; index += 200) {
    const batch = candidateIds.slice(index, index + 200);
    const snapshot = await runConversationAccessProbe({
      request: () => db.rpc('get_my_conversation_access_snapshot', {
        p_conversation_ids: batch,
      }),
      now,
    });
    assertCurrentAccount();
    if (!snapshot.accepted) throw expiredProofError();
    (snapshot.value || []).forEach((row) => {
      if (row?.conversation_id) snapshotAuthorizedIds.add(row.conversation_id);
    });
    batch.forEach((conversationId) => {
      const latestLease = conversationLeasesByClient
        .get(queryClient)
        ?.get(conversationId);
      if (latestLease?.verifiedAt > snapshot.requestStartedAt) return;
      if (!snapshotAuthorizedIds.has(conversationId)) {
        recordConversationAccessDenied({
          queryClient,
          conversationId,
          accountOwner,
          verifiedAt: snapshot.requestStartedAt,
        });
        return;
      }
      const positiveProofIsCurrent = replaceOlderConversationAccessTombstone({
        queryClient,
        conversationId,
        accountOwner,
        verifiedAt: snapshot.requestStartedAt,
      });
      if (!positiveProofIsCurrent) return;
      renewTechConversationAccessLease({
        queryClient,
        conversationId,
        verifiedAt: snapshot.requestStartedAt,
        accountOwner,
        accountGeneration,
        now: now?.() ?? Date.now(),
      });
    });
  }
  assertCurrentAccount();
  if (!conversationAccessLeaseIsFresh(proof.requestStartedAt, now?.() ?? Date.now())) {
    throw expiredProofError();
  }
  const currentConversations = (proof.value?.conversations || []).filter((conversation) => {
    const positiveProofIsCurrent = replaceOlderConversationAccessTombstone({
      queryClient,
      conversationId: conversation?.id,
      accountOwner,
      verifiedAt: proof.requestStartedAt,
      conversation,
    });
    if (!positiveProofIsCurrent) return false;
    renewTechConversationAccessLease({
      queryClient,
      conversationId: conversation?.id,
      verifiedAt: proof.requestStartedAt,
      accountOwner,
      accountGeneration,
      now: now?.() ?? Date.now(),
    });
    return true;
  });
  const previousQueryData = queryKey ? queryClient.getQueryData(queryKey) : null;
  const reconciledConversations = reconcileAccessibleConversations(
    previousQueryData?.conversations,
    currentConversations,
    true,
  );
  return {
    ...(proof.value || {
      conversations: [],
      unread_total: 0,
      status_counts: {},
    }),
    conversations: reconciledConversations,
    actorAccessVerifiedAt: proof.requestStartedAt,
    accountOwner,
    accessProofExpired: false,
  };
}

export async function loadTechConversationAccess({
  db,
  queryClient,
  conversationId,
  accountOwner,
  accountGeneration = captureTechQueryAccountGeneration(),
  now,
}) {
  if (!accountOwner) throw new Error('Conversation access requires an account owner');
  if (!techQueryAccountGenerationIsCurrent(accountGeneration)) {
    throw accountChangedError();
  }
  const proof = await runConversationAccessProbe({
    request: () => db.rpc('get_tech_conversations', {
      p_conversation_id: conversationId,
    }),
    now,
  });
  if (!techQueryAccountGenerationIsCurrent(accountGeneration)) {
    throw accountChangedError();
  }
  if (!proof.accepted) {
    // The probe's round trip outlived the lease window — that proves slowness,
    // not removal. Hide content, keep the draft; a normal-speed retry decides.
    const latestLease = conversationLeasesByClient
      .get(queryClient)
      ?.get(conversationId);
    if (!latestLease || latestLease.verifiedAt <= proof.requestStartedAt) {
      recordConversationAccessExpired({
        queryClient,
        conversationId,
        accountOwner,
        verifiedAt: proof.requestStartedAt,
      });
    }
    throw expiredProofError();
  }
  if (proof.value?.conversations?.[0]) {
    const positiveProofIsCurrent = replaceOlderConversationAccessTombstone({
      queryClient,
      conversationId,
      accountOwner,
      verifiedAt: proof.requestStartedAt,
      conversation: proof.value.conversations[0],
    });
    if (!positiveProofIsCurrent) throw expiredProofError();
    renewTechConversationAccessLease({
      queryClient,
      conversationId,
      verifiedAt: proof.requestStartedAt,
      accountOwner,
      accountGeneration,
      now: now?.() ?? Date.now(),
    });
  } else {
    const latestLease = conversationLeasesByClient
      .get(queryClient)
      ?.get(conversationId);
    if (latestLease?.verifiedAt > proof.requestStartedAt) throw expiredProofError();
    recordConversationAccessDenied({
      queryClient,
      conversationId,
      accountOwner,
      verifiedAt: proof.requestStartedAt,
    });
  }
  return {
    conversation: proof.value?.conversations?.[0] || null,
    actorAccessVerifiedAt: proof.requestStartedAt,
    accountOwner,
  };
}
