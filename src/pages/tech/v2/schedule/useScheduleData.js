/**
 * ════════════════════════════════════════════════
 * FILE: useScheduleData.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads the appointments the schedule needs and keeps them cached so the
 *   calendar feels instant. It loads one calendar month at a time (plus the month
 *   before and after, so scrolling never hits a blank edge) and remembers every
 *   month you've already visited, so moving around the calendar never re-downloads
 *   or flickers. It also hands back a "pull to refresh" function that quietly
 *   re-checks the server without blanking the screen.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  n/a — used by TechScheduleV2
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext (db), @/lib/techQuery (techKeys, invalidateTech),
 *              ./scheduleSelectors (monthRange, monthKeyOf, monthKeysAround)
 *   Data:      reads → get_appointments_range (one call per loaded month)
 *
 * NOTES / GOTCHAS:
 *   - Loaded months only ever GROW (a Set that adds, never removes) so the agenda
 *     list never loses rows out from under the user's scroll position.
 *   - Cold-start = no cached data anywhere yet AND still fetching. Only then does
 *     the page show skeletons; once any month is cached the page shows content and
 *     revalidates silently (the "content is never replaced by a spinner" rule).
 *   - Cache keys come from the FROZEN techKeys.schedMonth factory; refresh routes
 *     through invalidateTech('appointment') — we never hand-list keys.
 * ════════════════════════════════════════════════
 */
import { useCallback, useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { techKeys, invalidateTech } from '@/lib/techQuery';
import { monthRange, monthKeyOf, monthKeysAround } from './scheduleSelectors.js';

/**
 * @param {string} initialMonthKey - the 'YYYY-MM' to center on first (usually today's).
 */
export function useScheduleData(initialMonthKey) {
  const { db } = useAuth();
  const queryClient = useQueryClient();

  const [focusMonth, setFocusMonthState] = useState(initialMonthKey);
  // Every month ever centered — grows, never shrinks (stable agenda scroll).
  const [loadedMonths, setLoadedMonths] = useState(() => monthKeysAround(initialMonthKey, 1));

  // Centering on a month loads it plus its neighbors (±1 prefetch). New months
  // are appended to the loaded set; already-loaded ones are untouched.
  const setFocusMonth = useCallback((monthKey) => {
    setFocusMonthState(monthKey);
    setLoadedMonths((prev) => {
      const next = new Set(prev);
      for (const k of monthKeysAround(monthKey, 1)) next.add(k);
      return next.size === prev.length ? prev : Array.from(next).sort();
    });
  }, []);

  // One query per loaded month. TanStack caches + persists each independently, so
  // revisiting a month is instant and survives a cold app open.
  const results = useQueries({
    queries: loadedMonths.map((monthKey) => {
      const { start, end } = monthRange(monthKey);
      return {
        queryKey: techKeys.schedMonth(monthKey),
        queryFn: async () => {
          const rows = await db.rpc('get_appointments_range', {
            p_start_date: start,
            p_end_date: end,
          });
          return rows || [];
        },
        enabled: !!db,
      };
    }),
  });

  // Merge + dedupe by id. Months are disjoint by date, but a boundary row could
  // in theory appear twice — the Map keeps it single.
  const dataVersion = results.map((r) => r.dataUpdatedAt).join(',');
  const appointments = useMemo(() => {
    const byId = new Map();
    for (const r of results) {
      if (!Array.isArray(r.data)) continue;
      for (const a of r.data) byId.set(a.id, a);
    }
    return Array.from(byId.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const hasAnyData = results.some((r) => Array.isArray(r.data));
  const isColdStart = !hasAnyData && results.some((r) => r.isLoading);
  const isFetching = results.some((r) => r.isFetching);

  // Pull-to-refresh + focus-revalidate entry point. Silent — never toggles the
  // cold-start skeleton (hasAnyData is already true by the time this runs).
  const refresh = useCallback(
    () => invalidateTech(queryClient, 'appointment'),
    [queryClient],
  );

  return {
    appointments,
    focusMonth,
    setFocusMonth,
    loadedMonths,
    isColdStart,
    isFetching,
    refresh,
  };
}

// Re-export for callers that only need the "which month is this date" helper.
export { monthKeyOf };
