/**
 * Unit + render smoke-tests for the UX-Quality F-S2 shared hooks.
 * Vitest runs in plain node (no jsdom): pure helpers are tested directly, and the
 * stateful hooks are exercised via renderToStaticMarkup probe components that read
 * their INITIAL return values (renderToStaticMarkup runs the render body but not
 * effects — enough to prove the initial contract).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { subscribeResume } from '@/hooks/useResumeRefetch';

// useLookup / usePhotoUpload import the Supabase-backed auth+realtime client at
// module eval; this test exercises only pure helpers + the registry, so stub those
// seams (vi.mock is hoisted above the imports) to avoid needing live Supabase env vars.
vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: {}, employee: null }) }));

import { thumbUrl, publicUrl } from '@/hooks/usePhotoUpload';
import { LOOKUPS } from '@/hooks/useLookup';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';

const BASE = 'https://proj.supabase.co';

describe('usePhotoUpload URL helpers', () => {
  it('thumbUrl builds a render-image URL with width + quality', () => {
    const u = thumbUrl('job123/456-photo.jpg', { width: 300, quality: 55, baseUrl: BASE });
    expect(u).toContain('/storage/v1/render/image/public/job-files/job123/456-photo.jpg');
    expect(u).toContain('width=300');
    expect(u).toContain('quality=55');
  });
  it('thumbUrl strips a legacy job-files/ prefix so it is not doubled', () => {
    const u = thumbUrl('job-files/j/1-a.jpg', { baseUrl: BASE });
    expect(u).toContain('/public/job-files/j/1-a.jpg');
    expect(u).not.toContain('job-files/job-files');
  });
  it('publicUrl builds the full-resolution object URL', () => {
    expect(publicUrl('j/1-a.jpg', BASE)).toBe(`${BASE}/storage/v1/object/public/job-files/j/1-a.jpg`);
  });
  it('both return empty string for a missing path', () => {
    expect(thumbUrl('', { baseUrl: BASE })).toBe('');
    expect(publicUrl(null, BASE)).toBe('');
  });
});

describe('useLookup registry', () => {
  it('exposes the three canonical rosters with column-named selects (no select=*)', () => {
    expect(Object.keys(LOOKUPS).sort()).toEqual(['carriers', 'employees', 'job_phases']);
    for (const spec of Object.values(LOOKUPS)) {
      expect(spec.table).toBeTruthy();
      expect(spec.query).not.toContain('select=*');
    }
    expect(LOOKUPS.employees.query).toContain('is_active=eq.true');
  });
});

// Probe components: read a hook's initial return and print it into the markup.
function ConfirmProbe() {
  const { isArmed, armedKey } = useTwoClickConfirm();
  return <span data-armed={String(armedKey)} data-is-armed={String(isArmed('x'))} />;
}
function ResumeProbe() {
  useResumeRefetch({ onResume: () => {} });
  return <span>ok</span>;
}

describe('stateful hooks initial contract', () => {
  it('useTwoClickConfirm starts disarmed', () => {
    const out = renderToStaticMarkup(<ConfirmProbe />);
    expect(out).toContain('data-armed="null"');
    expect(out).toContain('data-is-armed="false"');
  });
  it('useResumeRefetch renders without throwing and returns nothing (side-effect hook)', () => {
    expect(renderToStaticMarkup(<ResumeProbe />)).toContain('ok');
  });
});

// ── subscribeResume behavior (the effect body, tested via injected fake DOM targets
//    + fake timers — the repo's vitest runs in plain node, so no jsdom is available). ──
function makeTarget(props = {}) {
  const listeners = {};
  return {
    ...props,
    addEventListener(type, fn) { (listeners[type] ||= new Set()).add(fn); },
    removeEventListener(type, fn) { listeners[type]?.delete(fn); },
    dispatch(type) { [...(listeners[type] || [])].forEach((fn) => fn()); },
    count(type) { return listeners[type]?.size || 0; },
  };
}

describe('subscribeResume behavior', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onResume once on a real hidden→visible edge (hiddenEdgeOnly)', () => {
    const onResume = vi.fn();
    const doc = makeTarget({ visibilityState: 'visible', hidden: false });
    const win = makeTarget();
    subscribeResume({ doc, win, getOnResume: () => onResume, getOnFocus: () => null, hiddenEdgeOnly: true });

    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');       // hidden — arms wasHidden, no fire
    expect(onResume).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');       // visible again — the edge → fire once
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onResume on visible→visible (no edge) when hiddenEdgeOnly', () => {
    const onResume = vi.fn();
    const doc = makeTarget({ visibilityState: 'visible', hidden: false });
    const win = makeTarget();
    subscribeResume({ doc, win, getOnResume: () => onResume, getOnFocus: () => null, hiddenEdgeOnly: true });
    doc.dispatch('visibilitychange');       // still visible, never hidden → no fire
    expect(onResume).not.toHaveBeenCalled();
  });

  it('fires onResume on any visible dispatch when hiddenEdgeOnly is false', () => {
    const onResume = vi.fn();
    const doc = makeTarget({ visibilityState: 'visible', hidden: false });
    const win = makeTarget();
    subscribeResume({ doc, win, getOnResume: () => onResume, getOnFocus: () => null, hiddenEdgeOnly: false });
    doc.dispatch('visibilitychange');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('poll skips while hidden and runs while visible', () => {
    const onResume = vi.fn();
    const doc = makeTarget({ visibilityState: 'visible', hidden: true });
    const win = makeTarget();
    subscribeResume({ doc, win, getOnResume: () => onResume, getOnFocus: () => null, pollMs: 1000 });

    vi.advanceTimersByTime(1000);           // hidden → skip
    expect(onResume).not.toHaveBeenCalled();
    doc.hidden = false;
    vi.advanceTimersByTime(1000);           // visible → run
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('attaches the focus listener unconditionally so a late onFocus still fires', () => {
    let onFocus = null;                     // starts unset
    const doc = makeTarget({ visibilityState: 'visible', hidden: false });
    const win = makeTarget();
    subscribeResume({ doc, win, getOnResume: () => null, getOnFocus: () => onFocus });
    expect(win.count('focus')).toBe(1);     // listener attached despite null callback
    win.dispatch('focus');                  // no-op, no throw
    onFocus = vi.fn();                       // provided later
    win.dispatch('focus');
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('cleanup removes listeners and stops the poll', () => {
    const onResume = vi.fn();
    const doc = makeTarget({ visibilityState: 'visible', hidden: false });
    const win = makeTarget();
    const cleanup = subscribeResume({ doc, win, getOnResume: () => onResume, getOnFocus: () => null, pollMs: 1000 });
    expect(doc.count('visibilitychange')).toBe(1);
    expect(win.count('focus')).toBe(1);
    cleanup();
    expect(doc.count('visibilitychange')).toBe(0);
    expect(win.count('focus')).toBe(0);
    vi.advanceTimersByTime(5000);           // interval cleared → no fire
    expect(onResume).not.toHaveBeenCalled();
  });
});
