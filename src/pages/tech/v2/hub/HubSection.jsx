/**
 * ════════════════════════════════════════════════
 * FILE: HubSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One collapsible row on the Job Hub — a title with a count on the left, a
 *   chevron on the right, and whatever that row holds underneath once it is
 *   open. Tapping the header opens or closes it instantly.
 *
 *   It replaces the old long stack of everything-at-once with a short list a
 *   technician can read at a glance and open only the part they need.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (the section list of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/hub/HubSections.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      none — it renders whatever children it is handed
 *
 * NOTES / GOTCHAS:
 *   - OPEN/CLOSE IS INSTANT, AND THAT IS CORRECT, not an omission. These are
 *     high-frequency controls (motion-standard.md §3: "deleting the animation is
 *     correct"), and animating height is banned outright by §5 because it is a
 *     layout property. The chevron rotation is the only motion, and it is
 *     tokenized with a reduced-motion fallback in job-hub.css.
 *   - Children are NOT rendered while closed, so a section with its own queries
 *     costs nothing until someone opens it. That is why the Rooms and Dry Logs
 *     rows can carry live data without slowing a cold start.
 *   - `openSignal` is a COUNTER, not a boolean, and it is read during render
 *     rather than in an effect — React's documented way to respond to a changed
 *     prop. An effect would open the row one paint late, so a scroll aimed at it
 *     would target the collapsed height and land short. Same idiom as
 *     JobClaimSection, which is where it was proven.
 *   - 48px header: a new primary control, so it gets the floor, not the 44px
 *     documented-secondary allowance (tech-mobile-ux.md).
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';

/**
 * @param {{
 *   title: string, count?: React.ReactNode, badge?: React.ReactNode,
 *   defaultOpen?: boolean, openSignal?: number,
 *   headerAction?: React.ReactNode, children: React.ReactNode,
 * }} props
 */
export default function HubSection({
  title, count, badge, defaultOpen = false, openSignal = 0, headerAction, children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  // A bumped signal opens the row — the More sheet's "Take a reading" and the
  // action bar's Notes both land on a section that may be collapsed, and a
  // collapsed landing is a dead one.
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal);
    if (openSignal) setOpen(true);
  }

  return (
    <section className="tv2-hub-section">
      <div className="tv2-hub-sect__head">
        <button
          type="button"
          className="tv2-hub-sect__toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="tv2-hub-section__title">
            {title}
            {count != null && count !== '' && <span className="tv2-hub-section__count">{count}</span>}
            {badge}
          </span>
          <svg
            className={`tv2-hub-collapse__chev${open ? ' is-open' : ''}`}
            width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {/* Outside the toggle button: a control nested inside a button is not a
            control, it is a second click target the browser will not honour. */}
        {headerAction}
      </div>

      {open && <div className="tv2-hub-collapse__body">{children}</div>}
    </section>
  );
}
