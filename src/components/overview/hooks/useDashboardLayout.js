/**
 * ════════════════════════════════════════════════
 * FILE: useDashboardLayout.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Remembers how each user has arranged their Overview dashboard. On load it
 *   reads their saved card layout from the database (falling back to a
 *   localStorage copy for an instant render, then the default layout). When they
 *   drag or resize a card it saves the new layout back — both to localStorage
 *   (instant) and the database (per user, survives device changes).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (data hook)
 *   Rendered by:  src/pages/Dashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads → RPC get_dashboard_layout · writes → RPC save_dashboard_layout
 *              (both scoped to the logged-in user via auth.uid())
 *
 * NOTES / GOTCHAS:
 *   - `layouts` is the react-grid-layout responsive layouts object ({ lg, xs }).
 *   - localStorage key `upr:dash-layout` is the instant-apply mirror; the DB row
 *     is the source of truth. Reset clears both back to the default.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const LS_KEY = 'upr:dash-layout';

export function useDashboardLayout(defaultLayouts) {
  const { db } = useAuth();
  const [layouts, setLayouts] = useState(() => {
    try { const m = localStorage.getItem(LS_KEY); if (m) return JSON.parse(m); } catch { /* ignore */ }
    return defaultLayouts;
  });

  // One-time load of the server copy (overrides the local mirror if present).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await db.rpc('get_dashboard_layout');
        if (alive && saved && Array.isArray(saved.lg)) {
          setLayouts(saved);
          try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
        }
      } catch { /* keep local / default */ }
    })();
    return () => { alive = false; };
  }, [db]);

  const persist = useCallback((next) => {
    setLayouts(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    db.rpc('save_dashboard_layout', { p_layout: next }).catch(() => {});
  }, [db]);

  const reset = useCallback(() => {
    setLayouts(defaultLayouts);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    db.rpc('save_dashboard_layout', { p_layout: defaultLayouts }).catch(() => {});
  }, [db, defaultLayouts]);

  return { layouts, persist, reset };
}
