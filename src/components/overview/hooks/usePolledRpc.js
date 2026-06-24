/**
 * ════════════════════════════════════════════════
 * FILE: usePolledRpc.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared engine behind every Overview dashboard data widget. You hand it a
 *   function that fetches + shapes one widget's data; it runs that on load, re-runs
 *   it on a timer to stay fresh, and hands back a tidy { data, loading, error }.
 *   It also refuses to update a card that's already gone from the screen, so a
 *   slow response can't crash a closed view.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared hook)
 *   Rendered by:  every src/components/overview/hooks/useXxx.js
 *
 * DEPENDS ON:
 *   Packages:  react · Internal: none · Data: none (the caller's loader does I/O)
 *
 * NOTES / GOTCHAS:
 *   - `load` MUST be memoized by the caller (useCallback) — its identity is the
 *     effect dependency, so an unmemoized function would re-poll every render.
 *   - load() should RETURN the shaped data or THROW; this hook owns the
 *     loading/error state. The mounted ref prevents setState-after-unmount.
 *   - The load + setInterval + cleanup shape is intentional (satisfies the
 *     react-hooks effect rules — it's a subscription, not a one-shot setState).
 *   - `reload()` forces an immediate refetch (used by the card's error-state
 *     "Retry" button) without waiting for the next poll tick.
 *   - `enabled = false` skips all fetching/polling entirely (loading stays false,
 *     data null). Used to avoid fetching sensitive data the viewer can't see.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolledRpc(load, intervalMs = 60000, enabled = true) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const mounted = useRef(false);

  const run = useCallback(async () => {
    try {
      const data = await load();
      if (mounted.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (mounted.current) setState(s => ({ ...s, loading: false, error: e }));
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;
    mounted.current = true;
    run();
    const t = setInterval(run, intervalMs);
    return () => { mounted.current = false; clearInterval(t); };
  }, [run, intervalMs, enabled]);

  const reload = useCallback(() => {
    if (!enabled) return;
    setState(s => ({ ...s, loading: true, error: null }));
    run();
  }, [run, enabled]);

  return { ...state, reload };
}
