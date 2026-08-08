/**
 * ════════════════════════════════════════════════
 * FILE: LegacyJobRedirect.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sends anyone who lands on the old job screen to the new Job Hub instead —
 *   but only if the Job Hub is turned on for them. Everyone else still gets the
 *   old screen exactly as before.
 *
 *   It exists because the old screen can still be reached in ways nobody
 *   controls: a link inside an older copy of the app, a saved URL, a push
 *   notification sent before the Hub shipped, or the browser's Back button.
 *   Without this, one of those puts a technician on a page that looks nothing
 *   like the one they were just using.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/jobs/:jobId  (wraps the legacy TechJobDetail)
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom
 *   Internal:  ./nav.js (isHubNav — the SAME per-viewer switch jobHref reads)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - It reads `isHubNav()`, the exact switch `jobHref()` uses, so a link and a
 *     redirect can never disagree about where a job opens.
 *   - `replace` so Back doesn't bounce the tech between the two pages.
 *   - Query string and location state are carried across; a notification that
 *     deep-links with state must not lose it on the way through.
 *   - This is a per-viewer redirect, NOT a route deletion. The legacy page is
 *     still the real destination for every tech without the flag, and stays
 *     until M2 retires it (see nav.js).
 * ════════════════════════════════════════════════
 */
import { Navigate, useParams, useLocation } from 'react-router-dom';
import { isHubNav } from './nav.js';

/**
 * @param {{ children: React.ReactNode }} props - the legacy job screen
 */
export default function LegacyJobRedirect({ children }) {
  const { jobId } = useParams();
  const location = useLocation();

  if (isHubNav() && jobId) {
    return (
      <Navigate
        to={`/tech/job/${jobId}${location.search || ''}`}
        state={location.state}
        replace
      />
    );
  }
  return children;
}
