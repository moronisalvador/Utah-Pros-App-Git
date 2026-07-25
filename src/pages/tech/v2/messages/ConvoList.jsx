/**
 * ════════════════════════════════════════════════
 * FILE: ConvoList.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The messaging inbox: a fixed header with the title, a "mark all read" button when
 *   anything is unread, a search box, and status tabs (All / Unread / Needs Response /
 *   Waiting / Resolved), and below it the scrollable list of conversations. Pull down to
 *   refresh. The search and the status filters run on the server (so they still work no
 *   matter how many conversations there are), the tab counts come from the server too,
 *   and the header never scrolls away. On a true first load it shows gray placeholder
 *   rows; after that it always shows the cached list instead of a spinner.
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
 *   - "Mark all read" is SERVER-count-driven (statusCounts.unread), and clears every
 *     unread thread, not just the loaded page (see useConvoMutations.markAllRead).
 *   - Filter counts are per-status from the RPC's status_counts, reflecting the current
 *     search — so a pill's number matches what tapping it will show.
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
function IconCheckAll(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>);
}
function IconCompose(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>);
}

// B2: full status filter set (counts from the RPC's status_counts).
const FILTERS = ['all', 'unread', 'needs_response', 'waiting_on_client', 'resolved'];

export default function ConvoList({
  conversations, statusCounts, isColdStart, error, onOpen, onRefresh,
  filter, onFilterChange, search, onSearchChange, onSetUnread, onMarkAllRead, onNewConversation,
}) {
  const { t } = useTranslation('msgs');
  const unreadCount = statusCounts?.unread || 0;

  return (
    <div className="tv2-msgs-list" role="region" aria-label={t('list.title')}>
      {/* Fixed header — sticky within the pane host's list scroller. */}
      <div className="tv2-msgs-list__header">
        <div className="tv2-msgs-list__titlerow">
          <div className="tv2-msgs-list__title">{t('list.title')}</div>
          <div className="tv2-msgs-list__actions">
            {unreadCount > 0 && (
              <button type="button" className="tv2-msgs-readall" onClick={onMarkAllRead} aria-label={t('list.markAllRead')}>
                <IconCheckAll width={18} height={18} />
                <span>{t('list.markAllRead')}</span>
              </button>
            )}
            <button
              type="button"
              className="tv2-msgs-new-btn"
              onClick={onNewConversation}
              aria-label={t('newConversation.title')}
            >
              <IconCompose width={21} height={21} />
            </button>
          </div>
        </div>
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
            const count = statusCounts?.[f];
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
      ) : error && conversations.length === 0 ? (
        <div className="tv2-msgs-empty">
          <div className="tv2-msgs-empty__icon" aria-hidden="true">⚠️</div>
          <div className="tv2-msgs-empty__title">{t('list.error')}</div>
          <button type="button" className="tv2-msgs-retry-btn" onClick={onRefresh}>{t('states.retry')}</button>
        </div>
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
                <ConvoRow key={conv.id} conv={conv} onOpen={onOpen} onSetUnread={onSetUnread} />
              ))}
            </div>
          )}
        </PullToRefresh>
      )}
    </div>
  );
}
