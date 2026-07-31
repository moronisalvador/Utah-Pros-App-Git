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
 *   - Only 401/403 are authorization loss. A network timeout keeps stale rendered
 *     data available for retry and must not be misclassified as revocation.
 *   - Raw thread bodies and inbox previews are also excluded from disk persistence;
 *     this helper closes the same-account in-memory removal window.
 * ════════════════════════════════════════════════
 */

import { clearDraft } from '@/components/conversations/messageUtils';
import { TECH_QUERY_KINDS, techKeys } from '@/lib/techQuery';

export function isConversationAccessDenied(error) {
  return error?.status === 401 || error?.status === 403;
}

export function pruneConversationFromInbox(data, conversationId) {
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
  };
}

export function purgeConversationAccess(queryClient, conversationId) {
  if (!queryClient || !conversationId) return;

  queryClient.removeQueries({
    queryKey: techKeys.thread(conversationId),
    exact: true,
  });
  queryClient.removeQueries({
    predicate: (query) => (
      query.queryKey?.[0] === 'tech'
      && query.queryKey?.[1] === TECH_QUERY_KINDS.CONVERSATION_ACCESS
      && query.queryKey?.[3] === conversationId
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
    (data) => pruneConversationFromInbox(data, conversationId),
  );
  clearDraft(conversationId);
}
