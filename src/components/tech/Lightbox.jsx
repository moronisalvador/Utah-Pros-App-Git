/**
 * ════════════════════════════════════════════════
 * FILE: Lightbox.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A full-screen photo viewer. When the tech taps a photo, this fills the
 *   screen with a dark backdrop and the picture. Swiping left/right flips
 *   through the set (real momentum — it is a native scroller underneath),
 *   pinching zooms the photo, double-tapping toggles zoom, and while zoomed
 *   the photo pans with one finger. A counter shows "3 / 12", an optional
 *   caption sits at the bottom, and an X (or tapping the backdrop, or
 *   Escape) closes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (reusable overlay, not a routed page)
 *   Rendered by:  src/pages/tech/TechClaimDetail.jsx,
 *                 src/pages/tech/TechClaimAlbum.jsx,
 *                 src/pages/tech/TechJobDetail.jsx,
 *                 src/pages/tech/TechJobAlbum.jsx,
 *                 src/pages/tech/TechRoomDetail.jsx,
 *                 tech v2 Job Hub, conversations MessageBubble (both shells)
 *
 * DEPENDS ON:
 *   Packages:  none (React 19 automatic JSX runtime)
 *   Internal:  @/lib/techDateUtils (fileUrl — builds a public Storage URL
 *              from a stored file path; absolute URLs pass through)
 *   Data:      reads  → none (the photo list arrives as props)
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
 *   - Gestures follow motion-standard §6 "native scroll first": the swipe
 *     carousel is a scroll-snap scroller and zoomed panning is a nested
 *     native scroller — momentum and rubber-band come from iOS, not JS.
 *     Pinch rides WebKit's gesturestart/gesturechange (WKWebView + iOS
 *     Safari — the entire touch fleet); during the pinch the image scales
 *     via a composited transform and the layout size is committed once on
 *     gestureend. preventDefault() on those events is what stops the PAGE
 *     from zooming (index.html's viewport allows user zoom).
 *   - Only the current photo ±1 get an <img> src, so opening a 50-photo
 *     album does not download 50 originals (perf-budget image law).
 *   - While zoomed the carousel is locked (overflow hidden) so a pan never
 *     flings to the next photo; double-tap (or pinch in) returns to 1x and
 *     unlocks swiping.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fileUrl } from '@/lib/techDateUtils';

const MAX_ZOOM = 4;
const DBL_TAP_ZOOM = 2.5;

// ─── SECTION: Styles (inline on purpose — index.css is at its byte ceiling) ──
const TRACK_STYLE = {
  position: 'absolute', inset: 0, display: 'flex',
  overflowX: 'auto', overflowY: 'hidden',
  scrollSnapType: 'x mandatory', overscrollBehavior: 'contain',
  WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
  touchAction: 'pan-x',
};
const SLIDE_STYLE = {
  flex: '0 0 100%', width: '100%', height: '100%',
  scrollSnapAlign: 'center', scrollSnapStop: 'always', overflow: 'hidden',
};
// The sizer expands with a zoomed image (width:max-content) so native panning
// can reach every edge — a plain flex-centered scroller traps the top-left
// corner behind unreachable negative free space.
const SIZER_STYLE = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minWidth: '100%', minHeight: '100%', width: 'max-content',
};
const IMG_STYLE = {
  maxWidth: '100vw', maxHeight: '85vh', objectFit: 'contain', display: 'block',
};

// ─── SECTION: Render ──────────────
export default function Lightbox({ photos, index, onClose, onIndex, db }) {
  const count = photos?.length || 0;
  const open = count > 0 && index != null && !!photos[index];

  const trackRef = useRef(null);
  // Event handlers (keys, gestures, scroll-settle timers) read the latest
  // index/count through refs, mirrored here after each render.
  const indexRef = useRef(index);
  const countRef = useRef(count);
  useEffect(() => { indexRef.current = index; countRef.current = count; }, [index, count]);
  // Committed zoom of the CURRENT slide: base = displayed size at 1x.
  const zoomRef = useRef({ scale: 1, base: null });
  const pinchRef = useRef(null);
  const settleRef = useRef(null);
  const lastTapRef = useRef(null);

  const activeSlide = useCallback(() => {
    const track = trackRef.current;
    const slide = track?.children?.[indexRef.current] || null;
    return { slide, img: slide?.querySelector('img') || null };
  }, []);

  // Commit a zoom level: grow/shrink the image's layout size so the slide
  // becomes (or stops being) a native 2D pan scroller. cx/cy = focal point
  // in viewport coordinates that should stay put.
  const applyZoom = useCallback((slide, img, nextScale, cx, cy) => {
    if (!slide || !img) return;
    const z = zoomRef.current;
    const track = trackRef.current;
    const scale = Math.min(MAX_ZOOM, Math.max(1, nextScale));
    if (scale <= 1.001) {
      z.scale = 1; z.base = null;
      img.style.transform = ''; img.style.transformOrigin = '';
      img.style.width = ''; img.style.height = '';
      // Restore the 1x clamps EXPLICITLY (never ''): React wrote them as
      // inline style and diffs against its own last value, so a cleared
      // property is not re-stamped and the image would blow up to its
      // natural pixel size.
      img.style.maxWidth = IMG_STYLE.maxWidth; img.style.maxHeight = IMG_STYLE.maxHeight;
      slide.style.overflow = 'hidden';
      slide.scrollLeft = 0; slide.scrollTop = 0;
      if (track) { track.style.overflowX = 'auto'; track.style.scrollSnapType = 'x mandatory'; }
      return;
    }
    if (!z.base) {
      const r = img.getBoundingClientRect();
      z.base = { w: r.width, h: r.height };
    }
    const prev = z.scale;
    z.scale = scale;
    const rect = slide.getBoundingClientRect();
    const fx = (cx ?? rect.left + rect.width / 2) - rect.left;
    const fy = (cy ?? rect.top + rect.height / 2) - rect.top;
    const beforeX = slide.scrollLeft + fx;
    const beforeY = slide.scrollTop + fy;
    img.style.transform = ''; img.style.transformOrigin = '';
    img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    img.style.width = `${z.base.w * scale}px`;
    img.style.height = `${z.base.h * scale}px`;
    slide.style.overflow = 'auto';
    if (track) { track.style.overflowX = 'hidden'; track.style.scrollSnapType = 'none'; }
    slide.scrollLeft = beforeX * (scale / prev) - fx;
    slide.scrollTop = beforeY * (scale / prev) - fy;
  }, []);

  const resetZoom = useCallback(() => {
    const { slide, img } = activeSlide();
    if (slide && img) applyZoom(slide, img, 1);
    else zoomRef.current = { scale: 1, base: null };
  }, [activeSlide, applyZoom]);

  // Arrow/key navigation jumps instantly, and only scrolls — the settle
  // handler is the ONE reporter of index. Hard-won constraints: smooth
  // programmatic scrollTo silently no-ops on mandatory-snap containers in
  // Chrome; reporting onIndex from here re-renders mid-scroll and cancels
  // it; and a bare scrollLeft assignment moves the position WITHOUT moving
  // the container's remembered snap target, so the next relayout (the ±1
  // window mounting an <img>) yanks the carousel back to the old slide.
  // scrollIntoView is the one programmatic path that updates snap memory.
  // Finger swipes get momentum + snap natively; instant is the correct
  // treatment for the desktop arrows (motion-standard §3).
  const goTo = useCallback((i) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(countRef.current - 1, i));
    if (zoomRef.current.scale > 1) resetZoom();
    track.children[clamped]?.scrollIntoView({ behavior: 'auto', inline: 'start', block: 'nearest' });
  }, [resetZoom]);

  const toggleZoom = useCallback((cx, cy) => {
    const { slide, img } = activeSlide();
    if (!slide || !img) return;
    applyZoom(slide, img, zoomRef.current.scale > 1 ? 1 : DBL_TAP_ZOOM, cx, cy);
  }, [activeSlide, applyZoom]);

  // Manual double-tap detector — with touch-action:pan-x iOS keeps taps
  // undelayed but we still cannot rely on dblclick from touch everywhere.
  const handleImgTap = useCallback((e) => {
    if (e.touches?.length || e.changedTouches?.length !== 1) { lastTapRef.current = null; return; }
    const t = e.changedTouches[0];
    const prev = lastTapRef.current;
    const now = Date.now();
    if (prev && now - prev.t < 320 && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 30) {
      lastTapRef.current = null;
      toggleZoom(t.clientX, t.clientY);
    } else {
      lastTapRef.current = { t: now, x: t.clientX, y: t.clientY };
    }
  }, [toggleZoom]);

  // Desktop affordance: Escape closes, arrow keys navigate.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
      else if (event.key === 'ArrowLeft') goTo(indexRef.current - 1);
      else if (event.key === 'ArrowRight') goTo(indexRef.current + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, goTo, onClose]);

  // Position the carousel instantly when the viewer opens, and keep it
  // aligned across rotation. For index changes while open, only reposition
  // on a far parent-driven jump (> 1.5 slides) — an adjacent change is a
  // goTo()/swipe already animating, and an instant scrollTo here would
  // teleport-cancel that smooth scroll mid-flight.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) { wasOpenRef.current = false; return undefined; }
    const track = trackRef.current;
    if (track) {
      const target = index * track.clientWidth;
      const justOpened = !wasOpenRef.current;
      wasOpenRef.current = true;
      if (justOpened || Math.abs(track.scrollLeft - target) > track.clientWidth * 1.5) {
        // scrollIntoView, not scrollTo — see goTo for the snap-memory trap.
        track.children[index]?.scrollIntoView({ behavior: 'auto', inline: 'start', block: 'nearest' });
      }
    }
    const onResize = () => {
      const t = trackRef.current;
      if (!t) return;
      if (zoomRef.current.scale > 1) resetZoom();
      t.children[indexRef.current]?.scrollIntoView({ behavior: 'auto', inline: 'start', block: 'nearest' });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, index, resetZoom]);

  // Pinch zoom via WebKit gesture events (WKWebView / iOS Safari). During
  // the gesture only a composited transform moves; layout commits once at
  // the end. preventDefault stops Safari zooming the whole page.
  useEffect(() => {
    if (!open) return undefined;
    const track = trackRef.current;
    if (!track) return undefined;
    const onStart = (e) => {
      e.preventDefault();
      const { img } = activeSlide();
      if (!img) return;
      const r = img.getBoundingClientRect();
      pinchRef.current = {
        startScale: zoomRef.current.scale,
        cx: e.clientX, cy: e.clientY,
        originX: e.clientX - r.left, originY: e.clientY - r.top,
      };
    };
    const onChange = (e) => {
      e.preventDefault();
      const p = pinchRef.current;
      if (!p) return;
      const { img } = activeSlide();
      if (!img) return;
      const target = Math.min(MAX_ZOOM, Math.max(0.6, p.startScale * e.scale));
      img.style.transformOrigin = `${p.originX}px ${p.originY}px`;
      img.style.transform = `scale(${target / p.startScale})`;
    };
    const onEnd = (e) => {
      e.preventDefault();
      const p = pinchRef.current;
      pinchRef.current = null;
      if (!p) return;
      const { slide, img } = activeSlide();
      if (!slide || !img) return;
      img.style.transform = ''; img.style.transformOrigin = '';
      applyZoom(slide, img, p.startScale * e.scale, p.cx, p.cy);
    };
    track.addEventListener('gesturestart', onStart, { passive: false });
    track.addEventListener('gesturechange', onChange, { passive: false });
    track.addEventListener('gestureend', onEnd, { passive: false });
    return () => {
      track.removeEventListener('gesturestart', onStart);
      track.removeEventListener('gesturechange', onChange);
      track.removeEventListener('gestureend', onEnd);
    };
  }, [open, activeSlide, applyZoom]);

  // Report the slide the carousel landed on. scrollend is the primary
  // signal (it waits for the finger to lift); the 120ms quiet-timer in
  // handleScroll is the fallback for engines without it.
  const reportLanding = useCallback(() => {
    if (zoomRef.current.scale > 1) return;
    const t = trackRef.current;
    if (!t || !t.clientWidth) return;
    const i = Math.round(t.scrollLeft / t.clientWidth);
    if (i !== indexRef.current && i >= 0 && i < countRef.current) onIndex?.(i);
  }, [onIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const track = trackRef.current;
    if (!track) return undefined;
    track.addEventListener('scrollend', reportLanding);
    return () => track.removeEventListener('scrollend', reportLanding);
  }, [open, reportLanding]);

  useEffect(() => () => clearTimeout(settleRef.current), []);

  if (!open) return null;
  const current = photos[index];
  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

  // Quiet-timer fallback for engines without scrollend. Zoomed slides never
  // scroll the track (it is overflow:hidden then), so this is nav-only.
  const handleScroll = () => {
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(reportLanding, 120);
  };

  // Portaled to <body>: an ancestor with a transform / filter / iOS
  // -webkit-overflow-scrolling compositing would otherwise turn this
  // "fixed" overlay into a page-trapped box (the 2026-08-06 native bug —
  // tab bar and composer painting over the photo). At body level no
  // ancestor can capture it.
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)',
      }}
    >
      <div ref={trackRef} style={TRACK_STYLE} onScroll={handleScroll} onClick={onClose}>
        {photos.map((photo, i) => (
          <div key={photo.id || photo.file_path || i} style={SLIDE_STYLE}>
            <div style={SIZER_STYLE}>
              {Math.abs(i - index) <= 1 && (
                <img
                  src={fileUrl(db, photo.file_path)}
                  alt={photo.name || 'Photo'}
                  draggable={false}
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => { e.stopPropagation(); toggleZoom(e.clientX, e.clientY); }}
                  onTouchEnd={handleImgTap}
                  style={IMG_STYLE}
                />
              )}
            </div>
          </div>
        ))}
      </div>

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
        color: '#fff', fontSize: 13, fontWeight: 600, pointerEvents: 'none',
        background: 'rgba(0,0,0,0.35)', padding: '6px 12px', borderRadius: 'var(--radius-full)',
      }}>
        {index + 1} / {photos.length}
      </div>

      {canPrev && (
        <button
          onClick={e => { e.stopPropagation(); goTo(index - 1); }}
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
          onClick={e => { e.stopPropagation(); goTo(index + 1); }}
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
          background: 'rgba(0,0,0,0.55)', color: '#fff', pointerEvents: 'none',
          padding: '10px 14px', borderRadius: 'var(--radius-md)',
          fontSize: 13, lineHeight: 1.4, textAlign: 'center',
        }}>
          {current.description}
        </div>
      )}
    </div>,
    document.body,
  );
}
