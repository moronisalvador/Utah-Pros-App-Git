/**
 * ════════════════════════════════════════════════
 * FILE: Composer.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The box at the bottom of a conversation where the tech types a reply and taps Send.
 *   It grows as you type (up to a few lines), sends on Enter, remembers a half-typed
 *   message per conversation if you leave and come back, shows a live "how many texts
 *   this will cost" counter, and has a "+" for extra actions (for now just switching to
 *   an internal note — attachments and templates arrive in B2). If the contact has Do
 *   Not Disturb on, it shows a banner and blocks sending a text (but still lets you jot
 *   an internal note).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside ThreadView)
 *   Rendered by:  src/pages/tech/v2/messages/ThreadView.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  @/components/conversations/SegmentCounter, ./messageUtils drafts
 *   Data:      reads/writes → localStorage draft only (send goes through ThreadView →
 *              useThread → POST /api/send-message)
 *
 * NOTES / GOTCHAS:
 *   - Enter = send, Shift+Enter = newline (legacy tech muscle memory); enterKeyHint
 *     "send". Font is ≥16px so iOS never zooms the page on focus.
 *   - The textarea is the single source of truth; a same-tick double-Enter blanks the
 *     box synchronously so it can't fire twice.
 * ════════════════════════════════════════════════
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import SegmentCounter from '@/components/conversations/SegmentCounter';
import { getDraft, setDraft, clearDraft } from '@/components/conversations/messageUtils';

const MAX_LINES = 5;

function IconSend(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>);
}
function IconPlus(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
}
function IconNote(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>);
}

export default function Composer({ convId, contact, employee, onSend, sending }) {
  const { t } = useTranslation('msgs');
  const [text, setText] = useState(() => getDraft(convId));
  const [isNote, setIsNote] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const taRef = useRef(null);

  const dnd = !!contact?.dnd;
  const blockedByDnd = dnd && !isNote;

  // Sender-name prefix the server prepends ("Jane: ") counts toward the segment total.
  const prefixLen = useMemo(() => {
    if (isNote || !employee?.full_name) return 0;
    return `${employee.full_name}: `.length;
  }, [isNote, employee]);

  // Load the saved draft whenever the conversation changes.
  useEffect(() => { setText(getDraft(convId)); }, [convId]);

  // Autosize the textarea (capped at MAX_LINES) — pre-paint so there is no layout jump.
  const resize = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
    const max = lh * MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(() => { resize(); }, [text, resize]);

  const doSend = useCallback(() => {
    const el = taRef.current;
    const body = (el ? el.value : text).trim();
    if (!body || blockedByDnd) return;
    // Blank synchronously so a same-tick double-Enter can't fire twice.
    if (el) el.value = '';
    setText('');
    clearDraft(convId);
    onSend({ text: body, isNote });
    setShowActions(false);
    // Keep focus for a fast back-and-forth.
    requestAnimationFrame(() => taRef.current?.focus());
  }, [text, blockedByDnd, convId, isNote, onSend]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    setDraft(convId, v);
  };

  return (
    <div className="tv2-msgs-composer" data-note={isNote ? 'true' : undefined}>
      {dnd && (
        <div className="tv2-msgs-dnd-banner" role="status">
          {isNote ? t('composer.dndNote') : t('composer.dndBlock')}
        </div>
      )}

      {showActions && (
        <div className="tv2-msgs-actions-sheet" role="menu">
          <button
            type="button"
            className={`tv2-msgs-action${isNote ? ' active' : ''}`}
            role="menuitemcheckbox"
            aria-checked={isNote}
            onClick={() => { setIsNote((v) => !v); setShowActions(false); requestAnimationFrame(() => taRef.current?.focus()); }}
          >
            <IconNote width={20} height={20} />
            <span>{t('composer.note')}</span>
          </button>
          {/* MMS + templates land in B2 — the sheet is intentionally a shell in B1. */}
        </div>
      )}

      <div className="tv2-msgs-composer-row">
        <button
          type="button"
          className={`tv2-msgs-plus${showActions ? ' active' : ''}`}
          aria-label={t('composer.moreActions')}
          aria-expanded={showActions}
          onClick={() => setShowActions((v) => !v)}
        >
          <IconPlus width={22} height={22} />
        </button>

        <div className="tv2-msgs-input-wrap">
          <textarea
            ref={taRef}
            className="tv2-msgs-input"
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={isNote ? t('composer.notePlaceholder') : t('composer.placeholder')}
            enterKeyHint="send"
            rows={1}
            aria-label={isNote ? t('composer.note') : t('composer.placeholder')}
          />
          {text.trim() && <SegmentCounter text={isNote ? '' : text} prefixLen={prefixLen} />}
        </div>

        <button
          type="button"
          className="tv2-msgs-send"
          aria-label={t('composer.send')}
          disabled={!text.trim() || blockedByDnd || sending}
          onClick={doSend}
        >
          <IconSend width={20} height={20} />
        </button>
      </div>
    </div>
  );
}
