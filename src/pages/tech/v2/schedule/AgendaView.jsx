/**
 * ════════════════════════════════════════════════
 * FILE: AgendaView.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The scrolling agenda: every day that has appointments, in order, with a sticky
 *   date header that sticks to the top as you scroll past it. It opens already
 *   parked on today (no jump, no flash), you can scroll up into the past and down
 *   into the future forever, and as you scroll it quietly tells the calendar strip
 *   which day you're looking at. Loading more of the past slides new days in above
 *   without shoving the page under your thumb.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (schedule sub-view)
 *   Rendered by:  TechScheduleV2 (agenda mode)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./ScheduleRow, ./scheduleSelectors (addDaysStr), formatting inline
 *   Data:      none (parent supplies grouped appointments)
 *
 * NOTES / GOTCHAS:
 *   - Anchoring to today happens on FIRST PAINT via a ref + rect math on our own
 *     scroll container (found with ref.closest('.tv2-pane-scroll') — NEVER a global
 *     querySelector, which breaks under the pane host). A microtask re-assert wins
 *     over the pane host's scroll-restore on the first activation. No setTimeout.
 *   - Prepending past days compensates scrollTop by the exact height added, so the
 *     viewport is visually stationary while new content appears above.
 * ════════════════════════════════════════════════
 */
import React, { useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import ScheduleRow from './ScheduleRow.jsx';

const EDGE_PX = 600; // start loading more when this close to an end

// Find our own scroll container. The pane host is `.tv2-pane-scroll`; fall back to
// the nearest scrollable ancestor so this also works outside the pane host.
function getScroller(el) {
  const pane = el.closest('.tv2-pane-scroll');
  if (pane) return pane;
  let node = el.parentElement;
  while (node) {
    const oy = window.getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function headerLabel(dateStr, today, tomorrow) {
  const d = new Date(dateStr + 'T12:00:00');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  if (dateStr === today) return `Today · ${weekday} ${month} ${day}`;
  if (dateStr === tomorrow) return `Tomorrow · ${weekday} ${month} ${day}`;
  return `${weekday} ${month} ${day}`;
}

/**
 * @param {{
 *   grouped: Record<string, object[]>, sortedDates: string[],
 *   today: string, tomorrow: string, selectedDay: string, scrollSignal: number,
 *   active: boolean, onLoadPast: () => void, onLoadFuture: () => void,
 *   onVisibleDayChange?: (d: string) => void, onAwayChange?: (away: boolean) => void,
 * }} props
 */
export default function AgendaView({
  grouped, sortedDates, today, tomorrow, selectedDay, scrollSignal, active,
  onLoadPast, onLoadFuture, onVisibleDayChange, onAwayChange,
}) {
  const rootRef = useRef(null);
  const scrollerRef = useRef(null);
  const dayEls = useRef({}); // date → section element
  const didAnchor = useRef(false);
  const rafRef = useRef(0);

  // Prepend compensation bookkeeping.
  const firstDateRef = useRef(sortedDates[0]);
  const savedHeightRef = useRef(0);
  const loadingPastRef = useRef(false);
  const lastVisibleDayRef = useRef(selectedDay);

  const scrollToDate = useCallback((dateStr, behavior = 'auto') => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Exact day, else the first day on/after it, else the last day loaded.
    let el = dayEls.current[dateStr];
    if (!el) {
      const near = sortedDates.find((d) => d >= dateStr) || sortedDates[sortedDates.length - 1];
      el = near ? dayEls.current[near] : null;
    }
    if (!el) return;
    const top = scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    scroller.scrollTo({ top, behavior });
  }, [sortedDates]);

  // Cache the scroll container once mounted.
  useLayoutEffect(() => {
    if (rootRef.current) scrollerRef.current = getScroller(rootRef.current);
  }, []);

  // Anchor to today on first paint (once, when active with content). Runs before
  // paint; a queued microtask re-asserts after the pane host's restore-to-0.
  useLayoutEffect(() => {
    if (didAnchor.current || !active || sortedDates.length === 0) return;
    if (!scrollerRef.current) scrollerRef.current = getScroller(rootRef.current);
    // Anchor to today if present, else the first future date, else the last date.
    const target =
      dayEls.current[today] ? today :
      sortedDates.find((d) => d >= today) || sortedDates[sortedDates.length - 1];
    const apply = () => scrollToDate(target, 'auto');
    apply();
    queueMicrotask(apply);
    didAnchor.current = true;
    firstDateRef.current = sortedDates[0];
  }, [active, sortedDates, today, scrollToDate]);

  // Compensate scrollTop when past days are prepended (first date got earlier).
  // The gate is released on ANY data settle after a past-load request — including a
  // month that turned out empty — so an empty past month can't wedge loading shut.
  useLayoutEffect(() => {
    const newFirst = sortedDates[0];
    if (loadingPastRef.current) {
      if (newFirst && firstDateRef.current && newFirst < firstDateRef.current) {
        const scroller = scrollerRef.current;
        if (scroller) scroller.scrollTop += scroller.scrollHeight - savedHeightRef.current;
      }
      loadingPastRef.current = false;
    }
    firstDateRef.current = newFirst;
  }, [sortedDates]);

  // Respond to explicit day picks / Today taps (scrollSignal bumps).
  useEffect(() => {
    if (scrollSignal === 0) return;
    scrollToDate(selectedDay, 'smooth');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollSignal]);

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;

    // Infinite edges.
    if (scrollTop < EDGE_PX && !loadingPastRef.current) {
      loadingPastRef.current = true;
      savedHeightRef.current = scrollHeight;
      onLoadPast();
    }
    if (scrollHeight - scrollTop - clientHeight < EDGE_PX) {
      onLoadFuture();
    }

    // Which day is at the top of the viewport → drive strip highlight + Today pill.
    const scRect = scroller.getBoundingClientRect();
    let topDay = sortedDates[0];
    for (const d of sortedDates) {
      const el = dayEls.current[d];
      if (!el) continue;
      if (el.getBoundingClientRect().top - scRect.top <= 8) topDay = d;
      else break;
    }
    if (topDay && topDay !== lastVisibleDayRef.current) {
      lastVisibleDayRef.current = topDay;
      onVisibleDayChange?.(topDay);
    }
    // "Away" when today's section is out of view (or absent above the fold).
    const todayEl = dayEls.current[today];
    let away = true;
    if (todayEl) {
      const rel = todayEl.getBoundingClientRect().top - scRect.top;
      away = rel < -40 || rel > clientHeight - 40;
    } else {
      away = today < (sortedDates[0] || today) ? false : true;
    }
    onAwayChange?.(away);
  }, [sortedDates, today, onLoadPast, onLoadFuture, onVisibleDayChange, onAwayChange]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      handleScroll();
    });
  }, [handleScroll]);

  // Attach the scroll listener to our scroll container (shared with the pane host).
  useEffect(() => {
    const scroller = scrollerRef.current || (rootRef.current && getScroller(rootRef.current));
    if (!scroller) return undefined;
    scrollerRef.current = scroller;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <div ref={rootRef} className="tv2-agenda">
      {sortedDates.map((dateStr) => {
        const isToday = dateStr === today;
        return (
          <section
            key={dateStr}
            ref={(el) => { dayEls.current[dateStr] = el; }}
            className="tv2-agenda__day"
          >
            <div className={`tv2-agenda__header${isToday ? ' is-today' : ''}`}>
              {headerLabel(dateStr, today, tomorrow)}
              <span className="tv2-agenda__count">{grouped[dateStr].length}</span>
            </div>
            <div className="tv2-agenda__rows">
              {grouped[dateStr].map((appt) => <ScheduleRow key={appt.id} appt={appt} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
