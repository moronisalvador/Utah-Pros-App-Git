/**
 * ════════════════════════════════════════════════
 * FILE: Composer.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The box at the bottom of a conversation where the tech types a reply and taps Send.
 *   It grows as you type (up to a few lines), sends on Enter, and remembers a half-typed
 *   message per conversation.
 *   The "+" opens the composer tools. On the iPhone app it is Apple's own pop-up
 *   menu: Take Photo (our full-screen camera, WhatsApp-style with recents strip and
 *   album icon), Photo Library (the phone's multi-select picker), Templates, and
 *   Internal note. On the website it is a small web-drawn sheet: attach photos (a
 *   file picker), templates, internal note. Photos show as thumbnails while they
 *   upload, capped to what the text provider allows. If the contact has Do Not
 *   Disturb on it shows a banner and blocks sending a text (but still lets you jot
 *   an internal note).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered inside ThreadView)
 *   Rendered by:  src/pages/tech/v2/messages/ThreadView.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  ./messageUtils drafts, ./useComposerAttachments (MMS tray),
 *              ./useTemplates (canned replies), @/lib/nativeCamera (camera-first
 *              attach on native), @/lib/nativeActionMenu (the native [+] menu),
 *              @/lib/toast
 *   Data:      reads/writes → localStorage draft + Supabase Storage (attachments, via the
 *              hook); the send itself goes through ThreadView → useThread → the worker.
 *
 * NOTES / GOTCHAS:
 *   - Enter behavior is pointer-aware (bake report 2026-07-10): on a TOUCH device
 *     (phone/tablet) Enter inserts a newline like iMessage/Housecall — the field
 *     shows a return key and sending is the button only. On a desktop keyboard
 *     (fine pointer) Enter sends and Shift+Enter is a newline. Font is ≥16px so iOS
 *     never zooms the page on focus.
 *   - A photo can send with no caption (media-only MMS): Send enables once an attachment
 *     has finished uploading, even with no text.
 *   - A template inserts at the caret (not append) so a tech can top-and-tail it.
 *   - Attach is camera-first on native (photo doctrine, owner ruling 2026-08-14), but
 *     its no-plugin fallback is the FILE INPUT, not the camera-direct single shot —
 *     an attach flow that lost album access would be a regression. Picking stages the
 *     files in the tray exactly like the input does; the send path is untouched.
 *   - The native [+] menu's Take Photo / Photo Library rows are an OWNER-DIRECTED
 *     amendment to that doctrine (2026-08-14, same day): on this one surface a menu
 *     precedes the camera, because the owner wants the source split visible in
 *     Apple's own sheet. Take Photo still opens OUR camera, never the stock one.
 *     Do not copy this menu to other photo surfaces — they stay straight-to-camera.
 *   - Presenting the native menu drops the WKWebView keyboard (the web sheet keeps
 *     it via keepKeyboard). Cancel and Internal note refocus the textarea; Take
 *     Photo / Photo Library / Templates open their own surface instead.
 * ════════════════════════════════════════════════
 */
import React, { useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getDraft, setDraft, clearDraft } from '@/components/conversations/messageUtils';
import { useComposerAttachments } from './useComposerAttachments';
import { useTemplates } from './useTemplates';
import { nativeCameraExperienceAvailable, openNativeCameraExperience, pickNativePhotos, isUserCancelled } from '@/lib/nativeCamera';
import { nativeActionMenuAvailable, presentNativeActionMenu } from '@/lib/nativeActionMenu';
import { toast } from '@/lib/toast';

const MAX_LINES = 5;

// Keep the on-screen keyboard up when a composer toolbar button is tapped: preventing
// the default mousedown stops the button from stealing focus from the textarea, so iOS
// doesn't dismiss the keyboard (and the composer never drops). Standard iOS toolbar
// pattern — matches Apple/WhatsApp where the attach menu doesn't close the keyboard.
const keepKeyboard = (e) => e.preventDefault();

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

export default function Composer({
  convId,
  contact,
  onSend,
  sending,
  smsBlocked = false,
}) {
  const { t } = useTranslation(['msgs', 'tech']);
  const [text, setText] = useState(() => getDraft(convId));
  const [isNote, setIsNote] = useState(false);
  const [sheet, setSheet] = useState(null); // null | 'actions' | 'templates'
  const [menuOpen, setMenuOpen] = useState(false); // native [+] sheet on screen
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const plusRef = useRef(null);

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
  const blockedOutbound = !isNote && (blockedByDnd || smsBlocked);

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
    const media = isNote ? [] : readyUrls;
    // Allow a photo-only send (media, no caption); a text or note still needs a body.
    if (blockedOutbound || (!body && media.length === 0)) return;
    if (uploading) return; // wait for attachments to finish
    // Blank synchronously so a same-tick double-Enter can't fire twice.
    if (el) el.value = '';
    setText('');
    clearDraft(convId);
    onSend({ text: body, media_urls: media, isNote });
    clearAttachments();
    setSheet(null);
    // Keep focus for a fast back-and-forth.
    requestAnimationFrame(() => taRef.current?.focus());
  }, [text, blockedOutbound, uploading, isNote, readyUrls, convId, onSend, clearAttachments]);

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
    // Snapshot to a real array BEFORE clearing the input — on iOS WebKit `e.target.files`
    // is a LIVE FileList, so `value = ''` empties it and addFiles would get nothing
    // (parity with legacy Conversations.jsx:674). This was the "pick photos → nothing
    // happens" bug (bake report 2026-07-10).
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    addFiles(files);
    setSheet(null);
  };

  // Camera-first attach (photo doctrine, owner ruling 2026-08-14): a binary carrying
  // the NativeCameraExperience plugin opens the WhatsApp-style camera — viewfinder,
  // recents strip with multi-select badges, album icon — instead of the OS attachment
  // sheet. The returned Files feed addFiles exactly like input-picked ones: staged in
  // the tray, removable, uploaded by the hook. Older binaries and web/PWA keep the
  // plain file input — the camera-direct single-shot fallback has no album, and an
  // attach flow losing album access would be a regression.
  const onAttachPhotos = async () => {
    if (!nativeCameraExperienceAvailable()) {
      fileRef.current?.click();
      return;
    }
    setSheet(null);
    try {
      const files = await openNativeCameraExperience({ allowMultiple: true });
      if (files.length) addFiles(files);
    } catch (e2) {
      if (!isUserCancelled(e2)) toast(t('tech:toast.cameraError', { message: e2.message }), 'error');
    }
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

  // The native [+] menu's Photo Library row: straight into the OS multi-select
  // picker (PHPicker — no permission prompt). Same staging path as the camera.
  const onPickFromLibrary = async () => {
    try {
      const files = await pickNativePhotos();
      if (files.length) addFiles(files);
    } catch (e2) {
      if (!isUserCancelled(e2)) toast(t('tech:toast.albumError', { message: e2.message }), 'error');
    }
  };

  const toggleNote = () => {
    setIsNote((v) => !v);
    setSheet(null);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const openTemplates = () => { loadTemplates(); setSheet('templates'); };

  // The [+] button. In the app it presents Apple's own action sheet (NativeActionMenu
  // plugin) with the owner-approved rows (2026-08-14): Take Photo → OUR custom camera
  // (never the stock one), Photo Library → the OS multi-select picker, then Templates
  // and Internal note. This is the one surface where a menu precedes the camera — the
  // owner-directed attach-flow amendment to the camera-first doctrine; every other
  // photo button stays straight-to-camera. Both plugins must be present so each row
  // does exactly what it says; any miss (older binary, or a launch where
  // isPluginAvailable misreads) degrades to the web-drawn sheet, whose attach flow
  // carries its own camera/file-input fallback. Presenting a native sheet drops the
  // WKWebView keyboard; every exit either opens another surface or refocuses the
  // textarea.
  const toggleActions = async () => {
    if (sheet) { setSheet(null); return; }
    if (nativeActionMenuAvailable() && nativeCameraExperienceAvailable()) {
      // menuOpen mirrors the native sheet's lifetime onto aria-expanded/.active
      // (the [+] otherwise reads "collapsed" while Apple's menu is on screen).
      // It clears the moment the selection resolves — the camera/picker that a
      // row then opens is its own surface, not "the menu still open".
      setMenuOpen(true);
      let selected;
      try {
        selected = await presentNativeActionMenu({
          items: [
            { id: 'takePhoto', title: t('composer.takePhoto'), disabled: isNote },
            { id: 'photoLibrary', title: t('composer.photoLibrary'), disabled: isNote },
            { id: 'templates', title: t('composer.templates') },
            { id: 'note', title: t('composer.note'), checked: isNote },
          ],
          cancelTitle: t('composer.cancel'),
          anchor: plusRef.current,
        });
      } catch {
        // The menu itself failed to present — degrade to the web sheet rather
        // than a dead tap.
        setMenuOpen(false);
        setSheet('actions');
        return;
      }
      setMenuOpen(false);
      if (selected === 'takePhoto') await onAttachPhotos();
      else if (selected === 'photoLibrary') await onPickFromLibrary();
      else if (selected === 'templates') openTemplates();
      else if (selected === 'note') toggleNote();
      else requestAnimationFrame(() => taRef.current?.focus()); // cancelled
      return;
    }
    setSheet((s) => (s ? null : 'actions'));
  };

  // A ready (uploaded) photo can send on its own — text OR media enables Send.
  const hasReadyMedia = !isNote && readyUrls.length > 0;
  const canSend = (!!text.trim() || hasReadyMedia) && !blockedOutbound && !sending && !uploading;

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
              {/* The tile shows the LOCAL blob preview for its whole staged life —
                  a.url is an opaque upr-storage:// reference (the send payload),
                  not something an <img> can load on any shell. The preview is only
                  revoked on remove/unmount, so it stays valid until then. */}
              {(a.localPreview || a.url) && <img src={a.localPreview || a.url} alt="" />}
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
            <div className="tv2-msgs-templates__empty">{t('composer.templatesLoading')}</div>
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

      {/* Actions sheet ([+]) — always mounted so it animates open AND closed (collapse
          via max-height/opacity in CSS, never an unmount; keeps the textarea focused).
          The collapsed sheet is aria-hidden AND its buttons drop out of the tab order
          (tabIndex -1) — max-height/opacity/pointer-events hide it from sight and mouse
          but NOT from the keyboard, so without this a tab lands on invisible controls. */}
      <div
        className={`tv2-msgs-actions-sheet${sheet === 'actions' ? ' open' : ''}`}
        role="menu"
        aria-hidden={sheet !== 'actions'}
      >
          <button
            type="button"
            className="tv2-msgs-action"
            role="menuitem"
            disabled={isNote}
            tabIndex={sheet === 'actions' ? undefined : -1}
            onMouseDown={keepKeyboard}
            onClick={onAttachPhotos}
          >
            <IconImage width={20} height={20} />
            <span>{t('composer.attachPhotos')}</span>
          </button>
          <button type="button" className="tv2-msgs-action" role="menuitem" tabIndex={sheet === 'actions' ? undefined : -1} onMouseDown={keepKeyboard} onClick={openTemplates}>
            <IconTemplate width={20} height={20} />
            <span>{t('composer.templates')}</span>
          </button>
          <button
            type="button"
            className={`tv2-msgs-action${isNote ? ' active' : ''}`}
            role="menuitemcheckbox"
            aria-checked={isNote}
            tabIndex={sheet === 'actions' ? undefined : -1}
            onMouseDown={keepKeyboard}
            onClick={toggleNote}
          >
            <IconNote width={20} height={20} />
            <span>{t('composer.note')}</span>
          </button>
      </div>

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
          ref={plusRef}
          type="button"
          className={`tv2-msgs-plus${sheet || menuOpen ? ' active' : ''}`}
          aria-label={t('composer.moreActions')}
          aria-expanded={!!sheet || menuOpen}
          onMouseDown={keepKeyboard}
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
        </div>

        {/* MSG-06: Send needs keepKeyboard exactly like the two buttons above it.
            Without it, tapping Send moves focus off the textarea, iOS starts
            dismissing the keyboard, and the rAF refocus in doSend re-presents it
            one frame later — a visible flash of the keyboard and, since KB-02,
            of the whole thread as --tv2-msgs-kb drops to 0 and back. The rAF was
            compensating for a blur that should never have happened. */}
        <button
          type="button"
          className="tv2-msgs-send"
          aria-label={t('composer.send')}
          disabled={!canSend}
          onMouseDown={keepKeyboard}
          onClick={doSend}
        >
          <IconSend width={20} height={20} />
        </button>
      </div>
    </div>
  );
}
