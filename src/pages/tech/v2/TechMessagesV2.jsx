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
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import TechMsgsPane from './messages/TechMsgsPane.jsx';
import ConvoList from './messages/ConvoList.jsx';
import ThreadView from './messages/ThreadView.jsx';
import NewConversationView from './messages/NewConversationView.jsx';
import { useTechConversations } from './messages/useTechConversations.js';
import { useConvoMutations } from './messages/useConvoMutations.js';
import { mergeConvoIntoList, hasConversation } from './messages/msgsSelectors.js';

export default function TechMessagesV2({ active = true }) {
  const { db } = useAuth();
  const { t } = useTranslation('msgs');
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
  // The id whose single-row fetch genuinely failed (deleted / bad id). Keyed to the id
  // (not a boolean) so a stale failure from a previous ?c= never mislabels a new thread,
  // and no synchronous reset-in-effect is needed.
  const [failedId, setFailedId] = useState(null);
  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) || (deepLinked?.id === activeId ? deepLinked : null),
    [conversations, activeId, deepLinked],
  );
  const deepLinkFailed = !!activeId && !activeConv && failedId === activeId;

  // ?c= points at a conversation not in the current page → fetch it (single-row RPC
  // mode) and fold it into every cached convos view so it also shows in the list.
  useEffect(() => {
    if (!db || !activeId) return undefined;
    if (hasConversation(conversations, activeId) || deepLinked?.id === activeId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await db.rpc('get_tech_conversations', { p_conversation_id: activeId });
        const conv = res?.conversations?.[0];
        if (cancelled) return;
        if (!conv) { setFailedId(activeId); return; }
        setDeepLinked(conv);
        queryClient.setQueriesData({ queryKey: ['tech', 'convos'] }, (data) => {
          if (!data || !Array.isArray(data.conversations)) return data;
          return { ...data, conversations: mergeConvoIntoList(data.conversations, conv) };
        });
      } catch (err) { console.error('Deep-link conversation error:', err); if (!cancelled) setFailedId(activeId); }
    })();
    return () => { cancelled = true; };
  }, [db, activeId, conversations, deepLinked, queryClient]);

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
  }, [queryClient, searchParams, setSearchParams]);

  // The thread layer covers the list whenever a ?c= is present (real thread OR the
  // not-found panel) so Back always returns to the list, never a dead end.
  const threadOpen = newConversationOpen || (!!activeId && (!!activeConv || deepLinkFailed));

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
            onEnableDnd={enableDnd}
            scrollRef={threadScrollRef}
          />
        ) : (
          <div className="tv2-msgs-thread">
            <header className="tv2-msgs-thread__bar">
              <button type="button" className="tv2-msgs-thread__back" aria-label={t('thread.back')} onClick={closeThread}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width={24} height={24}><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <div className="tv2-msgs-thread__title">{t('list.title')}</div>
              <div className="tv2-msgs-thread__bar-spacer" aria-hidden="true" />
            </header>
            <div className="tv2-msgs-thread__body">
              <div className="tv2-msgs-thread__error">
                <div className="tv2-msgs-thread__empty">{t('states.notFound')}</div>
                <button type="button" className="tv2-msgs-retry-btn" onClick={closeThread}>{t('states.backToList')}</button>
              </div>
            </div>
          </div>
        )
      ) : null}
    />
  );
}
