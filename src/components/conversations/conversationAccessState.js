/**
 * ════════════════════════════════════════════════
 * FILE: conversationAccessState.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps a refreshed inbox limited to chats the signed-in employee may still
 *   open. It also puts a short expiry on that proof so private messages leave
 *   the screen when the app cannot confirm access again. On the tech pane an
 *   expired-but-unproven chat keeps its saved draft and comes back once access
 *   is re-confirmed; the draft is erased only when access is actually denied.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - A network failure does not renew the lease. Missing rows in a successful
 *     refresh are removed, and an expired lease closes a warm offline thread.
 * ════════════════════════════════════════════════
 */

// A thread may tolerate a brief network handoff, but it must never keep private
// message text or a draft on screen indefinitely when membership cannot be proven.
export const CONVERSATION_ACCESS_LEASE_MS = 30_000;

export function conversationAccessLeaseIsFresh(verifiedAt, now = Date.now()) {
  return Boolean(verifiedAt)
    && now - verifiedAt >= 0
    && now - verifiedAt < CONVERSATION_ACCESS_LEASE_MS;
}

// Schedule one lease boundary without polling. The caller remains responsible for
// rechecking access before the timer fires; this just ensures an otherwise idle
// inbox cannot retain private labels or previews past its last successful proof.
export function scheduleConversationAccessExpiry({
  verifiedAt,
  onExpire,
  now = Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const delay = Math.max(0, CONVERSATION_ACCESS_LEASE_MS - (now - verifiedAt));
  const timer = setTimer(onExpire, delay);
  return () => clearTimer(timer);
}

export function createConversationAccessRequestGuard() {
  let latestRequestToken = 0;
  return {
    begin() {
      latestRequestToken += 1;
      return latestRequestToken;
    },
    invalidate() {
      latestRequestToken += 1;
    },
    isCurrent(requestToken) {
      return requestToken === latestRequestToken;
    },
  };
}

// Access proof begins when the actor-scoped request leaves the client, not when
// its response eventually arrives. A suspended/offline request that resolves
// after the lease boundary must never mint a fresh 30-second lease.
export async function runConversationAccessProbe({
  request,
  requestGuard,
  onExpired,
  now = Date.now,
} = {}) {
  const requestToken = requestGuard?.begin();
  const requestStartedAt = now();
  let value;
  try {
    value = await request();
  } catch (error) {
    if (requestGuard && !requestGuard.isCurrent(requestToken)) {
      return {
        accepted: false,
        superseded: true,
        requestStartedAt,
        value: null,
      };
    }
    throw error;
  }
  if (requestGuard && !requestGuard.isCurrent(requestToken)) {
    return {
      accepted: false,
      superseded: true,
      requestStartedAt,
      value: null,
    };
  }
  if (!conversationAccessLeaseIsFresh(requestStartedAt, now())) {
    onExpired?.();
    return {
      accepted: false,
      requestStartedAt,
      value: null,
    };
  }
  return {
    accepted: true,
    requestStartedAt,
    value,
  };
}

// Resume callbacks use this small coordinator so privacy cleanup is guaranteed
// to finish synchronously before a revalidation promise can be created.
export function revalidateConversationAccessAfterResume({
  purgeExpired,
  revalidate,
} = {}) {
  purgeExpired?.();
  return revalidate?.();
}

export function conversationIdsOmittedFromProof(
  cachedConversations,
  authorizedConversations,
  leasedConversationIds = [],
) {
  const authorizedIds = new Set(
    (authorizedConversations || [])
      .map((conversation) => conversation?.id)
      .filter(Boolean),
  );
  return [...new Set([
    ...(cachedConversations || []).map((conversation) => conversation?.id),
    ...leasedConversationIds,
  ].filter(Boolean))].filter((conversationId) => !authorizedIds.has(conversationId));
}

// The resume/expiry sweep, as a decision rather than an effect. Every id whose
// lease has aged out is EXPIRED — the clock said so, the server said nothing — so
// it is handed to `onExpire`, which may hide protected content but must not
// destroy the employee's own draft or the open route. Losing access is proven
// only by `revokeConversationsOmittedFromProof` below, on a SUCCESSFUL refresh.
//
// This is the desktop twin of the tech pane's `recordConversationAccessExpired`
// (`accessRevocation.js`) and carries the same rule; it lives here because the
// desktop screen holds its inbox in component state rather than a query cache, so
// the policy is all that can usefully be shared. Keeping the two callbacks
// separate is the whole fix: one function for both is how expiry silently became
// revocation on both shells.
export function expireStaleConversationAccessLeases({
  cachedConversationIds,
  leases,
  now = Date.now(),
  onExpire,
} = {}) {
  const conversationIds = [...new Set(
    [...(cachedConversationIds || [])].filter(Boolean),
  )];
  const expiredConversationIds = conversationIds.filter((conversationId) => (
    // A missing lease is not a fresh one. An id reachable from a cache or a draft
    // with no proof behind it has to be treated as expired, never as allowed.
    !conversationAccessLeaseIsFresh(leases?.get?.(conversationId) || 0, now)
  ));
  expiredConversationIds.forEach((conversationId) => onExpire?.(conversationId));
  return expiredConversationIds;
}

export function revokeConversationsOmittedFromProof({
  cachedConversations,
  authorizedConversations,
  leasedConversationIds,
  onRevoke,
} = {}) {
  const removedConversationIds = conversationIdsOmittedFromProof(
    cachedConversations,
    authorizedConversations,
    leasedConversationIds,
  );
  removedConversationIds.forEach((conversationId) => onRevoke?.(conversationId));
  return removedConversationIds;
}

function accessValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => accessValuesEqual(value, right[index]));
  }
  if (
    left
    && right
    && typeof left === 'object'
    && typeof right === 'object'
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => (
        Object.hasOwn(right, key)
        && accessValuesEqual(left[key], right[key])
      ));
  }
  return false;
}

export function reconcileAccessibleConversations(previous, fresh, silent = false) {
  if (!Array.isArray(fresh)) return previous;
  if (!silent || !Array.isArray(previous) || previous.length === 0) return fresh;

  const freshById = new Map(fresh.map((row) => [row.id, row]));
  const previousIds = new Set(previous.map((row) => row.id));
  const retained = previous
    .filter((row) => freshById.has(row.id))
    .map((previousRow) => {
      const freshRow = freshById.get(previousRow.id);
      const serverFieldsUnchanged = Object.keys(freshRow).every((key) => (
        Object.hasOwn(previousRow, key)
        && accessValuesEqual(previousRow[key], freshRow[key])
      ));
      return serverFieldsUnchanged
        ? previousRow
        : { ...previousRow, ...freshRow };
    });
  const appended = fresh.filter((row) => !previousIds.has(row.id));
  return [...retained, ...appended];
}

export function hasConversationAccess(conversations, conversationId) {
  return Boolean(
    conversationId
    && Array.isArray(conversations)
    && conversations.some((conversation) => conversation.id === conversationId),
  );
}
