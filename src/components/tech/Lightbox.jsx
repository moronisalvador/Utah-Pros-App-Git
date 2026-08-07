/**
 * ════════════════════════════════════════════════
 * FILE: Lightbox.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A full-screen photo viewer. When the tech taps a photo, this fills the
 *   screen with a dark backdrop and the picture, with left/right arrows to
 *   flip through the set, a counter (like "3 / 12"), an optional caption at
 *   the bottom, and an X to close. Tapping the backdrop also closes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable overlay, not a routed page)
 *   Rendered by:  src/pages/tech/TechClaimDetail.jsx,
 *                 src/pages/tech/TechClaimAlbum.jsx,
 *                 src/pages/tech/TechJobDetail.jsx,
 *                 src/pages/tech/TechJobAlbum.jsx,
 *                 src/pages/tech/TechRoomDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  @/lib/techDateUtils (fileUrl — builds a public Storage URL
 *              from a stored file path)
 *   Data:      reads  → none (the photo list arrives as props; only builds
 *                        public Storage URLs from the paths)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Props: photos (array), index (current photo, null = hidden), onClose,
 *     onIndex (called with the new index), db (used by fileUrl).
 *   - Self-contained on purpose — no entity-specific props — so any photo
 *     screen can reuse it.
 *   - Returns null (renders nothing) when there are no photos or index is null.
 *   - Top/bottom chrome offsets by env(safe-area-inset-*): with
 *     viewport-fit=cover the native app/PWA draws under the iOS status bar,
 *     so a plain top:16 puts the ✕ behind the clock/battery icons.
 * ════════════════════════════════════════════════
 */
import { useEffect } from 'react';
import { fileUrl } from '@/lib/techDateUtils';

// ─── SECTION: Render ──────────────
export default function Lightbox({ photos, index, onClose, onIndex, db }) {
  const count = photos?.length || 0;
  const open = count > 0 && index != null && !!photos[index];

  // Desktop affordance: Escape closes, arrow keys navigate. Touch surfaces
  // are unaffected. Registered only while open, before the early return so
  // the hook order is stable.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
      else if (event.key === 'ArrowLeft' && index > 0) onIndex?.(index - 1);
      else if (event.key === 'ArrowRight' && index < count - 1) onIndex?.(index + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, index, count, onClose, onIndex]);

  if (!open) return null;
  const current = photos[index];
  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onClose(); }}
        aria-label="Close album"
        style={{
          position: 'absolute', top: 'calc(16px + env(safe-area-inset-top, 0px))', right: 16,
          background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
          fontSize: 22, lineHeight: 1, cursor: 'pointer',
          minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      <div style={{
        position: 'absolute', top: 'calc(16px + env(safe-area-inset-top, 0px))', left: 16,
        color: '#fff', fontSize: 13, fontWeight: 600,
        background: 'rgba(0,0,0,0.35)', padding: '6px 12px', borderRadius: 'var(--radius-full)',
      }}>
        {index + 1} / {photos.length}
      </div>

      <img
        src={fileUrl(db, current.file_path)}
        alt={current.name || 'Photo'}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain',
          touchAction: 'pinch-zoom',
        }}
      />

      {canPrev && (
        <button
          onClick={e => { e.stopPropagation(); onIndex(index - 1); }}
          aria-label="Previous photo"
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {canNext && (
        <button
          onClick={e => { e.stopPropagation(); onIndex(index + 1); }}
          aria-label="Next photo"
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {current.description && (
        <div style={{
          position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))', left: 20, right: 20,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          padding: '10px 14px', borderRadius: 'var(--radius-md)',
          fontSize: 13, lineHeight: 1.4, textAlign: 'center',
        }}>
          {current.description}
        </div>
      )}
    </div>
  );
}
