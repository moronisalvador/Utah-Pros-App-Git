/**
 * ════════════════════════════════════════════════
 * FILE: useTechConversations.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads the field tech's list of text-message conversations and keeps it fresh.
 *   It fetches one page of the inbox from the database, quietly re-checks every
 *   minute, and listens for live changes so a new or updated conversation shows up
 *   on its own. It also hands back the total number of unread messages — that's the
 *   little red dot on the "Messages" tab. This is the ONE place the messaging inbox
 *   is loaded and cached; the tab badge and the messaging screen both read from here
 *   so they never disagree or double-load.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  src/components/TechLayout.jsx (the Messages-tab badge) and
 *                 src/pages/tech/v2/messages/** (the messaging pane list, Phase B1)
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query
 *   Internal:  @/contexts/AuthContext (authenticated db client), @/lib/realtime
 *              (subscribeToConversations), @/lib/techQuery (techKeys, invalidateTech)
 *   Data:      reads → get_tech_conversations RPC (conversations, unread_total,
 *                       status_counts). No writes.
 *
 * NOTES / GOTCHAS:
 *   - `unread_total` returned by the RPC is GLOBAL (never narrowed by the filter/
 *     search passed here), so the tab badge is correct even when the list is showing
 *     a filtered view. `status_counts` reflects the current search (for the pills).
 *   - Realtime: exactly ONE `subscribeToConversations` channel is shared across every
 *     hook instance via a module-level ref count — the badge and the pane don't each
 *     open a socket. On any conversation change it invalidates the whole `convos`
 *     kind (prefix), refreshing every filtered view + the badge. A targeted
 *     setQueryData patch can't keep server-side ordering/counts honest, so an
 *     invalidate is the correct primitive here.
 *   - Realtime verification requires a genuine authenticated JWT. The former
 *     anonymous local employee selector is retired and is not a supported test
 *     path. REST polling and Realtime are both verified with a real login.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToConversations } from '@/lib/realtime';
import {
  captureTechQueryAccountGeneration,
  techKeys,
  invalidateTech,
  techQueryAccountGenerationIsCurrent,
} from '@/lib/techQuery';
import {
  revalidateConversationAccessAfterResume,
  scheduleConversationAccessExpiry,
} from '@/components/conversations/conversationAccessState';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import {
  hasFreshTechConversationInboxAccess,
  loadTechConversationInboxAccess,
  purgeExpiredConversationInboxAccess,
  techConversationInboxAccessError,
} from './accessRevocation';

const REFETCH_MS = 15_000; // Renew the 30s actor-scoped inbox-access lease before expiry.
const EMPTY = { conversations: [], unread_total: 0, status_counts: {} };

// ─── SECTION: Shared realtime channel (ref-counted singleton) ──────────────
// One conversations channel for the whole app, regardless of how many hook
// instances mount (badge + pane). Each instance registers a change callback; the
// last unmount tears the channel down.
let _channelUnsub = null;
let _refCount = 0;
const _onChange = new Set();

function acquireConversationsChannel(onChange) {
  _onChange.add(onChange);
  _refCount += 1;
  if (!_channelUnsub) {
    _channelUnsub = subscribeToConversations((payload) => {
      _onChange.forEach((cb) => { try { cb(payload); } catch { /* isolate */ } });
    });
  }
  return () => {
    _onChange.delete(onChange);
    _refCount -= 1;
    if (_refCount <= 0 && _channelUnsub) {
      _channelUnsub();
      _channelUnsub = null;
      _refCount = 0;
    }
  };
}

// ─── SECTION: Helpers ──────────────
// Stable cache-key discriminator for a filtered/searched view. Default (no filter,
// no search) → null → techKeys.convos() (the unfiltered list the badge reads).
export function conversationsFilterKey({ status, search } = {}) {
  const s = status && status !== 'all' ? status : null;
  const q = search && search.trim() ? search.trim() : null;
  if (!s && !q) return null;
  return JSON.stringify({ s, q });
}

// ─── SECTION: Hook ──────────────
/**
 * @param {{ status?: string, search?: string }} [options]
 *   status: 'all' | 'unread' | 'needs_response' | 'waiting_on_client' | 'resolved'
 *   search: free text over title / preview / participant name+phone (server-side)
 */
export function useTechConversations(options = {}) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!db && !!employee?.id;
  const accountGeneration = captureTechQueryAccountGeneration();

  const status = options.status && options.status !== 'all' ? options.status : null;
  const search = options.search && options.search.trim() ? options.search.trim() : null;
  const filterKey = conversationsFilterKey({ status: options.status, search: options.search });
  const queryKey = useMemo(() => techKeys.convos(filterKey), [filterKey]);

  const query = useQuery({
    queryKey,
    enabled,
    refetchInterval: REFETCH_MS,
    queryFn: () => loadTechConversationInboxAccess({
      db,
      queryClient,
      queryKey,
      accountOwner: employee.id,
      accountGeneration,
      revalidateAllCachedAccess: filterKey === null,
      params: {
        p_limit: 50,
        p_search: search,
        p_status: status,
      },
    }),
  });

  const purgeExpiredInbox = useCallback(() => {
    if (techQueryAccountGenerationIsCurrent(accountGeneration)) {
      purgeExpiredConversationInboxAccess(queryClient, {
        accountOwner: employee?.id,
        accountGeneration,
      });
    }
  }, [accountGeneration, employee?.id, queryClient]);

  const refetchInbox = query.refetch;

  // A mounted inbox can otherwise sit idle forever with stale titles/previews. A
  // successful RPC moves actorAccessVerifiedAt and reschedules this boundary; a
  // failed/offline renewal or local cache patch cannot move it. The per-ID lease
  // registry removes only conversations whose own proof actually expired.
  useEffect(() => {
    const verifiedAt = query.data?.actorAccessVerifiedAt || 0;
    if (!verifiedAt) return undefined;
    return scheduleConversationAccessExpiry({
      verifiedAt,
      onExpire: () => {
        purgeExpiredInbox();
        // Re-prove straight away instead of waiting out the poll. Purging alone
        // left the inbox empty-and-expired for up to REFETCH_MS, and ConvoList
        // renders its "Couldn't load conversations" failure state for that whole
        // gap — a real outage message for a lease that simply aged out while the
        // tech was reading a thread. (2026-08-04)
        refetchInbox();
      },
    });
  }, [purgeExpiredInbox, query.data?.actorAccessVerifiedAt, refetchInbox]);

  const resumeInboxAccess = useCallback(() => (
    revalidateConversationAccessAfterResume({
      purgeExpired: purgeExpiredInbox,
      revalidate: query.refetch,
    })
  ), [purgeExpiredInbox, query.refetch]);

  // This remains enabled with no active thread: inbox titles and previews are
  // private data too. Resume purges expired rows synchronously, then starts the
  // actor-scoped network revalidation.
  useResumeRefetch({
    onResume: resumeInboxAccess,
    hiddenEdgeOnly: true,
    enabled,
  });

  // Shared realtime channel → refresh every convos view (+ the badge) on any change.
  useEffect(() => {
    if (!enabled) return undefined;
    const onChange = () => { invalidateTech(queryClient, 'message'); };
    return acquireConversationsChannel(onChange);
  }, [enabled, queryClient]);

  const hasFreshInboxAccessLease = hasFreshTechConversationInboxAccess(
    query.data,
    employee?.id,
  );
  const data = hasFreshInboxAccessLease ? (query.data || EMPTY) : EMPTY;
  // An expired lease means "re-prove", not "failed". While that revalidation is
  // in flight there is nothing to report yet, so report loading rather than a
  // failure with a Retry button for a probe that is already running. Fail-closed
  // is untouched: rows above still require a fresh lease, and a real query error
  // — or a probe that settles without access — still surfaces immediately.
  const reProvingAccess = !hasFreshInboxAccessLease && query.isFetching && !query.error;
  return {
    conversations: (data.conversations || []).map((conversation) => ({
      ...conversation,
      accessLeaseVerifiedAt: query.data?.actorAccessVerifiedAt,
    })),
    unreadTotal: data.unread_total || 0,
    statusCounts: data.status_counts || {},
    isColdStart: query.isPending || reProvingAccess, // no proven page yet → skeleton (never a spinner over content)
    isFetching: query.isFetching,
    error: reProvingAccess ? null : techConversationInboxAccessError(query.data, query.error),
    refresh: query.refetch,
  };
}

export default useTechConversations;
