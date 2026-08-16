/**
 * ════════════════════════════════════════════════
 * FILE: LegacyAppointmentRedirect.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends anyone who lands on the old appointment screen to the new Job Hub
 *   instead — but only if the Job Hub is turned on for them. Everyone else still
 *   gets the old screen exactly as before.
 *
 *   This is the twin of LegacyJobRedirect, and it matters more: push
 *   notifications stored the old appointment address for months, so a technician
 *   tapping a notification from weeks ago lands on a page that looks nothing like
 *   the one they have been using. Controls inside the Hub itself also still point
 *   here.
 *
 *   The one real difference from the job guard: the address only names an
 *   appointment, and the Hub is organised by job — so this has to ask the
 *   database which job the appointment belongs to before it can forward anyone.
 *   That takes a moment, so a flag holder briefly sees a loading skeleton rather
 *   than a flash of the old screen.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/appointment/:id  (wraps the legacy TechAppointment)
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom, @tanstack/react-query
 *   Internal:  ./nav.js (isHubNav — the SAME per-viewer switch apptHref reads),
 *              ./legacyApptResolve.js, ./skeletons.jsx, @/contexts/AuthContext,
 *              @/lib/techQuery
 *   Data:      reads → get_appointment_detail (job_id only; the legacy page's own
 *              loader, so the visibility is byte-identical)
 *
 * NOTES / GOTCHAS:
 *   - It reads `isHubNav()`, the exact switch `apptHref()` uses, so a link and a
 *     redirect can never disagree about where an appointment opens.
 *   - NO FETCH FIRES for a viewer without the flag — the query is `enabled` on it.
 *   - The RPC result is seeded into the Hub's own visit cache under the identical
 *     key TechJobHub uses, so the redirect costs zero extra round trips.
 *   - A job-less appointment (a personal block), a private appointment this
 *     viewer may not see (the RPC returns NULL), or a lookup that threw all fall
 *     through to the legacy page. A failed lookup must never become a dead end.
 *   - `replace` so Back doesn't bounce the tech between the two pages; query
 *     string and location state are carried across.
 *   - Wraps /tech/appointment/:id ONLY. The /edit child is a real destination the
 *     Hub itself links into (HubChecklist, HubStage) and must not be redirected.
 * ════════════════════════════════════════════════
 */
import { Navigate, useParams, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { techKeys } from '@/lib/techQuery';
import { isHubNav } from './nav.js';
import { resolveApptRedirect, buildHubApptUrl } from './legacyApptResolve.js';
import { SkeletonList } from './skeletons.jsx';

/**
 * @param {{ children: React.ReactNode }} props - the legacy appointment screen
 */
export default function LegacyAppointmentRedirect({ children }) {
  const { id } = useParams();
  const location = useLocation();
  const { db } = useAuth();
  const queryClient = useQueryClient();
  const hubNav = isHubNav();

  // Resolve which job this appointment belongs to. `enabled` keeps this inert
  // for every viewer without the Hub — they never pay for a lookup they cannot
  // use. The key is the Hub's OWN visit key, so arriving at the Hub finds the
  // detail already cached instead of refetching it.
  const detailQuery = useQuery({
    queryKey: ['tech', 'legacy-appt-resolve', id],
    queryFn: async () => {
      const detail = await db.rpc('get_appointment_detail', { p_appointment_id: id });
      const jobId = detail?.job_id;
      if (jobId) {
        queryClient.setQueryData([...techKeys.hub(jobId), 'visit', id], detail);
      }
      return detail ?? null;
    },
    enabled: !!(hubNav && id),
    retry: false,
  });

  if (!hubNav || !id) return children;

  // Resolving — a skeleton, not the legacy page. Rendering the old screen here
  // and swapping a beat later is a visible flash of the exact page we exist to
  // redirect away from.
  if (detailQuery.isPending) return <SkeletonList rows={6} />;

  const { redirect, jobId } = resolveApptRedirect(detailQuery.data);
  if (!redirect) return children;

  return (
    <Navigate
      to={buildHubApptUrl(jobId, id, location.search)}
      state={location.state}
      replace
    />
  );
}
