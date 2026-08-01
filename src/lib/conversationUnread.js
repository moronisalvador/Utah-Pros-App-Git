/**
 * ════════════════════════════════════════════════
 * FILE: conversationUnread.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends read/unread changes through the actor-validated database RPC instead
 *   of granting browsers direct UPDATE access to the conversations table.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  an authenticated db client supplied by useAuth()
 *   Data:      writes → conversations.unread_count through
 *                       set_my_conversation_unread_state
 *
 * NOTES / GOTCHAS:
 *   - A null conversation list means "mark every currently accessible chat read"
 *     and is intentionally invalid for marking every chat unread.
 *   - The database rechecks both Messages capability and current membership.
 * ════════════════════════════════════════════════
 */

export async function setMyConversationUnreadState(
  db,
  conversationIds,
  unread = false,
) {
  if (!db?.rpc) throw new TypeError('An authenticated database client is required');
  if (conversationIds == null && unread) {
    throw new TypeError('Conversation ids are required when marking unread');
  }

  const normalizedIds = conversationIds == null
    ? null
    : [...new Set(conversationIds.filter(Boolean))];

  return db.rpc('set_my_conversation_unread_state', {
    p_conversation_ids: normalizedIds,
    p_unread: Boolean(unread),
  });
}
