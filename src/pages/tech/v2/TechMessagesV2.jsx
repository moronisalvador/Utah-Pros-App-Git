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
import {
  CONVERSATION_PURGE_DENIED,
  CONVERSATION_PURGE_LEASE_EXPIRED,
  hasFreshTechConversationAccess,
  isConversationAccessDenied,
  loadTechConversationAccess,
  purgeConversationAccess,
} from './messages/accessRevocation.js';
import {
  captureTechQueryAccountGeneration,
  techKeys,
  techQueryAccountGenerationIsCurrent,
} from '@/lib/techQuery';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import {
  conversationAccessLeaseIsFresh,
} from '@/components/conversations/conversationAccessState';

export default function TechMessagesV2({ active = true }) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const accountGeneration = captureTechQueryAccountGeneration();

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

  // `cause` defaults to denied so every existing caller — the null-conversation
  // effect, ThreadView's send refusal, useThread's 401/403 — keeps destroying staged
  // composer work. Only the two clock-expiry branches below opt out.
  const revokeConversationAccess = useCallback((conversationId, { cause } = {}) => {
    if (!conversationId) return;
    if (!techQueryAccountGenerationIsCurrent(accountGeneration)) return;
    purgeConversationAccess(queryClient, conversationId, cause ? { cause } : undefined);
    setDeepLinked((current) => (
      current?.id === conversationId ? null : current
    ));
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (next.get('c') === conversationId) next.delete('c');
      return next;
    }, { replace: true });
  }, [accountGeneration, queryClient, setSearchParams]);

  // One actor-owned access probe handles both deep links and same-account removal.
  // It silently rechecks on focus/reconnect and every minute; an offline error keeps
  // the rendered thread, while a successful empty result purges it immediately.
  const activeConversationQuery = useQuery({
    queryKey: techKeys.conversationAccess(employee?.id, activeId),
    enabled: Boolean(db && employee?.id && activeId && !newConversationOpen),
    queryFn: () => loadTechConversationAccess({
      db,
      queryClient,
      conversationId: activeId,
      accountOwner: employee.id,
      accountGeneration,
    }),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // The lease begins when the actor-scoped request starts. React Query's
  // dataUpdatedAt is receipt-time and must never extend a slow proof.
  const accessLeaseIsFresh = useCallback((
    verifiedAt = activeConversationQuery.data?.actorAccessVerifiedAt
  ) => (
    conversationAccessLeaseIsFresh(verifiedAt)
  ), [activeConversationQuery.data?.actorAccessVerifiedAt]);
  const hasActiveAccessLease = hasFreshTechConversationAccess(
    activeConversationQuery.data,
    employee?.id,
    activeId,
  );

  const revalidateActiveAccess = useCallback(async () => {
    if (!activeId || newConversationOpen) return;
    // "Never proven yet" is NOT "proof expired". A push deep link arrives with a
    // brand-new activeId and no lease, and resuming from the background fires
    // this on the same tick — so revoking here stripped ?c= and dropped the user
    // on the conversation list before the probe could ever run. That is the
    // 2026-08 "notification opens the list, never the thread" bug.
    //
    // Skipping the early revoke leaks nothing: threadOpen already requires
    // hasActiveAccessLease, so with no lease there is no message content, label,
    // or draft on screen to purge. The offline-purge property below is unchanged
    // — an EXPIRED lease still revokes immediately, with no network round trip.
    const provenAt = activeConversationQuery.data?.actorAccessVerifiedAt;
    if (provenAt && !accessLeaseIsFresh(provenAt)) {
      // Do not leave text or a local draft visible while offline after the lease.
      // Nothing here is a server refusal — the clock ran out while the app was in
      // the background — so the tech's staged photos wait for the re-prove.
      revokeConversationAccess(activeId, { cause: CONVERSATION_PURGE_LEASE_EXPIRED });
      return;
    }
    const result = await activeConversationQuery.refetch();
    if (!result.isSuccess && !accessLeaseIsFresh(result.data?.actorAccessVerifiedAt)) {
      // This branch covers both an offline refetch and a real 401/403, so read the
      // error rather than assuming: only a non-denial keeps the staged photos.
      revokeConversationAccess(activeId, {
        cause: isConversationAccessDenied(result.error)
          ? CONVERSATION_PURGE_DENIED
          : CONVERSATION_PURGE_LEASE_EXPIRED,
      });
    }
  }, [accessLeaseIsFresh, activeConversationQuery, activeId, newConversationOpen, revokeConversationAccess]);

  useResumeRefetch({
    onResume: revalidateActiveAccess,
    pollMs: 5_000,
    hiddenEdgeOnly: true,
    enabled: Boolean(activeId && !newConversationOpen),
  });

  const activeConv = useMemo(
    () => (
      conversations.find((conversation) => conversation.id === activeId)
      || (
        activeConversationQuery.data?.accountOwner === employee?.id
        && activeConversationQuery.data?.conversation?.id === activeId
          ? activeConversationQuery.data.conversation
          : null
      )
      || (deepLinked?.id === activeId ? deepLinked : null)
    ),
    [
      activeConversationQuery.data,
      conversations,
      activeId,
      deepLinked,
      employee?.id,
    ],
  );

  useEffect(() => {
    if (
      !activeId
      || activeConversationQuery.data?.accountOwner !== employee?.id
    ) return;
    const conversation = activeConversationQuery.data?.conversation;
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
    activeId,
    employee?.id,
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
  // During the short lease a failed network probe keeps the existing view stable;
  // after it expires, revalidateActiveAccess purges it and its draft before render.
  const threadOpen = newConversationOpen || Boolean(activeId && activeConv && hasActiveAccessLease);

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
