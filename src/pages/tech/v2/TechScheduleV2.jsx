/**
 * ════════════════════════════════════════════════
 * FILE: TechScheduleV2.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The rebuilt schedule a field tech lives in day to day. A swipeable week strip
 *   sits under a fixed header; below it you either read a continuous agenda (opens
 *   already on today, scroll up for the past, down for the future) or a single-day
 *   hour timeline with a live red "now" line. Search, "just my work / crew /
 *   division" filters, and a "+" to add an appointment or event are all one tap
 *   away. Everything is cached so switching tabs and days is instant — the calendar
 *   never blanks to a spinner once it has loaded.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/schedule  (behind page:tech_sched_v2; legacy otherwise)
 *   Rendered by:  TechLayout pane host (persistent, flag-gated pane)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/components/PullToRefresh,
 *              @/components/tech/v2 (SkeletonList), ./schedule/* (data hook, views,
 *              header, selectors, filter store)
 *   Data:      reads → get_appointments_range (via useScheduleData)
 *
 * NOTES / GOTCHAS:
 *   - The `active` prop (pane is the visible tab) gates the day-timeline's now-line
 *     timer and the agenda's first-paint anchor.
 *   - Day selection is pure client state — it never triggers a fetch; only crossing
 *     a month boundary prefetches the next window.
 *   - Owned by Session S per .claude/rules/tech-v2-wave-ownership.md.
 * ════════════════════════════════════════════════
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { SkeletonList } from '@/components/tech/v2';
import { fmtDate } from '@/lib/scheduleUtils';
import { currentLocaleTag } from '@/lib/techDateUtils';
import { useScheduleData } from './schedule/useScheduleData.js';
import {
  monthKeyOf, addMonths, addDaysStr,
  filterAppointments, searchAppointments, groupByDate, sortedDateKeys, apptDateSet,
} from './schedule/scheduleSelectors.js';
import ScheduleHeader from './schedule/ScheduleHeader.jsx';
import AgendaView from './schedule/AgendaView.jsx';
import DayTimeline from './schedule/DayTimeline.jsx';
import CreatePicker from './schedule/CreatePicker.jsx';
import { loadFilters, saveFilters } from './schedule/filterStore.js';

// Legacy-parity crew toggle: mirrors TechSchedule.jsx's multi-select behavior.
function toggleCrew(prev, id, myId) {
  if (prev === 'me') return [myId, id];
  if (prev === 'all') return [id];
  if (Array.isArray(prev)) {
    if (prev.includes(id)) {
      const next = prev.filter((x) => x !== id);
      if (next.length === 0) return 'me';
      if (next.length === 1 && next[0] === myId) return 'me';
      return next;
    }
    return [...prev, id];
  }
  return [id];
}

export default function TechScheduleV2({ active = true }) {
  const { t } = useTranslation(['schedule', 'tech']);
  const { employee } = useAuth();
  const myId = employee.id;
  const today = useMemo(() => fmtDate(new Date()), []);
  const tomorrow = useMemo(() => addDaysStr(today, 1), [today]);

  // ─── SECTION: State & hooks ──────────────
  const [selectedDay, setSelectedDay] = useState(today);
  const [view, setView] = useState('day'); // 'day' | 'agenda' — Day is the default on mobile
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0); // bumps on explicit day pick
  const [away, setAway] = useState(false); // scrolled away from today (agenda)

  const initial = useMemo(() => loadFilters(myId), [myId]);
  const [filterEmployee, setFilterEmployee] = useState(initial.employee);
  const [filterDivision, setFilterDivision] = useState(initial.division);
  useEffect(() => {
    saveFilters(myId, { employee: filterEmployee, division: filterDivision });
  }, [myId, filterEmployee, filterDivision]);

  const { appointments, loadedMonths, setFocusMonth, isColdStart, refresh } = useScheduleData(monthKeyOf(today));

  // ─── SECTION: Derived data ──────────────
  const filtered = useMemo(
    () => filterAppointments(appointments, { employee: filterEmployee, division: filterDivision, myId }),
    [appointments, filterEmployee, filterDivision, myId],
  );
  const searched = useMemo(() => searchAppointments(filtered, searchQuery), [filtered, searchQuery]);
  const grouped = useMemo(() => groupByDate(searched), [searched]);
  const sortedDates = useMemo(() => sortedDateKeys(grouped), [grouped]);
  // Dots reflect the filtered-but-unsearched set (matches the legacy page).
  const apptDates = useMemo(() => apptDateSet(filtered), [filtered]);

  const crewMembers = useMemo(() => {
    const map = new Map();
    for (const a of appointments) {
      for (const c of a.appointment_crew || []) {
        if (!map.has(c.employee_id)) {
          map.set(c.employee_id, { id: c.employee_id, name: c.employees?.display_name || c.employees?.full_name || t('tech:misc.unknown') });
        }
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.id === myId) return -1;
      if (b.id === myId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [appointments, myId, t]);

  const monthLabel = useMemo(
    () => new Date(selectedDay + 'T12:00:00').toLocaleDateString(currentLocaleTag(), { month: 'long', year: 'numeric' }),
    [selectedDay],
  );
  const dayAppts = useMemo(() => grouped[selectedDay] || [], [grouped, selectedDay]);
  const hasActiveFilters = filterEmployee !== 'me' || filterDivision !== 'all';
  const showTodayPill = view === 'day' ? selectedDay !== today : away;

  // ─── SECTION: Event handlers ──────────────
  // Explicit day pick (strip tap): select + scroll the agenda + prefetch its month.
  const pickDay = useCallback((day) => {
    setSelectedDay(day);
    setFocusMonth(monthKeyOf(day));
    setScrollSignal((n) => n + 1);
  }, [setFocusMonth]);

  // Agenda scrolled a new day to the top: follow it WITHOUT scrolling back.
  const onVisibleDayChange = useCallback((day) => {
    setSelectedDay(day);
    setFocusMonth(monthKeyOf(day));
  }, [setFocusMonth]);

  const onWeekChange = useCallback((monthKey) => setFocusMonth(monthKey), [setFocusMonth]);
  const onLoadPast = useCallback(() => setFocusMonth(addMonths(loadedMonths[0], -1)), [loadedMonths, setFocusMonth]);
  const onLoadFuture = useCallback(() => setFocusMonth(addMonths(loadedMonths[loadedMonths.length - 1], 1)), [loadedMonths, setFocusMonth]);
  const goToday = useCallback(() => pickDay(today), [pickDay, today]);

  // ─── SECTION: Render ──────────────
  return (
    <div className="tv2-page tv2-sched">
      <ScheduleHeader
        monthLabel={monthLabel}
        view={view}
        onViewChange={setView}
        onCreate={() => setShowCreate(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        showSearch={showSearch}
        onToggleSearch={() => setShowSearch((v) => !v)}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((v) => !v)}
        hasActiveFilters={hasActiveFilters}
        filterEmployee={filterEmployee}
        filterDivision={filterDivision}
        onSetEmployee={setFilterEmployee}
        onSetDivision={setFilterDivision}
        onToggleCrew={(id) => setFilterEmployee((prev) => toggleCrew(prev, id, myId))}
        crewMembers={crewMembers}
        myId={myId}
        selectedDay={selectedDay}
        today={today}
        apptDates={apptDates}
        onSelectDay={pickDay}
        onWeekChange={onWeekChange}
        active={active}
      />

      {isColdStart ? (
        <SkeletonList rows={6} />
      ) : (
        <PullToRefresh onRefresh={refresh} className="tv2-sched__scroll">
          {view === 'agenda' ? (
            sortedDates.length === 0 ? (
              <EmptyState hasFilters={hasActiveFilters || !!searchQuery.trim()} onCreate={() => setShowCreate(true)} />
            ) : (
              <AgendaView
                grouped={grouped}
                sortedDates={sortedDates}
                today={today}
                tomorrow={tomorrow}
                selectedDay={selectedDay}
                scrollSignal={scrollSignal}
                active={active}
                onLoadPast={onLoadPast}
                onLoadFuture={onLoadFuture}
                onVisibleDayChange={onVisibleDayChange}
                onAwayChange={setAway}
              />
            )
          ) : (
            <DayTimeline appts={dayAppts} selectedDay={selectedDay} today={today} active={active} />
          )}
        </PullToRefresh>
      )}

      {showTodayPill && (
        <button type="button" className="tv2-today-pill" onClick={goToday}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {t('today')}
        </button>
      )}

      {showCreate && <CreatePicker selectedDay={selectedDay} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function EmptyState({ hasFilters, onCreate }) {
  const { t } = useTranslation('schedule');
  return (
    <div className="tv2-sched-empty">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        <polyline points="9 16 11 18 15 14" strokeWidth="2" />
      </svg>
      <div className="tv2-sched-empty__title">
        {hasFilters ? t('empty.noMatch') : t('empty.nothingScheduled')}
      </div>
      <div className="tv2-sched-empty__sub">
        {hasFilters ? t('empty.tryClearing') : t('empty.swipeToBrowse')}
      </div>
      {!hasFilters && (
        <button type="button" className="tv2-sched-empty__cta" onClick={onCreate}>{t('empty.newAppointment')}</button>
      )}
    </div>
  );
}
