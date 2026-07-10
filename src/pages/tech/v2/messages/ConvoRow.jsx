/**
 * ════════════════════════════════════════════════
 * FILE: ConvoRow.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One row in the messaging inbox: the person's initials, their name, a one-line
 *   preview of the last message, when it happened, and — if there are unread texts —
 *   bold text plus a red count. A colored bar down the left edge shows the
 *   conversation's status (red = needs response, amber = waiting, green = resolved) so
 *   a tech can read state from three feet away. A group/broadcast thread shows a small
 *   badge with how many people are on it. Tapping the row opens the thread; tapping the
 *   "⋯" opens one inline 48px button to mark the thread read or unread.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (list item)
 *   Rendered by:  src/pages/tech/v2/messages/ConvoList.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  ./msgsSelectors (convoUnread, isMultiConversation, recipientCount),
 *              ./msgDateUtils (listTime)
 *   Data:      reads/writes → none directly (mark read/unread is handled by the parent
 *              via onSetUnread → useConvoMutations)
 *
 * NOTES / GOTCHAS:
 *   - Mark-unread is an INLINE 48px affordance (overflow → one action), never a
 *     hover/right-click idiom — tech-mobile-ux.md (gloved hands, 48px floor).
 *   - The outer element is a div (not a button) so the "⋯" and its action are real
 *     sibling buttons — nested buttons are invalid HTML.
 * ════════════════════════════════════════════════
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { convoUnread, isMultiConversation, recipientCount } from './msgsSelectors';
import { listTime } from './msgDateUtils';

function cleanName(s) { return (s || 'Unknown').replace(/\s*\[DEMO\]\s*/g, ''); }
function initials(name) {
  const clean = cleanName(name).trim();
  if (!clean || clean === 'Unknown') return '?';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function IconMore(props) {
  return (<svg viewBox="0 0 24 24" fill="currentColor" {...props}><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>);
}
function IconGroup(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
}

// status → the status-color accent bar token (3-feet readability).
const STATUS_TOKEN = {
  needs_response: 'needs-response',
  waiting_on_client: 'waiting',
  resolved: 'resolved',
};

export default function ConvoRow({ conv, onOpen, onSetUnread }) {
  const { t } = useTranslation('msgs');
  const [showActions, setShowActions] = useState(false);
  const { isUnread, count } = convoUnread(conv);
  const name = cleanName(conv.title);
  const preview = conv.last_message_preview || '';
  const token = STATUS_TOKEN[conv.status] || 'needs-response';
  const multi = isMultiConversation(conv);

  const toggleActions = (e) => { e.stopPropagation(); setShowActions((v) => !v); };
  const setUnread = (e, unread) => {
    e.stopPropagation();
    setShowActions(false);
    onSetUnread?.(conv.id, unread);
  };

  return (
    <div className="tv2-msgs-row-wrap">
      <div className="tv2-msgs-row-line">
        <button
          type="button"
          className={`tv2-msgs-row${isUnread ? ' unread' : ''}`}
          onClick={() => onOpen(conv.id)}
        >
          <span className={`tv2-msgs-row__bar tv2-msgs-row__bar--${token}`} aria-hidden="true" />
          <span className="tv2-msgs-row__avatar">
            {multi ? <IconGroup width={20} height={20} /> : initials(conv.title)}
          </span>
          <span className="tv2-msgs-row__main">
            <span className="tv2-msgs-row__top">
              <span className="tv2-msgs-row__name">{name}</span>
              <span className="tv2-msgs-row__time">{listTime(conv.last_message_at || conv.created_at)}</span>
            </span>
            <span className="tv2-msgs-row__preview">
              {multi && <span className="tv2-msgs-row__pill">{t('thread.recipients', { count: recipientCount(conv) })}</span>}
              {preview || (multi ? '' : ' ')}
            </span>
          </span>
          {isUnread && <span className="tv2-msgs-row__badge">{count > 99 ? '99+' : count}</span>}
        </button>
        <button
          type="button"
          className="tv2-msgs-row__more"
          aria-label={t('list.rowActions')}
          aria-expanded={showActions}
          onClick={toggleActions}
        >
          <IconMore width={20} height={20} />
        </button>
      </div>
      {showActions && (
        <div className="tv2-msgs-row__actions" role="group">
          {isUnread ? (
            <button type="button" className="tv2-msgs-row__action" onClick={(e) => setUnread(e, false)}>
              {t('list.markRead')}
            </button>
          ) : (
            <button type="button" className="tv2-msgs-row__action" onClick={(e) => setUnread(e, true)}>
              {t('list.markUnread')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
