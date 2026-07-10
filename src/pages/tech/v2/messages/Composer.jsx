/**
 * ════════════════════════════════════════════════
 * FILE: Composer.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The box at the bottom of a conversation where the tech types a reply and taps Send.
 *   It grows as you type (up to a few lines), sends on Enter, remembers a half-typed
 *   message per conversation, and shows a live "how many texts this will cost" counter.
 *   The "+" opens a small sheet with three tools: attach photos (up to five, shown as
 *   thumbnails while they upload), drop in a saved template, or switch to an internal
 *   note. If the contact has Do Not Disturb on it shows a banner and blocks sending a
 *   text (but still lets you jot an internal note).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside ThreadView)
 *   Rendered by:  src/pages/tech/v2/messages/ThreadView.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  @/components/conversations/SegmentCounter, ./messageUtils drafts,
 *              ./useComposerAttachments (MMS tray), ./useTemplates (canned replies)
 *   Data:      reads/writes → localStorage draft + Supabase Storage (attachments, via the
 *              hook); the send itself goes through ThreadView → useThread → the worker.
 *
 * NOTES / GOTCHAS:
 *   - Enter behavior is pointer-aware (bake report 2026-07-10): on a TOUCH device
 *     (phone/tablet) Enter inserts a newline like iMessage/Housecall — the field
 *     shows a return key and sending is the button only. On a desktop keyboard
 *     (fine pointer) Enter sends and Shift+Enter is a newline. Font is ≥16px so iOS
 *     never zooms the page on focus.
 *   - The worker requires a non-empty body even for MMS, so a photo rides with a caption:
 *     Send stays disabled until there is text (parity with legacy).
 *   - A template inserts at the caret (not append) so a tech can top-and-tail it.
 * ════════════════════════════════════════════════
 */
import React, { useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import SegmentCounter from '@/components/conversations/SegmentCounter';
import { getDraft, setDraft, clearDraft } from '@/components/conversations/messageUtils';
import { useComposerAttachments } from './useComposerAttachments';
import { useTemplates } from './useTemplates';

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
function IconImage(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>);
}
function IconTemplate(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>);
}
function IconX(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}

export default function Composer({ convId, contact, employee, onSend, sending }) {
  const { t } = useTranslation('msgs');
  const [text, setText] = useState(() => getDraft(convId));
  const [isNote, setIsNote] = useState(false);
  const [sheet, setSheet] = useState(null); // null | 'actions' | 'templates'
  const taRef = useRef(null);
  const fileRef = useRef(null);

  // Touch device? Then Enter should insert a newline (native), not send — the phone
  // keyboard has no easy Shift+Enter and messaging apps let you type multi-line and
  // tap Send. Fine pointer (desktop) keeps Enter-to-send. Computed once (a device
  // doesn't switch pointer class mid-session).
  const isTouch = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
    [],
  );

  const { attachments, addFiles, removeAttachment, clearAttachments, readyUrls, uploading } = useComposerAttachments(convId);
  const { groups, loading: tmplLoading, error: tmplError, load: loadTemplates } = useTemplates();

  const dnd = !!contact?.dnd;
  const blockedByDnd = dnd && !isNote;

  // Sender-name prefix the server prepends ("Jane: ") counts toward the segment total.
  const prefixLen = useMemo(() => {
    if (isNote || !employee?.full_name) return 0;
    return `${employee.full_name}: `.length;
  }, [isNote, employee]);

  // Draft is seeded lazily from the initial state above. ThreadView is keyed by
  // conversation id, so this Composer remounts per thread — convId never changes within
  // one instance, so no reset effect is needed (and none that would setState-in-effect).

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
    if (uploading) return; // wait for attachments to finish
    const media = isNote ? [] : readyUrls;
    // Blank synchronously so a same-tick double-Enter can't fire twice.
    if (el) el.value = '';
    setText('');
    clearDraft(convId);
    onSend({ text: body, media_urls: media, isNote });
    clearAttachments();
    setSheet(null);
    // Keep focus for a fast back-and-forth.
    requestAnimationFrame(() => taRef.current?.focus());
  }, [text, blockedByDnd, uploading, isNote, readyUrls, convId, onSend, clearAttachments]);

  const onKeyDown = (e) => {
    // Touch: let Enter fall through to the textarea as a newline. Desktop: Enter
    // sends, Shift+Enter is a newline.
    if (isTouch) return;
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

  const onPickFiles = (e) => {
    const files = e.target.files;
    e.target.value = '';
    addFiles(files);
    setSheet(null);
  };

  // Insert a template body AT THE CARET (top-and-tail friendly), not append.
  const insertTemplate = useCallback((body) => {
    const el = taRef.current;
    const cur = el ? el.value : text;
    const start = el ? el.selectionStart : cur.length;
    const end = el ? el.selectionEnd : cur.length;
    const next = cur.slice(0, start) + body + cur.slice(end);
    setText(next);
    setDraft(convId, next);
    setSheet(null);
    requestAnimationFrame(() => {
      const node = taRef.current;
      if (node) {
        node.focus();
        const pos = start + body.length;
        try { node.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    });
  }, [text, convId]);

  const openTemplates = () => { loadTemplates(); setSheet('templates'); };
  const toggleActions = () => setSheet((s) => (s ? null : 'actions'));

  const canSend = !!text.trim() && !blockedByDnd && !sending && !uploading;

  return (
    <div className="tv2-msgs-composer" data-note={isNote ? 'true' : undefined}>
      {dnd && (
        <div className="tv2-msgs-dnd-banner" role="status">
          {isNote ? t('composer.dndNote') : t('composer.dndBlock')}
        </div>
      )}

      {/* Attachment tray (MMS) — thumbnails with a 48px remove target. */}
      {attachments.length > 0 && !isNote && (
        <div className="tv2-msgs-attach-tray" aria-label={t('composer.attachments')}>
          {attachments.map((a) => (
            <div key={a.clientId} className={`tv2-msgs-attach${a.error ? ' error' : ''}`}>
              {(a.url || a.localPreview) && <img src={a.url || a.localPreview} alt="" />}
              {a.uploading && <span className="tv2-msgs-attach__spin" aria-hidden="true" />}
              {a.error && <span className="tv2-msgs-attach__err" aria-hidden="true">!</span>}
              <button
                type="button"
                className="tv2-msgs-attach__remove"
                aria-label={t('composer.removeAttachment')}
                onClick={() => removeAttachment(a.clientId)}
              >
                <IconX width={14} height={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Templates picker sheet. */}
      {sheet === 'templates' && (
        <div className="tv2-msgs-templates" role="menu">
          <div className="tv2-msgs-templates__head">
            <span>{t('composer.templates')}</span>
            <button type="button" className="tv2-msgs-templates__close" aria-label={t('common.close')} onClick={() => setSheet(null)}>
              <IconX width={18} height={18} />
            </button>
          </div>
          {tmplLoading ? (
            <div className="tv2-msgs-templates__empty">{t('states.loading')}</div>
          ) : tmplError ? (
            <div className="tv2-msgs-templates__empty">{t('composer.templatesError')}</div>
          ) : groups.length === 0 ? (
            <div className="tv2-msgs-templates__empty">{t('composer.noTemplates')}</div>
          ) : (
            <div className="tv2-msgs-templates__scroll">
              {groups.map((g) => (
                <div key={g.category || '_'} className="tv2-msgs-templates__group">
                  {g.category && <div className="tv2-msgs-templates__cat">{g.category}</div>}
                  {g.items.map((tmpl) => (
                    <button key={tmpl.id} type="button" className="tv2-msgs-template" role="menuitem" onClick={() => insertTemplate(tmpl.body)}>
                      <span className="tv2-msgs-template__title">{tmpl.title}</span>
                      <span className="tv2-msgs-template__preview">{tmpl.body}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions sheet ([+]). */}
      {sheet === 'actions' && (
        <div className="tv2-msgs-actions-sheet" role="menu">
          <button
            type="button"
            className="tv2-msgs-action"
            role="menuitem"
            disabled={isNote}
            onClick={() => fileRef.current?.click()}
          >
            <IconImage width={20} height={20} />
            <span>{t('composer.attachPhotos')}</span>
          </button>
          <button type="button" className="tv2-msgs-action" role="menuitem" onClick={openTemplates}>
            <IconTemplate width={20} height={20} />
            <span>{t('composer.templates')}</span>
          </button>
          <button
            type="button"
            className={`tv2-msgs-action${isNote ? ' active' : ''}`}
            role="menuitemcheckbox"
            aria-checked={isNote}
            onClick={() => { setIsNote((v) => !v); setSheet(null); requestAnimationFrame(() => taRef.current?.focus()); }}
          >
            <IconNote width={20} height={20} />
            <span>{t('composer.note')}</span>
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPickFiles}
      />

      <div className="tv2-msgs-composer-row">
        <button
          type="button"
          className={`tv2-msgs-plus${sheet ? ' active' : ''}`}
          aria-label={t('composer.moreActions')}
          aria-expanded={!!sheet}
          onClick={toggleActions}
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
            enterKeyHint={isTouch ? 'enter' : 'send'}
            rows={1}
            aria-label={isNote ? t('composer.note') : t('composer.placeholder')}
          />
          {text.trim() && <SegmentCounter text={isNote ? '' : text} prefixLen={prefixLen} />}
        </div>

        <button
          type="button"
          className="tv2-msgs-send"
          aria-label={t('composer.send')}
          disabled={!canSend}
          onClick={doSend}
        >
          <IconSend width={20} height={20} />
        </button>
      </div>
    </div>
  );
}
