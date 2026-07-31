/**
 * ════════════════════════════════════════════════
 * FILE: TechMessagesV2.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The field tech's text-messaging screen — a native-feeling inbox that stays alive in
 *   the background so switching tabs is instant. It shows the list of conversations;
 *   tapping one slides into that thread, and the browser Back button (or an iOS
 *   swipe-back) returns to the list. The open thread lives in the web address as
 *   ?c=<id>, so a push-notification link opens straight to it — even to a conversation
 *   not on the current page (it fetches just that one and folds it in). The list keeps
 *   its scroll position; the thread opens pinned to the newest message.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/conversations (behind page:tech_msgs_v2; legacy Conversations
 *                 otherwise)
 *   Rendered by:  TechLayout pane host (persistent, flag-gated pane)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, ./messages/TechMsgsPane (two-layer host),
 *              ./messages/useTechConversations (F-M convos hook — the sole convos-cache
 *              owner), ./messages/{ConvoList,ThreadView}, ./messages/msgsSelectors
 *   Data:      reads → get_tech_conversations (via the hook + single-row deep-link mode)
 *
 * NOTES / GOTCHAS:
 *   - `active` (this pane is the visible tab) gates the thread realtime + keyboard var.
 *   - Search is debounced into the hook's query key so typing doesn't hammer the RPC;
 *     All/Unread + search are server-side (the RPC's p_status / p_search), cached per
 *     filter. The tab badge reads the unfiltered default view (F-M contract).
 *   - Owned by the tech-messages-v2 initiative (B1 built the core; B2 added MMS, status
 *     pills, templates, mark-unread, one-tap DND ON, the thread info header, group/
 *     broadcast rendering, and the error/not-found states) —
 *     .claude/rules/tech-messages-v2-wave-ownership.md §2.
 * ════════════════════════════════════════════════
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import TechMsgsPane from './messages/TechMsgsPane.jsx';
import ConvoList from './messages/ConvoList.jsx';
import ThreadView from './messages/ThreadView.jsx';
import NewConversationView from './messages/NewConversationView.jsx';
import { useTechConversations } from './messages/useTechConversations.js';
import { useConvoMutations } from './messages/useConvoMutations.js';
import { mergeConvoIntoList } from './messages/msgsSelectors.js';
import { purgeConversationAccess } from './messages/accessRevocation.js';
import { techKeys } from '@/lib/techQuery';

export default function TechMessagesV2({ active = true }) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const activeId = searchParams.get('c');
  const newConversationOpen = searchParams.get('new') === '1';
  const threadScrollRef = useRef(null);

  const { setUnread, markAllRead, enableDnd } = useConvoMutations();

  // ─── SECTION: List filter + debounced search ──────────────
  const [filter, setFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  const { conversations, statusCounts, isColdStart, error, refresh } = useTechConversations({ status: filter, search });

  // ─── SECTION: Active conversation resolution (+ deep-link miss) ──────────────
  const [deepLinked, setDeepLinked] = useState(null);

  const revokeConversationAccess = useCallback((conversationId) => {
    if (!conversationId) return;
    purgeConversationAccess(queryClient, conversationId);
    setDeepLinked((current) => (
      current?.id === conversationId ? null : current
    ));
    const next = new URLSearchParams(searchParams);
    if (next.get('c') === conversationId) {
      next.delete('c');
      setSearchParams(next, { replace: true });
    }
  }, [queryClient, searchParams, setDeepLinked, setSearchParams]);

  // One actor-owned access probe handles both deep links and same-account removal.
  // It silently rechecks on focus/reconnect and every minute; an offline error keeps
  // the rendered thread, while a successful empty result purges it immediately.
  const activeConversationQuery = useQuery({
    queryKey: techKeys.conversationAccess(employee?.id, activeId),
    enabled: Boolean(db && employee?.id && activeId && !newConversationOpen),
    queryFn: async () => {
      const result = await db.rpc('get_tech_conversations', {
        p_conversation_id: activeId,
      });
      return result?.conversations?.[0] || null;
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const activeConv = useMemo(
    () => (
      conversations.find((conversation) => conversation.id === activeId)
      || (
        activeConversationQuery.isSuccess
        && activeConversationQuery.data?.id === activeId
          ? activeConversationQuery.data
          : null
      )
      || (deepLinked?.id === activeId ? deepLinked : null)
    ),
    [
      activeConversationQuery.data,
      activeConversationQuery.isSuccess,
      conversations,
      activeId,
      deepLinked,
    ],
  );

  useEffect(() => {
    if (!activeId || !activeConversationQuery.isSuccess) return;
    const conversation = activeConversationQuery.data;
    if (!conversation) {
      const revokeTimer = window.setTimeout(
        () => revokeConversationAccess(activeId),
        0,
      );
      return () => window.clearTimeout(revokeTimer);
    }
    queryClient.setQueriesData({ queryKey: ['tech', 'convos'] }, (data) => {
      if (!data || !Array.isArray(data.conversations)) return data;
      return {
        ...data,
        conversations: mergeConvoIntoList(data.conversations, conversation),
      };
    });
  }, [
    activeConversationQuery.data,
    activeConversationQuery.isSuccess,
    activeId,
    queryClient,
    revokeConversationAccess,
  ]);

  // ─── SECTION: URL-driven open / close ──────────────
  const openThread = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    next.set('c', id);
    setSearchParams(next);           // push → Back / iOS swipe-back closes the thread
  }, [searchParams, setSearchParams]);

  const openNewConversation = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('c');
    next.set('new', '1');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const closeThread = useCallback(() => {
    // navigate(-1) mirrors the push so the back-stack stays honest (native swipe-back).
    navigate(-1);
  }, [navigate]);

  const handleConversationStarted = useCallback((conversation) => {
    setDeepLinked(conversation);
    queryClient.setQueriesData({ queryKey: ['tech', 'convos'] }, (data) => {
      if (!data || !Array.isArray(data.conversations)) return data;
      return { ...data, conversations: mergeConvoIntoList(data.conversations, conversation) };
    });
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.set('c', conversation.id);
    setSearchParams(next, { replace: true });
  }, [queryClient, searchParams, setDeepLinked, setSearchParams]);

  // A successful access probe is required before a deep link can render a thread.
  // A failed network probe preserves an already-open authorized thread for retry,
  // while a successful empty response purges it through revokeConversationAccess.
  const threadOpen = newConversationOpen || Boolean(activeId && activeConv);

  return (
    <TechMsgsPane
      active={active}
      threadOpen={threadOpen}
      list={(
        <ConvoList
          conversations={conversations}
          statusCounts={statusCounts}
          isColdStart={isColdStart}
          error={error}
          onOpen={openThread}
          onRefresh={refresh}
          filter={filter}
          onFilterChange={setFilter}
          search={searchInput}
          onSearchChange={setSearchInput}
          onSetUnread={setUnread}
          onMarkAllRead={markAllRead}
          onNewConversation={openNewConversation}
        />
      )}
      thread={threadOpen ? (
        newConversationOpen ? (
          <NewConversationView
            onBack={closeThread}
            onStarted={handleConversationStarted}
          />
        ) : activeConv ? (
          <ThreadView
            key={activeId}
            convId={activeId}
            conv={activeConv}
            active={active && threadOpen}
            onBack={closeThread}
            onAccessRevoked={revokeConversationAccess}
            onEnableDnd={enableDnd}
            scrollRef={threadScrollRef}
          />
        ) : null
      ) : null}
    />
  );
}
