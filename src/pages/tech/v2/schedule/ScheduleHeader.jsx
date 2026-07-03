/**
 * ════════════════════════════════════════════════
 * FILE: ScheduleHeader.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The fixed top of the schedule that never moves when you pull to refresh: the
 *   month label, the Agenda/Day switch, a "+" to start a new appointment or event,
 *   a search box, a filter button, the expandable filter panel (my work / crew /
 *   division), and the swipeable week strip. All the controls a tech reaches for
 *   without scrolling.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (header control)
 *   Rendered by:  TechScheduleV2 (sticky, above the scrolling content)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./WeekStrip
 *   Data:      none (all state lifted to TechScheduleV2)
 *
 * NOTES / GOTCHAS:
 *   - Every button here is ≥44px (search row) / 48px (create) to stay glove-tappable.
 *   - Month view is intentionally NOT offered here — it's a deferred stage (rides
 *     with Phase C), not a silent omission.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import WeekStrip from './WeekStrip.jsx';

const DIVISIONS = [
  { key: 'all', label: 'All' },
  { key: 'mitigation', label: 'Mitigation' },
  { key: 'reconstruction', label: 'Reconstruction' },
];

function Chip({ active, onClick, children }) {
  return (
    <button type="button" className={`tv2-chip${active ? ' is-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

export default function ScheduleHeader({
  monthLabel, view, onViewChange, onCreate,
  searchQuery, onSearchChange, showSearch, onToggleSearch,
  showFilters, onToggleFilters, hasActiveFilters,
  filterEmployee, filterDivision, onSetEmployee, onSetDivision, onToggleCrew, crewMembers, myId,
  selectedDay, today, apptDates, onSelectDay, onWeekChange, active,
}) {
  const hasQuery = !!(searchQuery && searchQuery.trim());
  return (
    <div className="tv2-sched-header">
      {/* Compact top row: month + search/filter icons + view switch + create.
          The old permanent search bar is gone — search is an icon now, giving the
          whole row back to the appointments below. */}
      <div className="tv2-sched-header__top">
        <h1 className="tv2-sched-header__month">{monthLabel}</h1>
        <div className="tv2-sched-header__actions">
          <button type="button"
            className={`tv2-icon-btn tv2-headicon${(hasQuery || showSearch) ? ' is-active' : ''}`}
            onClick={onToggleSearch} aria-label="Search" aria-expanded={showSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {hasQuery && <span className="tv2-icon-btn__dot" />}
          </button>
          <button type="button"
            className={`tv2-icon-btn tv2-headicon${hasActiveFilters ? ' is-active' : ''}`}
            onClick={onToggleFilters} aria-label="Filters" aria-expanded={showFilters}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {hasActiveFilters && <span className="tv2-icon-btn__dot" />}
          </button>
          <div className="tv2-segmented" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'agenda'}
              className={view === 'agenda' ? 'is-active' : ''} onClick={() => onViewChange('agenda')}>Agenda</button>
            <button type="button" role="tab" aria-selected={view === 'day'}
              className={view === 'day' ? 'is-active' : ''} onClick={() => onViewChange('day')}>Day</button>
          </div>
          <button type="button" className="tv2-icon-btn tv2-icon-btn--accent" onClick={onCreate} aria-label="Create appointment or event">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transient search field — mounted only while the search icon is toggled on */}
      {showSearch && (
        <div className="tv2-sched-header__searchrow">
          <div className="tv2-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search name, address, job #…"
              aria-label="Search appointments"
            />
            {searchQuery && (
              <button type="button" className="tv2-search__clear" onClick={() => onSearchChange('')} aria-label="Clear search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="tv2-filter-panel">
          <div className="tv2-filter-group">
            <div className="tv2-filter-label">Type</div>
            <div className="tv2-chip-row">
              {DIVISIONS.map((d) => (
                <Chip key={d.key} active={filterDivision === d.key} onClick={() => onSetDivision(d.key)}>{d.label}</Chip>
              ))}
            </div>
          </div>
          <div className="tv2-filter-group">
            <div className="tv2-filter-label">Crew</div>
            <div className="tv2-chip-row tv2-chip-row--scroll">
              <Chip active={filterEmployee === 'me'} onClick={() => onSetEmployee('me')}>Me</Chip>
              <Chip active={filterEmployee === 'all'} onClick={() => onSetEmployee('all')}>All</Chip>
              {crewMembers.map((c) => {
                const isMe = c.id === myId;
                const isSel = Array.isArray(filterEmployee) && filterEmployee.includes(c.id);
                return (
                  <Chip key={c.id} active={isSel} onClick={() => onToggleCrew(c.id)}>
                    {isMe ? `Me (${c.name})` : c.name}
                  </Chip>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Week strip */}
      <WeekStrip
        selectedDay={selectedDay}
        today={today}
        apptDates={apptDates}
        onSelectDay={onSelectDay}
        onWeekChange={onWeekChange}
        active={active}
      />
    </div>
  );
}
