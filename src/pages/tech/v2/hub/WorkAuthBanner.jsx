/**
 * ════════════════════════════════════════════════
 * FILE: WorkAuthBanner.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The red "No signed Work Authorization" strip that warns a tech the customer
 *   hasn't signed the work authorization yet. Tapping it jumps to the job's
 *   Documents hub with the Work Auth signature request already open. This is the
 *   ONE place the hub decides to show that warning — both legacy pages had their
 *   own copy; the merge keeps a single one, driven by showWorkAuthBanner().
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom
 *   Internal:  ./hubHelpers (showWorkAuthBanner), index.css (.tv2-hub-wa-banner)
 *   Data:      none (the hub payload arrives as a prop)
 *
 * NOTES / GOTCHAS:
 *   - Renders nothing unless showWorkAuthBanner(hub) is true, so it never flashes
 *     before the job loads (parity with the legacy "assume signed until checked").
 *   - Colors come from the shared --status-paused-* tokens (the danger trio),
 *     not hardcoded hex, so dark mode is handled.
 * ════════════════════════════════════════════════
 */
import { useNavigate } from 'react-router-dom';
import { showWorkAuthBanner } from './hubHelpers.js';

export default function WorkAuthBanner({ hub, jobId }) {
  const navigate = useNavigate();
  if (!showWorkAuthBanner(hub)) return null;

  return (
    <button
      type="button"
      className="tv2-hub-wa-banner"
      onClick={() => navigate(`/tech/jobs/${jobId}/documents`, { state: { startEsign: 'work_auth' } })}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="tv2-hub-wa-banner__body">
        <span className="tv2-hub-wa-banner__title">No signed Work Authorization</span>
        <span className="tv2-hub-wa-banner__sub">Tap to collect the customer&apos;s signature</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}
