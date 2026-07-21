/**
 * ════════════════════════════════════════════════
 * FILE: useLookup.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared, cached way to load the small reference lists the app needs
 *   everywhere — the employee roster, the job-phase list, the insurance carriers.
 *   Before this, the employee roster was fetched independently at 14 different
 *   places. This loads each list once, caches it, shares it across every screen,
 *   and quietly refreshes it in the background — so opening five pages doesn't
 *   fire five identical queries.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared hook)
 *   Rendered by:  any page needing a roster (import { useLookup } from '@/hooks/useLookup')
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query (the app-wide QueryClient from main.jsx)
 *   Internal:  @/contexts/AuthContext (the authenticated db client)
 *   Data:      reads → employees, job_phases, insurance_carriers
 *
 * NOTES / GOTCHAS:
 *   - Usage: const { data: employees = [], isLoading, error } = useLookup('employees');
 *     Returns the raw react-query result — default the array so a first render is safe.
 *   - Query keys are ['lookup', kind] and are STABLE and shared, so react-query dedups
 *     across every consumer (perf-budget.md §3). staleTime 5 min (rosters change rarely).
 *   - The queries are the canonical column-named selects the pages already used (never
 *     select=*). Add a new roster kind here (one registry entry), not a per-page fetch.
 *   - The db client identity is stable (stableDb), so it is NOT in the queryKey — the
 *     key stays cacheable across auth-token refreshes.
 * ════════════════════════════════════════════════
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

// The canonical fetch for each shared roster (column-named — never select=*).
export const LOOKUPS = {
  employees: {
    table: 'employees',
    query: 'is_active=eq.true&order=full_name.asc&select=id,full_name,display_name,role,color',
  },
  job_phases: {
    table: 'job_phases',
    query: 'is_active=eq.true&order=display_order.asc',
  },
  carriers: {
    table: 'insurance_carriers',
    query: 'order=name.asc&select=id,name,short_name',
  },
};

export function useLookup(kind, options = {}) {
  const { db } = useAuth();
  const spec = LOOKUPS[kind];
  if (!spec) throw new Error(`useLookup: unknown lookup "${kind}" (known: ${Object.keys(LOOKUPS).join(', ')})`);

  return useQuery({
    queryKey: ['lookup', kind],
    queryFn: async () => {
      const rows = await db.select(spec.table, spec.query);
      return rows || [];
    },
    staleTime: 5 * 60 * 1000,   // rosters change rarely — 5 min fresh
    gcTime: 30 * 60 * 1000,
    ...options,
  });
}

export default useLookup;
