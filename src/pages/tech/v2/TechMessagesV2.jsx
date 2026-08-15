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
 *   Packages:  react, react-router-dom, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, ./messages/TechMsgsPane (two-layer host),
 *              ./messages/useTechConversations (F-M convos hook — the sole convos-cache
 *              owner), ./messages/{ConvoList,ThreadView,NewConversationView},
 *              ./messages/msgsSelectors, ./messages/useConvoMutations,
 *              ./messages/accessRevocation (lease probes + expired/denied purges),
 *              @/lib/techQuery, @/hooks/useResumeRefetch,
 *              @/components/conversations/conversationAccessState
 *   Data:      reads → get_tech_conversations (via the hook + single-row deep-link mode)
 *
 * NOTES / GOTCHAS:
 *   - `active` (this pane is the visible tab) gates the thread realtime + keyboard var.
 *   - Search is debounced into the hook's query key so typing doesn't hammer the RPC;
 *     All/Unread + search are server-side (the RPC's p_status / p_search), cached per
 *     filter. The tab badge reads the unfiltered default view (F-M contract).
 *   - Resume past the 30s access lease (2026-08-14): EXPIRED ≠ DENIED. The thread
 *     stays mounted and re-proves in place for one bounded grace, so a normal
 *     resume moves nothing — no drop to the list, no loading flash, no lost
 *     scroll — and the draft and ?c= survive. An offline or hung probe still
 *     closes the thread when that grace runs out. Only a genuine denial (no row,
 *     401/403) revokes the route and clears the draft. Backgrounding for 35s used
 *     to exit the thread and destroy the draft on resume.
 *   - `reproving`, not `hasActiveAccessLease`, gates the list/thread swap. The
 *     lease flag flips false the moment the clock passes it, synchronously,
 *     before any probe can answer — gating the swap on it is what unmounted the
 *     thread on resume.
 *   - A denial that revokes the route SAYS SO ('warning' toast). It used to unmount
 *     the thread and strip ?c= in silence, so a tech mid-typing watched the screen
 *     drop to the list with no explanation. Announcing is safe only because expiry
 *     no longer reaches revokeConversationAccess (above) — otherwise every app
 *     resume past 30s would have toasted, and the bounded grace above does not
 *     change that: when it lapses it purges through recordConversationAccessExpired,
 *     never through the revoke path. Leaving a chat passes announce: false.
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
  hasFreshTechConversationAccess,
  isConversationAccessDenied,
  loadTechConversationAccess,
  purgeConversationAccess,
  recordConversationAccessExpired,
} from './messages/accessRevocation.js';
import {
  captureTechQueryAccountGeneration,
  techKeys,
  techQueryAccountGenerationIsCurrent,
} from '@/lib/techQuery';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import { toast } from '@/lib/toast';
import {
  conversationAccessLeaseIsFresh,
  conversationAccessReproveGraceIsOpen,
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

  // The last conversation row proven under a FRESH lease for the current ?c=.
  // Held only so the thread can stay mounted through the bounded re-prove grace
  // (the expiry tombstone nulls `conversation`, and nulling it is load-bearing
  // for the tombstone-ordering rules, so the row cannot come from there).
  const provenConvRef = useRef(null);

  // Reaching here is always a PROVEN denial — a probe that returned no row, a
  // 401/403, or a refused send. Clock expiry never lands here: it goes to
  // recordConversationAccessExpired, which keeps ?c= and re-proves. So the
  // announcement below cannot fire on an ordinary app resume.
  //
  // `announce: false` is for the one caller that is not a denial at all — the
  // tech tapping "Leave chat", which already says "You left this chat". Two
  // toasts for one deliberate tap, the second contradicting the first, is worse
  // than silence. Mirrors Conversations.jsx's `announce` option.
  const revokeConversationAccess = useCallback((conversationId, { announce = true } = {}) => {
    if (!conversationId) return;
    if (!techQueryAccountGenerationIsCurrent(accountGeneration)) return;
    purgeConversationAccess(queryClient, conversationId);
    if (provenConvRef.current?.id === conversationId) provenConvRef.current = null;
    setDeepLinked((current) => (
      current?.id === conversationId ? null : current
    ));
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (next.get('c') === conversationId) next.delete('c');
      return next;
    }, { replace: true });
    // 'warning' (amber ⚠️), NOT 'info': both toast containers render every type
    // except 'error'/'warning' as a GREEN ✅ success toast, so an 'info' here
    // would tell a tech they lost access under a green checkmark. Not 'error'
    // either — that takes role="alert" and interrupts, and losing access is a
    // state change, not a failure the tech caused. The container's
    // role="status" aria-live="polite" announces it (loading-error-states.md §4).
    if (announce) toast('You no longer have access to this chat', 'warning');
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
    // or draft on screen to purge.
    const provenAt = activeConversationQuery.data?.actorAccessVerifiedAt;
    if (provenAt && !accessLeaseIsFresh(provenAt)) {
      // EXPIRED ≠ DENIED (2026-08-14). This used to revoke — the DENIAL purge —
      // so backgrounding the app past the 30s lease destroyed the half-typed
      // draft and stripped ?c=, dumping the tech on the list on every resume
      // (page-lifecycle.md minimize test; tech-mobile-ux.md resume law). Hide
      // protected content synchronously — before any revalidation promise can
      // exist — but keep the draft and the route; the probe below re-proves and
      // the thread restores in place, draft intact.
      recordConversationAccessExpired({
        queryClient,
        conversationId: activeId,
        accountOwner: employee?.id,
        verifiedAt: provenAt,
      });
    }
    const result = await activeConversationQuery.refetch();
    // A probe that DENIES still revokes fully: 401/403 here, or a successful
    // probe with no row (the tombstone effect below sees conversation: null
    // without the accessProofExpired mark). A network failure keeps the hidden
    // thread parked behind ?c= — the 15s interval keeps re-proving, and the
    // expired purge above already removed everything protected from memory.
    if (!result.isSuccess && isConversationAccessDenied(result.error)) {
      revokeConversationAccess(activeId);
    }
  }, [accessLeaseIsFresh, activeConversationQuery, activeId, employee?.id, newConversationOpen, queryClient, revokeConversationAccess]);

  // Resume edge ONLY — the query's own refetchInterval owns the cadence.
  // Both used to poll `get_tech_conversations` for the open thread while
  // foregrounded (15s here, 5s there ≈ 16 calls a minute), and the 5s copy
  // renewed nothing the 15s one did not: one interval is already half the 30s
  // lease. React Query also pauses refetchInterval while the tab is hidden, the
  // same guard the poll had (perf-budget.md §3).
  useResumeRefetch({
    onResume: revalidateActiveAccess,
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
      // An EXPIRED tombstone (accessProofExpired) means "re-prove", not
      // "denied": keep ?c= and the parked draft; the interval/resume probe
      // restores the thread. Only a genuine denial reaches the revoke below.
      if (activeConversationQuery.data?.accessProofExpired) return undefined;
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

  // ─── SECTION: Re-prove grace (the visible half of EXPIRED ≠ DENIED) ──────────
  // A lease that aged out while the phone was in a pocket is not a membership
  // change, but `hasActiveAccessLease` goes false the instant it expires —
  // synchronously, before the re-proof can possibly answer. Gating the
  // list/thread swap on it alone unmounted ThreadView on every resume past 30s:
  // the tech landed on the conversation list, and the remount cold-loaded the
  // thread (TabLoading flash) and snapped a mid-history scroll to the newest
  // message (page-lifecycle.md §2 / §5, and the mandatory minimize test).
  //
  // So the swap is gated on `reproving` as well. It is open only while the
  // expiry tombstone's own bounded deadline has not passed, so an offline or
  // hung probe still clears the screen — and the same deadline drives the timer
  // that empties the cache, so the pixels and the memory can never disagree.
  // A DENIAL tombstone carries no accessProofExpired, so a real revocation skips
  // this entirely and closes the thread at once.
  const reproving = Boolean(
    activeId
    && !newConversationOpen
    && !hasActiveAccessLease
    && activeConversationQuery.data?.accessProofExpired
    && conversationAccessReproveGraceIsOpen(
      activeConversationQuery.data.accessReproveDeadline,
    )
    // A probe that has settled into an error ends the grace early: with
    // retry:false the next attempt is a whole refetchInterval away, which is
    // already longer than the grace.
    && (activeConversationQuery.isFetching || !activeConversationQuery.isError),
  );

  useEffect(() => {
    if (activeId && hasActiveAccessLease && activeConv?.id === activeId) {
      provenConvRef.current = { id: activeId, conversation: activeConv };
    }
  }, [activeId, activeConv, hasActiveAccessLease]);

  const renderedConv = activeConv || (
    reproving && provenConvRef.current?.id === activeId
      ? provenConvRef.current.conversation
      : null
  );

  // A successful access probe is required before a deep link can render a thread.
  // During the short lease a failed network probe keeps the existing view stable;
  // once it expires the thread holds for one re-prove grace and then closes, and
  // the draft and ?c= survive either way so the thread restores on success.
  const threadOpen = newConversationOpen
    || Boolean(activeId && renderedConv && (hasActiveAccessLease || reproving));

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
        ) : renderedConv ? (
          <ThreadView
            key={activeId}
            convId={activeId}
            conv={renderedConv}
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
