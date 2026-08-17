/**
 * ════════════════════════════════════════════════
 * FILE: techQuery.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single, FROZEN registry of cache keys for the Tech Mobile v2 app, plus
 *   the rules for which caches to refresh after each kind of change. Every v2
 *   screen reads and writes the on-device cache through the keys defined here so
 *   that, for example, clocking in on the dashboard also refreshes the schedule.
 *   This file is the contract between the parallel v2 build sessions — they IMPORT
 *   it and must NOT add keys of their own.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (library module)
 *   Rendered by:  n/a — imported by v2 pages/components and src/main.jsx
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query
 *   Internal:  none
 *   Data:      none directly (keys/config only)
 *
 * NOTES / GOTCHAS:
 *   - FROZEN per docs/tech-v2-roadmap.md + .claude/rules/tech-v2-wave-ownership.md.
 *     Wave sessions (S, D, M1) import techKeys / invalidateTech and add NOTHING.
 *     ONE authorized amendment (Job Hub v2, Phase H1): the seventh kind `hub`
 *     (§7 of the ownership manifest) — every hub sub-resource caches under the
 *     ['tech','hub',jobId] prefix, and every mutation also invalidates it so a
 *     clock/task/photo/room/doc/appointment change repaints the open Job Hub.
 *     After H1 the registry is frozen again.
 *   - Tech Messages v2 amendment (Phase F-M, authorized by
 *     .claude/rules/tech-messages-v2-wave-ownership.md §3, precedent: H1's `hub`):
 *     the eighth + ninth kinds `convos` (the messaging inbox list — one key per
 *     filter, `convos()` = the default unfiltered list the badge reads) and
 *     `thread` (one conversation's messages, per conversationId), plus the
 *     `message` mutation → [convos, thread]. PRIVACY: makeTechQueryClient's
 *     `dehydrate.shouldDehydrateQuery` EXCLUDES messaging content. The participant
 *     controls/mobile-readiness slice adds `conversation-access` as an actor-owned,
 *     non-persisted authorization probe so a removal cannot leave a readable thread.
 *   - Job Hub wave 2 amendment (H2-d, the field customer screen, authorized by
 *     docs/handoff/job-hub-wave2-and-customer-page-plan-2026-08-15.md): the
 *     eleventh kind `customer` (per contactId) plus the `contact` mutation →
 *     [customer, hub]. Same precedent as `hub` and `convos`: a new SURFACE with
 *     its own scope key, not a new key for an existing one.
 *   - Every key starts with the 'tech' root so invalidateTech can target a whole
 *     kind by its two-element prefix (['tech', kind]) regardless of the id suffix.
 *   - gcTime is 24h to match the persister's default maxAge — shorter gc would
 *     evict entries before they could be restored from disk on a cold open.
 * ════════════════════════════════════════════════
 */
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';

const ROOT = 'tech';

// The eleven cache kinds. Frozen — `hub` (7th) was the Phase H1 amendment;
// `convos` + `thread` (8th/9th) were the Phase F-M amendment;
// `conversation-access` is the participant-control/mobile-readiness
// authorization-probe amendment; `customer` (11th) is the Job Hub wave 2 H2-d
// amendment for the field customer screen, whose reads and writes are contact-
// scoped and therefore cannot live under a job-keyed prefix.
export const TECH_QUERY_KINDS = Object.freeze({
  DASH: 'dash',                 // get_tech_dashboard(employeeId)
  SCHED_MONTH: 'sched-month',   // get_appointments_range for one month window
  ACTIVE_CLOCK: 'active-clock', // the open time entry / clock state
  TASKS: 'tasks',               // get_assigned_tasks(employeeId)
  ROOMS: 'rooms',               // moisture/room data for a job
  DOCS: 'docs',                 // job_documents for an appointment or job
  HUB: 'hub',                   // Job Hub v2 frame + its sub-resources (per jobId)
  CONVOS: 'convos',             // messaging inbox list (get_tech_conversations); per filter
  THREAD: 'thread',             // one conversation's messages (per conversationId)
  CONVERSATION_ACCESS: 'conversation-access', // current membership probe; never persisted
  CUSTOMER: 'customer',         // one contact's field detail screen (per contactId)
});

/**
 * Query-key factory. Each returns a stable array key rooted at 'tech'.
 * @example useQuery({ queryKey: techKeys.dash(employee.id), queryFn: ... })
 */
export const techKeys = Object.freeze({
  dash: (employeeId) => [ROOT, TECH_QUERY_KINDS.DASH, employeeId],
  schedMonth: (monthKey) => [ROOT, TECH_QUERY_KINDS.SCHED_MONTH, monthKey], // monthKey = 'YYYY-MM'
  activeClock: (employeeId) => [ROOT, TECH_QUERY_KINDS.ACTIVE_CLOCK, employeeId],
  tasks: (employeeId) => [ROOT, TECH_QUERY_KINDS.TASKS, employeeId],
  rooms: (jobId) => [ROOT, TECH_QUERY_KINDS.ROOMS, jobId],
  docs: (scopeId) => [ROOT, TECH_QUERY_KINDS.DOCS, scopeId], // scopeId = appointment id or job id
  hub: (jobId) => [ROOT, TECH_QUERY_KINDS.HUB, jobId], // Job Hub frame; sub-resources append to this key
  // Messaging inbox list. `filterKey` discriminates a filtered/searched view
  // (e.g. 'unread' or a serialized {status,search}); the default `convos()` =
  // ['tech','convos',null] is the unfiltered list the Messages-tab badge reads.
  // All share the ['tech','convos'] prefix, so one invalidate refreshes every view.
  convos: (filterKey = null) => [ROOT, TECH_QUERY_KINDS.CONVOS, filterKey],
  thread: (convId) => [ROOT, TECH_QUERY_KINDS.THREAD, convId], // one conversation's messages
  conversationAccess: (employeeId, convId) => [
    ROOT,
    TECH_QUERY_KINDS.CONVERSATION_ACCESS,
    employeeId,
    convId,
  ],
  customer: (contactId) => [ROOT, TECH_QUERY_KINDS.CUSTOMER, contactId], // field customer screen
});

const K = TECH_QUERY_KINDS;

/**
 * Mutation → cache kinds to invalidate. This is the whole invalidation surface of
 * the tech app; wave sessions look up their mutation here instead of hand-listing
 * keys at each call site (which is how staleness bugs creep in).
 *
 * - clock:        On My Way / Start / Pause / Resume / Finish. Changes appointment
 *                 status (schedule + dash) and accrued hours + open entry (dash,
 *                 active-clock).
 * - task:         toggle_appointment_task — changes done/total counts (dash,
 *                 tasks, and the schedule row's task badge).
 * - photo:        a captured photo — bumps photos-today (dash) and the docs list.
 * - doc:          any other document/e-sign change — docs list only.
 * - room:         moisture/room reading or equipment change — rooms only.
 * - appointment:  create / edit / delete an appointment — schedule window + dash.
 *
 * Every mutation ALSO invalidates `hub` (Phase H1): the Job Hub frames a job's
 * whole surface (visits, clock, tasks, photos, hydro), so any of these changes
 * must repaint an open hub. It is a no-op when no hub query is cached.
 *
 * - message:      a sent/received/status-changed message (Phase F-M) — refreshes
 *                 the inbox list (last-message preview + unread badge) and the open
 *                 thread. It does NOT touch hub (messaging is not a job surface).
 * - contact:      a contact edit, an insurance edit, or an added/removed job
 *                 link from the field customer screen (Job Hub wave 2, H2-d).
 *                 It invalidates `hub` as well as `customer` because the Hub's
 *                 contacts list AND its hero title both come out of get_job_hub —
 *                 renaming a customer on the customer page must repaint the Hub
 *                 behind it, not leave the old name on the header.
 */
export const MUTATION_INVALIDATIONS = Object.freeze({
  clock: [K.DASH, K.ACTIVE_CLOCK, K.SCHED_MONTH, K.HUB],
  task: [K.DASH, K.TASKS, K.SCHED_MONTH, K.HUB],
  photo: [K.DASH, K.DOCS, K.HUB],
  doc: [K.DOCS, K.HUB],
  room: [K.ROOMS, K.HUB],
  appointment: [K.SCHED_MONTH, K.DASH, K.HUB],
  message: [K.CONVOS, K.THREAD],
  contact: [K.CUSTOMER, K.HUB],
});

/**
 * Invalidate every cache affected by a mutation. Targets each kind by its
 * ['tech', kind] prefix so all ids of that kind refresh (e.g. every month window).
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {keyof typeof MUTATION_INVALIDATIONS} mutation
 * @returns {Promise<void>}
 */
export function invalidateTech(queryClient, mutation) {
  const kinds = MUTATION_INVALIDATIONS[mutation];
  if (!kinds) throw new Error(`Unknown tech mutation "${mutation}" — add it to MUTATION_INVALIDATIONS in src/lib/techQuery.js`);
  return Promise.all(
    kinds.map((kind) => queryClient.invalidateQueries({ queryKey: [ROOT, kind] })),
  );
}

/**
 * The app's shared QueryClient. staleTime keeps a freshly-loaded screen from
 * re-fetching on every mount; gcTime holds entries long enough for the persister
 * to restore them on a cold open.
 */
export function makeTechQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,          // 30s — instant re-mounts within a session
        gcTime: 24 * 60 * 60 * 1000, // 24h — matches the persister maxAge
        retry: 1,
        refetchOnWindowFocus: true,  // silent revalidate when the app regains focus
        refetchOnReconnect: true,
      },
      // Persister dehydrate filter (Phase F-M). PersistQueryClientProvider passes no
      // dehydrateOptions, so dehydrate() falls back to THIS client default — which is
      // why the messaging-privacy filter can live here (techQuery.js) instead of
      // editing main.jsx / techQueryPersister.js. Raw SMS bodies, inbox previews,
      // access probes, member directories, and author lookups must NEVER touch disk.
      dehydrate: {
        shouldDehydrateQuery: (query) => {
          const root = query.queryKey?.[0];
          const kind = query.queryKey?.[1];
          const messagingPrivate = (
            root === 'conversation-members'
            || root === 'message-author-directory'
            || (
              root === ROOT
              && [
                TECH_QUERY_KINDS.CONVOS,
                TECH_QUERY_KINDS.THREAD,
                TECH_QUERY_KINDS.CONVERSATION_ACCESS,
              ].includes(kind)
            )
          );
          return !messagingPrivate && defaultShouldDehydrateQuery(query);
        },
      },
    },
  });
}

// Singleton for the provider in main.jsx. Kept module-level so the same client is
// shared across the whole tech tree (and the persister that wraps it).
export const techQueryClient = makeTechQueryClient();

let techQueryAccountGeneration = 0;
const techQueryAccountGenerationListeners = new Set();

export function captureTechQueryAccountGeneration() {
  return techQueryAccountGeneration;
}

export function techQueryAccountGenerationIsCurrent(generation) {
  return generation === techQueryAccountGeneration;
}

export function registerTechQueryAccountGenerationListener(listener) {
  techQueryAccountGenerationListeners.add(listener);
  return () => techQueryAccountGenerationListeners.delete(listener);
}

/**
 * Drop all in-memory tech queries during an account transition.
 *
 * Persisted state is cleared separately by `clearPersistedTechQueries`; keeping
 * both operations explicit lets the account lifecycle await durable cleanup and
 * prevents already-hydrated rows from surviving in memory.
 */
export function clearTechQueryMemory() {
  // Invalidate every in-flight callback before clearing. An A-account promise
  // that resolves after B starts must not write into or purge B's same-key cache.
  techQueryAccountGeneration += 1;
  techQueryAccountGenerationListeners.forEach((listener) => {
    try {
      listener(techQueryAccountGeneration);
    } catch {
      // Account cleanup must continue even if an optional cache listener fails.
    }
  });
  techQueryClient.clear();
}
