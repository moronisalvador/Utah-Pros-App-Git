/**
 * TOAST-01 — the tech toast must survive a resume, be reachable, and be announced.
 *
 * Toasts are the app's mandated feedback channel: CLAUDE.md Rule 2 bans alert()
 * and confirm(), so a toast is how a tech is told anything at all. Four defects
 * meant that channel could fail silently.
 *
 * Source-contract assertions — vitest runs `node` here with no jsdom, so
 * TechLayout cannot be rendered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const layout = read('src/components/TechLayout.jsx');

describe('TOAST-01 — the timer survives being backgrounded', () => {
  it('tracks an expiry timestamp rather than a fire-and-forget timeout', () => {
    // `setTimeout(remove, 5000)` counts down while the app is suspended. A tech
    // taps Save, switches to the camera, comes back — and the confirmation is
    // already gone. A timestamp can be re-derived; an elapsed timeout cannot.
    expect(layout).toContain('expiresAt: Date.now() + TOAST_VISIBLE_MS');
    expect(layout).not.toContain('setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)');
  });

  it('gives back any toast that ran out while nobody was looking', () => {
    expect(layout).toContain("if (document.visibilityState !== 'visible') return;");
    expect(layout).toContain('expiresAt: now + TOAST_RESUME_MIN_MS');
  });

  it('returns the same array when no toast needed extending', () => {
    // A fresh array on every resume would re-run the expiry effect for nothing.
    expect(layout).toContain('return changed ? next : prev;');
  });

  it('does not resurrect a toast that is already leaving', () => {
    expect(layout).toContain('if (t.leaving || t.expiresAt - now >= TOAST_RESUME_MIN_MS) return t;');
  });

  it('schedules one timer for the nearest expiry, not one per toast', () => {
    expect(layout).toContain('const soonest = Math.min(...live.map(t => t.expiresAt));');
  });
});

describe('TOAST-01 — the close control is reachable', () => {
  it('meets the documented-secondary 44px floor', () => {
    // Was padding:0 around a 16px glyph — roughly a 16px target, under the 24px
    // hit-area floor tech-mobile-ux.md bans outright, on a control a 64-year-old
    // tech taps with gloves on.
    const btn = layout.slice(layout.indexOf('aria-label="Dismiss notification"'));
    expect(btn.slice(0, 400)).toContain('minWidth:44,minHeight:44');
  });

  it('is announced as something other than a bare glyph', () => {
    expect(layout).toContain('aria-label="Dismiss notification"');
  });

  it('hides the decorative status emoji from screen readers', () => {
    // The role and the text already carry the meaning; the emoji would be read
    // out as "cross mark" before the message.
    expect(layout).toContain('<span aria-hidden="true" style={{fontSize:20');
  });
});

describe('TOAST-01 — the live region', () => {
  it('marks the container as a polite live region', () => {
    // loading-error-states.md §4: "Both toast containers carry role='status'
    // aria-live='polite' (errors role='alert')".
    expect(layout).toContain('role="status"');
    expect(layout).toContain('aria-live="polite"');
  });

  it('escalates an error to assertive', () => {
    expect(layout).toContain("role={toast.type === 'error' ? 'alert' : undefined}");
  });

  it('keeps the region mounted when empty', () => {
    // A live region announces what is inserted INTO an already-present node.
    // Mounting the region and its first toast together announces neither, which
    // is what the previous `{toasts.length > 0 && (` guard did.
    expect(layout).not.toContain('{toasts.length > 0 && (');
  });
});

describe('TOAST-01 — the exit phase', () => {
  it('animates out instead of vanishing', () => {
    // motion-standard.md §3: every enter has an exit, and an instant removal is
    // a defect. Exit is ~75% of the enter (250ms → 180ms) on an accelerate ease.
    expect(layout).toContain("animation: toast.leaving ? 'toastOut 0.18s ease-in forwards' : 'slideUp 0.25s ease'");
    expect(layout).toContain('@keyframes toastOut');
  });

  it('unmounts on the exit animation ending', () => {
    expect(layout).toContain("if (toast.leaving && e.animationName === 'toastOut') dropToast(toast.id);");
  });

  it('carries a safety net if that animation never fires', () => {
    // A backgrounded tab or a display:none ancestor can mean animationend never
    // arrives, which would strand the toast on screen permanently. Modal.jsx
    // carries the same backstop.
    expect(layout).toContain('TOAST_EXIT_FALLBACK_MS');
    expect(layout).toContain('setTimeout(() => dropToast(t.id), TOAST_EXIT_FALLBACK_MS)');
  });

  it('starts the exit idempotently', () => {
    // A double-tap on the close button must not queue two exits.
    expect(layout).toContain('t.id === id && !t.leaving');
  });

  it('expires through the same exit path as a manual dismiss', () => {
    // Otherwise a timed-out toast vanishes while a hand-dismissed one animates —
    // two different disappearances for the same event.
    expect(layout).toContain('.forEach(t => startLeaving(t.id));');
  });
});

describe('TOAST-01 — reduced motion is already covered', () => {
  it('relies on the MOTION-02 global floor rather than a local block', () => {
    // Both keyframes are inline in TechLayout, so they were never reachable by a
    // hand-written rule in index.css. The universal floor collapses them.
    const css = read('src/index.css');
    expect(css).toContain('MOTION-02: global Reduce Motion floor');
    expect(css).toContain('animation-duration: 0.01ms !important;');
  });
});
