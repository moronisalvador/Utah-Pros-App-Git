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
 *   - Every key starts with the 'tech' root so invalidateTech can target a whole
 *     kind by its two-element prefix (['tech', kind]) regardless of the id suffix.
 *   - gcTime is 24h to match the persister's default maxAge — shorter gc would
 *     evict entries before they could be restored from disk on a cold open.
 * ════════════════════════════════════════════════
 */
import { QueryClient } from '@tanstack/react-query';

const ROOT = 'tech';

// The seven cache kinds. Frozen — the seventh (`hub`) was the single authorized
// Phase H1 amendment; adding an eighth is an F-owner change, never a wave edit.
export const TECH_QUERY_KINDS = Object.freeze({
  DASH: 'dash',                 // get_tech_dashboard(employeeId)
  SCHED_MONTH: 'sched-month',   // get_appointments_range for one month window
  ACTIVE_CLOCK: 'active-clock', // the open time entry / clock state
  TASKS: 'tasks',               // get_assigned_tasks(employeeId)
  ROOMS: 'rooms',               // moisture/room data for a job
  DOCS: 'docs',                 // job_documents for an appointment or job
  HUB: 'hub',                   // Job Hub v2 frame + its sub-resources (per jobId)
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
 */
export const MUTATION_INVALIDATIONS = Object.freeze({
  clock: [K.DASH, K.ACTIVE_CLOCK, K.SCHED_MONTH, K.HUB],
  task: [K.DASH, K.TASKS, K.SCHED_MONTH, K.HUB],
  photo: [K.DASH, K.DOCS, K.HUB],
  doc: [K.DOCS, K.HUB],
  room: [K.ROOMS, K.HUB],
  appointment: [K.SCHED_MONTH, K.DASH, K.HUB],
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
    },
  });
}

// Singleton for the provider in main.jsx. Kept module-level so the same client is
// shared across the whole tech tree (and the persister that wraps it).
export const techQueryClient = makeTechQueryClient();
