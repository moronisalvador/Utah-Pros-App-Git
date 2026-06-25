/**
 * ════════════════════════════════════════════════
 * FILE: usePolledRpc.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared engine behind every Overview dashboard data widget. You hand it a
 *   function that fetches + shapes one widget's data; it runs that on load, re-runs
 *   it on a timer to stay fresh, pauses while the browser tab is hidden (and
 *   refetches the moment you come back), and hands back a tidy
 *   { data, loading, error, reload }. It's careful never to show a stale answer:
 *   if you switch the time period mid-request, the older request's result is thrown
 *   away instead of flashing the wrong number.
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
 *     loading/error state.
 *   - Stale-response safety: each effect run owns a local `cancelled` flag, so a
 *     slow response from a PREVIOUS run (e.g. the prior period after a period
 *     switch) can't overwrite the current one — the app's standard idiom (see
 *     Conversations.jsx, DocChecklist.jsx).
 *   - Polls are silent (they don't flip `loading`), so a 30–120s refresh never
 *     flickers a skeleton. Only the first load and a manual reload() show one.
 *   - Visibility-aware (like syncRunner.js / TechDash.jsx): the poll no-ops while
 *     `document.hidden`, and a `visibilitychange → visible` triggers an immediate
 *     refetch. Saves needless RPC calls on a backgrounded tab.
 *   - `reload()` (error-state "Retry") shows the skeleton immediately, then bumps a
 *     tick that re-runs the effect with a fresh cancellation flag.
 *   - `enabled = false` skips all fetching/polling (used so non-privileged roles
 *     never even fetch the financial widgets' data).
 *   - The load + setInterval + cleanup shape is intentional (satisfies the
 *     react-hooks effect rules — it's a subscription, not a one-shot setState).
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';

export function usePolledRpc(load, intervalMs = 60000, enabled = true) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const [reloadTick, setReloadTick] = useState(0);

  // Manual retry (the error card's "Retry"): show the skeleton + clear the error
  // right away, then bump the tick to re-run the effect with a fresh cancel flag.
  const reload = useCallback(() => {
    setState(s => ({ ...s, loading: true, error: null }));
    setReloadTick(t => t + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const run = async () => {
      if (typeof document !== 'undefined' && document.hidden) return; // skip polls while backgrounded
      try {
        const data = await load();
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (e) {
        if (!cancelled) {
          console.error('usePolledRpc load failed:', e);
          setState(s => ({ ...s, loading: false, error: e }));
        }
      }
    };
    run();
    const t = setInterval(run, intervalMs);
    // Refetch the instant the tab returns to the foreground so the owner never
    // stares at data that went stale while the dashboard was hidden.
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) run(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(t);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, intervalMs, enabled, reloadTick]);

  return { ...state, reload };
}
