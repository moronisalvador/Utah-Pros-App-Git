/**
 * ════════════════════════════════════════════════
 * FILE: conversationAccessState.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES:
 *   Reconciles an inbox refresh against the rows the current database actor may
 *   still access. Missing rows are deliberately removed instead of preserved.
 *
 * NOTES:
 *   A network failure never calls this helper. Only a successful, authoritative
 *   response may remove an existing conversation from the rendered inbox.
 * ════════════════════════════════════════════════
 */

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
