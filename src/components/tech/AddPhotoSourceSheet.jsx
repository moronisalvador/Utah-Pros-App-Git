/**
 * ════════════════════════════════════════════════
 * FILE: AddPhotoSourceSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A slide-up panel that appears when a tech taps "Add Photo" on an album
 *   page in the iPhone app. It asks one question: take a new picture with the
 *   camera, or pick pictures that are already in the phone's photo album?
 *   The album choice lets the tech select several photos at once.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bottom sheet)
 *   Rendered by:  TechJobAlbum, TechClaimAlbum, TechRoomDetail,
 *                 TechJobDetail, TechClaimDetail (native app only — on the
 *                 website the hidden file input's own picker covers both)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/useDialogLifecycle
 *   Data:      reads  → none
 *              writes → none — the parent's onTakePhoto / onChooseFromAlbum
 *                        callbacks do the capture + upload
 *
 * NOTES / GOTCHAS:
 *   - Only rendered on the native (Capacitor) path. The OS multi-select album
 *     picker (pickNativePhotos) cannot also offer the camera, which is why
 *     this sheet exists — see nativeCamera.js.
 *   - Label props exist so the i18n'd detail pages can pass translated text;
 *     the album pages are untranslated and use the English defaults.
 *   - Same idiom as AddRoomSheet: tech-fade-in overlay + tech-slide-up panel
 *     (both keyframes already carry the reduced-motion collapse in index.css),
 *     useDialogLifecycle for focus trap / Escape / aria-modal.
 * ════════════════════════════════════════════════
 */
import { useRef } from 'react';
import { useDialogLifecycle } from '@/lib/useDialogLifecycle';

export default function AddPhotoSourceSheet({
  open,
  onClose,
  onTakePhoto,
  onChooseFromAlbum,
  title = 'Add photos',
  takeLabel = 'Take photo',
  chooseLabel = 'Choose from album',
  chooseSub = 'Select one or several',
  cancelLabel = 'Cancel',
}) {
  const panelRef = useRef(null);
  const dialogProps = useDialogLifecycle({ open, onClose, panelRef });

  if (!open) return null;

  const optionStyle = {
    display: 'flex', alignItems: 'center', gap: 12,
    width: '100%', padding: '14px 14px', minHeight: 60,
    borderRadius: 'var(--tech-radius-button, 14px)', textAlign: 'left',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border-light)',
    cursor: 'pointer', fontFamily: 'var(--font-sans)',
    WebkitTapHighlightColor: 'transparent',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'tech-fade-in var(--motion-duration-fast, 120ms) var(--motion-ease-standard, ease-out)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        ref={panelRef}
        {...dialogProps}
        aria-label={title}
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '10px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
          animation: 'tech-slide-up var(--motion-duration-base, 220ms) var(--motion-ease-decelerate, ease-out)',
        }}
      >
        <div style={{
          width: 36, height: 4, background: 'var(--border-color)',
          borderRadius: 2, margin: '0 auto 12px',
        }} />
        <div style={{
          fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
          marginBottom: 10, textAlign: 'center',
        }}>
          {title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onTakePhoto} style={optionStyle}>
            <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {takeLabel}
            </span>
          </button>
          <button onClick={onChooseFromAlbum} style={optionStyle}>
            <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                {chooseLabel}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>
                {chooseSub}
              </span>
            </span>
          </button>
        </div>
        <button
          onClick={onClose}
          style={{
            // 44px documented-secondary target (tech-mobile-ux.md), matching
            // the sibling job-picker sheets' Cancel.
            marginTop: 14, width: '100%', minHeight: 44,
            borderRadius: 'var(--tech-radius-button, 14px)',
            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
            border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
