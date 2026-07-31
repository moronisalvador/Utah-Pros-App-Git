/**
 * ════════════════════════════════════════════════
 * FILE: conversationAccessState.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps a refreshed inbox limited to chats the signed-in employee may still
 *   open. It also puts a short expiry on that proof so private messages and a
 *   saved draft disappear when the app cannot confirm access again.
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

export function reconcileAccessibleConversations(previous, fresh, silent = false) {
  if (!Array.isArray(fresh)) return previous;
  if (!silent || !Array.isArray(previous) || previous.length === 0) return fresh;

  const previousById = new Map(previous.map((row) => [row.id, row]));
  return fresh.map((row) => ({
    ...(previousById.get(row.id) || {}),
    ...row,
  }));
}

export function hasConversationAccess(conversations, conversationId) {
  return Boolean(
    conversationId
    && Array.isArray(conversations)
    && conversations.some((conversation) => conversation.id === conversationId),
  );
}
