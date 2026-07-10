/**
 * ════════════════════════════════════════════════
 * FILE: ConvoList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The messaging inbox: a fixed header with the title, a search box, and All/Unread
 *   tabs, and below it the scrollable list of conversations. Pull down to refresh. The
 *   search and the Unread filter are done on the server (so they still work no matter
 *   how many conversations there are), and the header never scrolls away. On a true
 *   first load it shows gray placeholder rows; after that it always shows the cached
 *   list instead of a spinner.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (list layer of the messaging pane)
 *   Rendered by:  src/pages/tech/v2/TechMessagesV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  @/components/PullToRefresh, @/components/tech/v2 (SkeletonList),
 *              ./ConvoRow
 *   Data:      conversations come from useTechConversations (owned by the parent);
 *              this file is presentational + local search/filter UI state.
 *
 * NOTES / GOTCHAS:
 *   - The header is position:sticky inside the pane host's list scroller, so
 *     pull-to-refresh (which finds that same scroller) sits BELOW a fixed header.
 *   - Search is debounced by the parent's query key; typing updates local state and
 *     the parent re-queries the server. Empty search + All = the cached default list
 *     the tab badge reads.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import PullToRefresh from '@/components/PullToRefresh';
import { SkeletonList } from '@/components/tech/v2';
import ConvoRow from './ConvoRow';

function IconSearch(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>);
}

// B1 ships All + Unread only (status pills are B2). Counts come from the RPC.
const FILTERS = ['all', 'unread'];

export default function ConvoList({
  conversations, statusCounts, isColdStart, onOpen, onRefresh,
  filter, onFilterChange, search, onSearchChange,
}) {
  const { t } = useTranslation('msgs');

  return (
    <div className="tv2-msgs-list" role="region" aria-label={t('list.title')}>
      {/* Fixed header — sticky within the pane host's list scroller. */}
      <div className="tv2-msgs-list__header">
        <div className="tv2-msgs-list__title">{t('list.title')}</div>
        <div className="tv2-msgs-search">
          <IconSearch className="tv2-msgs-search__icon" width={16} height={16} aria-hidden="true" />
          <input
            className="tv2-msgs-search__input"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('list.searchPlaceholder')}
            enterKeyHint="search"
            aria-label={t('list.searchPlaceholder')}
          />
        </div>
        <div className="tv2-msgs-filters" role="tablist">
          {FILTERS.map((f) => {
            const count = f === 'unread' ? statusCounts?.unread : statusCounts?.all;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`tv2-msgs-filter${filter === f ? ' active' : ''}`}
                onClick={() => onFilterChange(f)}
              >
                {t(`filters.${f}`)}
                {count > 0 && <span className="tv2-msgs-filter__count">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — pull-to-refresh sits below the fixed header. */}
      {isColdStart ? (
        <SkeletonList rows={7} />
      ) : (
        <PullToRefresh onRefresh={onRefresh}>
          {conversations.length === 0 ? (
            <div className="tv2-msgs-empty">
              <div className="tv2-msgs-empty__icon" aria-hidden="true">💬</div>
              <div className="tv2-msgs-empty__title">
                {search || filter !== 'all' ? t('list.noMatch') : t('list.empty')}
              </div>
            </div>
          ) : (
            <div className="tv2-msgs-rows">
              {conversations.map((conv) => (
                <ConvoRow key={conv.id} conv={conv} onOpen={onOpen} />
              ))}
            </div>
          )}
        </PullToRefresh>
      )}
    </div>
  );
}
