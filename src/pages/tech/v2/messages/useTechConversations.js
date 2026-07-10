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
 *   - devLogin caveat (on record): after the pending sms F-red anon closure, realtime
 *     tested via devLogin will falsely appear broken — the socket needs the real
 *     authenticated JWT. Verify with a real login. REST polling still works either way.
 * ════════════════════════════════════════════════
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToConversations } from '@/lib/realtime';
import { techKeys, invalidateTech } from '@/lib/techQuery';

const REFETCH_MS = 60_000; // 60s silent revalidate — the TechLayout taskCount precedent.
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

  const status = options.status && options.status !== 'all' ? options.status : null;
  const search = options.search && options.search.trim() ? options.search.trim() : null;
  const filterKey = conversationsFilterKey({ status: options.status, search: options.search });

  const query = useQuery({
    queryKey: techKeys.convos(filterKey),
    enabled,
    refetchInterval: REFETCH_MS,
    queryFn: async () => {
      const res = await db.rpc('get_tech_conversations', {
        p_limit: 50,
        p_search: search,
        p_status: status,
      });
      return res || EMPTY;
    },
  });

  // Shared realtime channel → refresh every convos view (+ the badge) on any change.
  useEffect(() => {
    if (!enabled) return undefined;
    const onChange = () => { invalidateTech(queryClient, 'message'); };
    return acquireConversationsChannel(onChange);
  }, [enabled, queryClient]);

  const data = query.data || EMPTY;
  return {
    conversations: data.conversations || [],
    unreadTotal: data.unread_total || 0,
    statusCounts: data.status_counts || {},
    isColdStart: query.isPending, // no cached page yet → skeleton (never a spinner over content)
    isFetching: query.isFetching,
    error: query.error,
    refresh: query.refetch,
  };
}

export default useTechConversations;
