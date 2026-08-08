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
 *     Safari — the entire touch fleet): rAF-batched translate+scale preview
 *     that tracks the fingers' drift, two-finger touches frozen so the
 *     native scrollers never pan underneath, and a release commit whose
 *     scroll correction is MEASURED from the landed layout so the handoff
 *     is pixel-identical (assumption math here caused 99.1's release jump).
 *     preventDefault() on those events is what stops the PAGE from zooming
 *     (index.html's viewport allows user zoom).
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
import { nativePhotoViewerAvailable, presentNativePhotos } from '@/lib/nativePhotoViewer';
import { nativeShareAvailable, shareNative, anchorFromEvent } from '@/lib/nativeShare';

// Is there any real way to share on this device? The native plugin gives a
// true share sheet ("Save Image"); an installed PWA can fall back to the Web
// Share API. If neither exists the control is not rendered at all.
const canShare = () => {
  try {
    return nativeShareAvailable() || typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  } catch {
    return false;
  }
};

const MAX_ZOOM = 4;
const DBL_TAP_ZOOM = 2.5;
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
  // becomes (or stops being) a native 2D pan scroller. F = the focal point
  // in viewport coords; q = the image point currently under F, in the
  // OUTGOING layout's px. The scroll correction is MEASURED after the
  // layout write (getBoundingClientRect flushes), all synchronously before
  // paint — assumption-based math here is what caused the visible jump on
  // pinch release in build 99.1.
  const commitZoom = useCallback((slide, img, targetScale, F, q) => {
    if (!slide || !img) return { s0: 1, s1: 1 };
    const z = zoomRef.current;
    const track = trackRef.current;
    const s0 = z.scale || 1;
    const s1 = Math.min(MAX_ZOOM, Math.max(1, targetScale));
    img.style.transform = ''; img.style.transformOrigin = '';
    if (s1 <= 1.001) {
      z.scale = 1; z.base = null;
      img.style.width = ''; img.style.height = '';
      // Restore the 1x clamps EXPLICITLY (never ''): React wrote them as
      // inline style and diffs against its own last value, so a cleared
      // property is not re-stamped and the image would blow up to its
      // natural pixel size.
      img.style.maxWidth = IMG_STYLE.maxWidth; img.style.maxHeight = IMG_STYLE.maxHeight;
      slide.style.overflow = 'hidden';
      slide.scrollLeft = 0; slide.scrollTop = 0;
      if (track) { track.style.overflowX = 'auto'; track.style.scrollSnapType = 'x mandatory'; }
      return { s0, s1: 1 };
    }
    if (!z.base) {
      const r = img.getBoundingClientRect();
      z.base = { w: r.width / s0, h: r.height / s0 };
    }
    z.scale = s1;
    img.style.maxWidth = 'none'; img.style.maxHeight = 'none';
    img.style.width = `${z.base.w * s1}px`;
    img.style.height = `${z.base.h * s1}px`;
    slide.style.overflow = 'auto';
    if (track) { track.style.overflowX = 'hidden'; track.style.scrollSnapType = 'none'; }
    if (F && q) {
      const rNew = img.getBoundingClientRect();
      const cx = q.x * (s1 / s0);
      const cy = q.y * (s1 / s0);
      slide.scrollLeft += (rNew.left + cx) - F.x;
      slide.scrollTop += (rNew.top + cy) - F.y;
    }
    return { s0, s1 };
  }, []);

  const resetZoom = useCallback(() => {
    const { slide, img } = activeSlide();
    if (slide && img) commitZoom(slide, img, 1);
    else zoomRef.current = { scale: 1, base: null };
  }, [activeSlide, commitZoom]);

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

  // Double-tap toggle, animated FLIP-style: land in the final layout first,
  // then play the old scale collapsing into it — layout is written once, the
  // motion is pure composited transform (motion-standard §5).
  const toggleZoom = useCallback((cx, cy) => {
    const { slide, img } = activeSlide();
    if (!slide || !img) return;
    const rect = img.getBoundingClientRect();
    const F = { x: cx ?? rect.left + rect.width / 2, y: cy ?? rect.top + rect.height / 2 };
    const q = {
      x: Math.min(Math.max(F.x - rect.left, 0), rect.width),
      y: Math.min(Math.max(F.y - rect.top, 0), rect.height),
    };
    const zoomingIn = zoomRef.current.scale <= 1;
    const { s0, s1 } = commitZoom(slide, img, zoomingIn ? DBL_TAP_ZOOM : 1, F, q);
    if (reducedMotion() || !img.animate || s0 === s1) return;
    if (s1 > 1) {
      img.style.transformOrigin = `${q.x * (s1 / s0)}px ${q.y * (s1 / s0)}px`;
      const anim = img.animate(
        [{ transform: `scale(${s0 / s1})` }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      anim.onfinish = () => { img.style.transformOrigin = ''; };
    } else {
      img.animate(
        [{ transform: `scale(${Math.min(s0, DBL_TAP_ZOOM)})` }, { transform: 'scale(1)' }],
        { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    }
  }, [activeSlide, commitZoom]);

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

  // Pinch zoom via WebKit gesture events (WKWebView / iOS Safari — the whole
  // touch fleet). Apple-feel rules learned from build 99.1's stutter+jump:
  // the preview tracks BOTH the pinch scale and the fingers' centroid drift
  // (translate + scale, so pinch-and-drag works like Photos); style writes
  // are rAF-batched, one per frame; two-finger touches are prevented so the
  // native scrollers never pan underneath the pinch; and the release commit
  // derives the focal point from the exact previewed transform, then
  // commitZoom measures the landed layout — pixel-identical handoff, no
  // settle jump. preventDefault on the gesture events is also what stops
  // Safari zooming the whole page.
  useEffect(() => {
    if (!open) return undefined;
    const track = trackRef.current;
    if (!track) return undefined;
    let raf = 0;
    const render = () => {
      raf = 0;
      const p = pinchRef.current;
      if (!p) return;
      const { img } = activeSlide();
      if (!img) return;
      // Clamp the VISUAL scale: past-fit pinch-in previews (rubber-band) are
      // allowed down to 0.45 and commit back to fit on release.
      const visual = Math.min(MAX_ZOOM * 1.15, Math.max(0.45, p.startScale * p.lastScale));
      p.appliedK = visual / p.startScale;
      const dx = p.lastCx - p.startCx;
      const dy = p.lastCy - p.startCy;
      img.style.transformOrigin = `${p.ox}px ${p.oy}px`;
      img.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${p.appliedK})`;
    };
    const onStart = (e) => {
      e.preventDefault();
      const { img } = activeSlide();
      if (!img) return;
      const r = img.getBoundingClientRect();
      pinchRef.current = {
        r0: r,
        startScale: zoomRef.current.scale || 1,
        startCx: e.clientX, startCy: e.clientY,
        lastCx: e.clientX, lastCy: e.clientY,
        lastScale: 1, appliedK: 1,
        ox: e.clientX - r.left, oy: e.clientY - r.top,
      };
    };
    const onChange = (e) => {
      e.preventDefault();
      const p = pinchRef.current;
      if (!p) return;
      p.lastScale = e.scale;
      p.lastCx = e.clientX; p.lastCy = e.clientY;
      if (!raf) raf = requestAnimationFrame(render);
    };
    const onEnd = (e) => {
      e.preventDefault();
      const p = pinchRef.current;
      pinchRef.current = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!p) return;
      const { slide, img } = activeSlide();
      if (!slide || !img) return;
      const k = p.appliedK;
      const dx = p.lastCx - p.startCx;
      const dy = p.lastCy - p.startCy;
      // The image point currently under the fingers' centroid, inverted from
      // the previewed transform: screen = r0.tl + o + (q − o)·k + d.
      const q = {
        x: p.ox + (p.lastCx - p.r0.left - dx - p.ox) / k,
        y: p.oy + (p.lastCy - p.r0.top - dy - p.oy) / k,
      };
      const F = { x: p.lastCx, y: p.lastCy };
      const { s0, s1 } = commitZoom(slide, img, p.startScale * k, F, q);
      // A past-fit pinch-in settles back to fit with a quick scale collapse.
      if (s1 === 1 && s0 * k < 1 && !reducedMotion() && img.animate) {
        img.animate(
          [{ transform: `scale(${Math.max(0.45, s0 * k)})` }, { transform: 'scale(1)' }],
          { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      }
    };
    // Two-finger touches never reach the native scrollers: without this the
    // slide (zoomed) or the carousel pans underneath the pinch preview.
    const freezeMultiTouch = (ev) => { if (ev.touches.length > 1) ev.preventDefault(); };
    track.addEventListener('gesturestart', onStart, { passive: false });
    track.addEventListener('gesturechange', onChange, { passive: false });
    track.addEventListener('gestureend', onEnd, { passive: false });
    track.addEventListener('touchstart', freezeMultiTouch, { passive: false });
    track.addEventListener('touchmove', freezeMultiTouch, { passive: false });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      track.removeEventListener('gesturestart', onStart);
      track.removeEventListener('gesturechange', onChange);
      track.removeEventListener('gestureend', onEnd);
      track.removeEventListener('touchstart', freezeMultiTouch);
      track.removeEventListener('touchmove', freezeMultiTouch);
    };
  }, [open, activeSlide, commitZoom]);

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

  // Native app: hand the whole viewing session to the Swift viewer
  // (UIScrollView physics — Apple's own pinch/pan/swipe). The web overlay
  // below never mounts there; when the tech closes the native viewer the
  // promise resolves and we report onClose so the parent clears its index.
  const nativeSessionRef = useRef(false);
  useEffect(() => {
    if (!open || !nativePhotoViewerAvailable() || nativeSessionRef.current) return;
    nativeSessionRef.current = true;
    const items = photos
      .map((photo, i) => ({ photo, i, url: photo.file_path ? fileUrl(db, photo.file_path) : null }))
      .filter(x => typeof x.url === 'string' && /^https?:\/\//i.test(x.url));
    if (!items.length) {
      nativeSessionRef.current = false;
      onClose?.();
      return;
    }
    presentNativePhotos({
      urls: items.map(x => x.url),
      captions: items.map(x => x.photo.description || ''),
      startIndex: Math.max(0, items.findIndex(x => x.i === index)),
    })
      .catch(() => {})
      .finally(() => {
        nativeSessionRef.current = false;
        onClose?.();
      });
  }, [open, photos, index, db, onClose]);

  // Share the photo on screen. Native plugin first (a real share sheet with
  // "Save Image"); otherwise the Web Share API, which an installed PWA has.
  // Evaluated once per render rather than in state — it cannot change mid-session.
  const canShareCurrent = canShare();
  const shareCurrent = useCallback(async (e) => {
    e.stopPropagation();
    const photo = photos?.[index];
    const url = photo?.file_path ? fileUrl(db, photo.file_path) : null;
    if (!url) return;
    try {
      if (nativeShareAvailable()) {
        await shareNative({ url, title: photo.description || undefined, anchor: anchorFromEvent(e) });
      } else if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ url, title: photo.description || undefined });
      }
    } catch { /* the tech cancelled the sheet — not an error */ }
  }, [photos, index, db]);

  if (!open) return null;
  if (nativePhotoViewerAvailable()) return null;
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

      {/* Share — only rendered when a share mechanism actually exists, so a
          tech is never shown a button that does nothing. Native plugin first
          (real "Save Image"), else the Web Share API in an installed PWA. */}
      {canShareCurrent && (
        <button
          onClick={shareCurrent}
          aria-label="Share photo"
          style={{
            position: 'absolute', top: 'calc(16px + env(safe-area-inset-top, 0px))', right: 72,
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            fontSize: 20, lineHeight: 1, cursor: 'pointer',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
          </svg>
        </button>
      )}

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
