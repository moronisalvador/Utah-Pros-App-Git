/**
 * ════════════════════════════════════════════════
 * FILE: WhatsNew.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A running record of everything built, fixed and improved in the UPR
 *   platform, written for the people who use it rather than the people who
 *   build it. The top half is the short version — the notable changes, in
 *   plain English. The bottom half is the complete week-by-week list, taken
 *   straight from the project's own history so it is always accurate and
 *   nobody has to remember to update it.
 *
 * WHERE IT LIVES:
 *   Route:        /whats-new
 *   Rendered by:  src/App.jsx, inside the normal signed-in Layout shell
 *                 (registered in src/routes/buildTargetPages.web.jsx)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./WhatsNew.css,
 *              src/data/changelog/*.json        (hand-written highlights),
 *              src/data/changelog-activity.json (generated from git)
 *   Data:      reads  → none (no database, no network — everything is bundled)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - NO database call and NO fetch. Every byte here ships in the route
 *     chunk, so there is no loading gate, no error state and nothing to
 *     re-fetch on resume. That is deliberate, not an oversight:
 *     page-lifecycle.md's minimize test passes trivially because the page has
 *     no async lifecycle at all.
 *   - Styles are in a co-located WhatsNew.css rather than src/index.css.
 *     index.css sits ~1.9 KB under a CI-blocking 600,000-byte ceiling, and
 *     this page is lazy-loaded, so its CSS belongs in the route chunk.
 *     Same precedent as NotificationPresentation.css and oop-pricing.css.
 *   - "In testing" is DERIVED, not typed. An entry naming a commit is checked
 *     against what is actually on origin/main, so a change still behind the
 *     dev→main promotion hold cannot be advertised as available. The badge
 *     corrects itself on the next `npm run generate:changelog` after a
 *     promotion. An explicit `status` in the entry file is only the fallback
 *     for things git cannot see, such as a feature still behind a flag.
 *   - To add a highlight, drop one JSON file in src/data/changelog/.
 *     See the README in that folder. One file per entry, deliberately, so
 *     parallel sessions never collide on a shared list.
 * ════════════════════════════════════════════════
 */
import { useState, useMemo, useCallback } from 'react';
import activity from '@/data/changelog-activity.json';
import './WhatsNew.css';

// ─── Data loading ──────────────

/**
 * Every hand-written highlight, bundled at build time. Eager because the whole
 * page is already a lazy route — deferring individual entries would only add
 * request waterfalls to a page that currently makes zero.
 */
const HIGHLIGHTS = Object.values(
  import.meta.glob('../data/changelog/*.json', { eager: true, import: 'default' }),
).sort((a, b) => b.date.localeCompare(a.date));

/** sha → is it on origin/main. Absent when the generator could not resolve it. */
const LIVE_BY_SHA = new Map();
for (const week of activity.weeks) {
  for (const item of week.items) {
    if (typeof item.live === 'boolean') LIVE_BY_SHA.set(item.sha, item.live);
  }
}

/**
 * Prefer the mechanical answer over the typed one: if the entry names a commit
 * and we know whether that commit is in production, git wins. A hand-typed
 * status would otherwise go stale the moment a promotion lands.
 */
function statusOf(entry) {
  if (entry.sha && LIVE_BY_SHA.has(entry.sha)) {
    return LIVE_BY_SHA.get(entry.sha) ? 'live' : 'testing';
  }
  return entry.status || 'live';
}

const STATUS_LABEL = { testing: 'In testing', 'rolling-out': 'Rolling out' };

// ─── Helpers ──────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-07-31" → "Jul 31". Parsed by hand: `new Date('2026-07-31')` is UTC
 *  midnight, which renders as the 30th for anyone west of Greenwich. */
function shortDate(day) {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function longDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ─── Small presentational pieces ──────────────

function KindBadge({ kind }) {
  return <span className={`wn-kind wn-kind-${kind.toLowerCase()}`}>{kind}</span>;
}

function StatusBadge({ status }) {
  if (status === 'live') return null;
  return (
    <span className={`wn-status wn-status-${status}`}>
      <span className="wn-status-dot" aria-hidden="true" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function Chevron({ open }) {
  return (
    <svg
      className={`wn-chevron${open ? ' open' : ''}`}
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ─── Page ──────────────

export default function WhatsNew() {
  const [area, setArea] = useState('All');
  // The newest week starts open so the page has visible substance below the
  // highlights instead of a row of collapsed headers.
  const [openWeeks, setOpenWeeks] = useState(() =>
    new Set(activity.weeks.length ? [activity.weeks[0].start] : []),
  );

  const toggleWeek = useCallback(start => {
    setOpenWeeks(prev => {
      const next = new Set(prev);
      if (!next.delete(start)) next.add(start);
      return next;
    });
  }, []);

  /** Areas offered by the filter, most active first. */
  const areas = useMemo(() => {
    const counts = new Map();
    for (const h of HIGHLIGHTS) counts.set(h.area, (counts.get(h.area) || 0) + 1);
    for (const w of activity.weeks) {
      for (const i of w.items) counts.set(i.area, (counts.get(i.area) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const highlights = useMemo(
    () => (area === 'All' ? HIGHLIGHTS : HIGHLIGHTS.filter(h => h.area === area)),
    [area],
  );

  /** Highlights bucketed by day, newest first, for the timeline rail. */
  const highlightDays = useMemo(() => {
    const days = new Map();
    for (const h of highlights) {
      if (!days.has(h.date)) days.set(h.date, []);
      days.get(h.date).push(h);
    }
    return [...days.entries()];
  }, [highlights]);

  /** Activity weeks with the area filter applied; empty weeks drop out. */
  const weeks = useMemo(() => {
    if (area === 'All') return activity.weeks;
    return activity.weeks
      .map(w => ({ ...w, items: w.items.filter(i => i.area === area) }))
      .filter(w => w.items.length);
  }, [area]);

  const shownChanges = useMemo(
    () => weeks.reduce((sum, w) => sum + w.items.length, 0),
    [weeks],
  );

  const latest = activity.weeks[0]?.items[0]?.day;

  return (
    <div className="wn-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">What&rsquo;s New</h1>
          <p className="page-subtitle">
            Everything we&rsquo;ve built, fixed and improved — newest first.
            {latest && <> Last change {longDate(latest)}.</>}
          </p>
        </div>
      </div>

      {/* Headline numbers. These are counted from the data on this page, not
          typed in, so they cannot drift away from what is listed below. */}
      <div className="wn-stats">
        <div className="wn-stat">
          <span className="wn-stat-value">{activity.totals.changes}</span>
          <span className="wn-stat-label">changes since July</span>
        </div>
        <div className="wn-stat">
          <span className="wn-stat-value">{HIGHLIGHTS.length}</span>
          <span className="wn-stat-label">highlights</span>
        </div>
        <div className="wn-stat">
          <span className="wn-stat-value">{activity.totals.areas}</span>
          <span className="wn-stat-label">areas of the app</span>
        </div>
      </div>

      <div className="wn-filters" role="group" aria-label="Filter by area">
        <button
          type="button"
          className={`wn-filter${area === 'All' ? ' active' : ''}`}
          onClick={() => setArea('All')}
          aria-pressed={area === 'All'}
        >
          All
        </button>
        {areas.map(([name, count]) => (
          <button
            key={name}
            type="button"
            className={`wn-filter${area === name ? ' active' : ''}`}
            onClick={() => setArea(name)}
            aria-pressed={area === name}
          >
            {name}
            <span className="wn-filter-count">{count}</span>
          </button>
        ))}
      </div>

      {/* ── Highlights ── */}
      <section className="wn-section" aria-labelledby="wn-highlights-heading">
        <h2 className="wn-section-title" id="wn-highlights-heading">Highlights</h2>

        {highlightDays.length === 0 && (
          <div className="wn-empty">
            <p className="wn-empty-title">No highlights in {area} yet</p>
            <p className="wn-empty-text">
              The full list of changes for this area is below.
            </p>
          </div>
        )}

        <div className="wn-timeline">
          {highlightDays.map(([day, items]) => (
            <div className="wn-day" key={day}>
              <div className="wn-day-rail">
                <span className="wn-day-dot" aria-hidden="true" />
                <time className="wn-day-date" dateTime={day}>{shortDate(day)}</time>
              </div>
              <div className="wn-day-items">
                {items.map(h => {
                  const status = statusOf(h);
                  return (
                    <article className="wn-card" key={`${h.date}-${h.title}`}>
                      <div className="wn-card-meta">
                        <KindBadge kind={h.kind} />
                        <span className="wn-area">{h.area}</span>
                        <StatusBadge status={status} />
                      </div>
                      <h3 className="wn-card-title">{h.title}</h3>
                      {h.body && <p className="wn-card-body">{h.body}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Full activity, straight from the project history ── */}
      <section className="wn-section" aria-labelledby="wn-activity-heading">
        <h2 className="wn-section-title" id="wn-activity-heading">Everything else</h2>
        <p className="wn-section-note">
          Every other change, week by week — {plural(shownChanges, 'change')}
          {area !== 'All' && <> in {area}</>}. Taken directly from the project history.
        </p>

        <div className="wn-weeks">
          {weeks.map(week => {
            const open = openWeeks.has(week.start);
            const testing = week.items.filter(i => i.live === false).length;
            return (
              <div className={`wn-week${open ? ' open' : ''}`} key={week.start}>
                <button
                  type="button"
                  className="wn-week-head"
                  onClick={() => toggleWeek(week.start)}
                  aria-expanded={open}
                >
                  <Chevron open={open} />
                  <span className="wn-week-label">Week of {shortDate(week.start)}</span>
                  <span className="wn-week-count">{plural(week.items.length, 'change')}</span>
                  {testing > 0 && (
                    <span className="wn-week-testing">{testing} in testing</span>
                  )}
                </button>

                {open && (
                  <ul className="wn-week-items">
                    {week.items.map(item => (
                      <li className="wn-row" key={item.sha}>
                        <time className="wn-row-date" dateTime={item.day}>
                          {shortDate(item.day)}
                        </time>
                        <KindBadge kind={item.kind} />
                        <span className="wn-row-text">{item.text}</span>
                        <span className="wn-row-area">{item.area}</span>
                        {item.live === false && (
                          <span className="wn-row-testing" title="Not yet released to everyone">
                            testing
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <p className="wn-footnote">
        Highlights are written by hand. The week-by-week list is generated from
        the project&rsquo;s own history, so nothing that ships can go unrecorded.
      </p>
    </div>
  );
}
