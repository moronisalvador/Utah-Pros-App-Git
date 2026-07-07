/**
 * ════════════════════════════════════════════════
 * FILE: useDashWidget.js  (admin-mobile Dashboard — per-card data loader)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little engine every dashboard card uses to load its own numbers. You hand
 *   it a function that fetches + shapes one card's data; it runs that when the card
 *   appears (and again when the time period changes or the owner taps "Retry"), and
 *   hands back a tidy { data, loading, error, reload }. Because each card loads its
 *   own data only once it is on screen, a card that is hidden — like the money cards
 *   for a non-privileged admin — never fetches anything at all (finding F-2).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a shared hook)
 *   Rendered by:  every admin-mobile dashboard card component
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads → whatever the caller's loader reads · writes → none
 *
 * NOTES / GOTCHAS:
 *   - `load` MUST be memoised by the caller (useCallback) — its identity is the
 *     effect dependency, so an unmemoised function would refetch every render.
 *   - The loader is passed the live `db` and should RETURN shaped data or THROW;
 *     this hook owns the loading/error state (mirrors the desktop usePolledRpc /
 *     the P2 tab loaders). No polling — a mount + period-change fetch is enough on
 *     mobile; "Retry" re-runs on demand.
 *   - dbRef keeps the loader stable across auth token-refresh re-renders (the same
 *     idiom the collections tabs use to avoid a loading blink).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export function useDashWidget(loader) {
  const { db } = useAuth();
  // Keep the loader stable across auth token-refresh re-renders: the ref is seeded
  // with the current db and re-synced in an effect (never written during render).
  const dbRef = useRef(db);
  useEffect(() => { dbRef.current = db; }, [db]);

  const [state, setState] = useState({ data: null, loading: true, error: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Fetch on mount, whenever the loader changes (e.g. the period switched), and on
  // an explicit reload(). The work lives inside an async IIFE (never a synchronous
  // setState in the effect body) and an `alive` flag drops a stale response — the
  // same idiom the collections tabs use, so a period switch never flashes the wrong
  // period's numbers.
  useEffect(() => {
    let alive = true;
    (async () => {
      setState((s) => (s.loading && s.data == null ? s : { ...s, loading: true, error: false }));
      try {
        const data = await loader(dbRef.current);
        if (alive) setState({ data, loading: false, error: false });
      } catch (e) {
        console.error('admin-mobile dashboard widget load failed:', e);
        if (alive) setState({ data: null, loading: false, error: true });
      }
    })();
    return () => { alive = false; };
  }, [loader, tick]);

  return { ...state, reload };
}
