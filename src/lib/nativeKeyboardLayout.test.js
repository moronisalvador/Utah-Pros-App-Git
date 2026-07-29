/**
 * KB-01 — the shared keyboard-inset port.
 *
 * The web adapter's algorithm is the one proven on-device in ThreadView
 * (2026-07-10: iH479 vv479 oT415). These cases pin the parts that were
 * silently wrong before it existed: measuring against window.innerHeight
 * (which tracks the VISUAL viewport on iOS 26, so the occlusion computes 0),
 * and never clearing a stale inset.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const isNativePlatform = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

const { KB_INSET_VAR, observeKeyboardInset, readKeyboardInset } = await import('./nativeKeyboardLayout.js');

// This lane runs in plain node (vitest.config.js environment: 'node') and the
// repo ships no jsdom — so stub exactly the surface the module touches rather
// than pulling in a DOM just for this file.
function makeViewport(height, offsetTop = 0) {
  const listeners = new Map();
  return {
    height,
    offsetTop,
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    removeEventListener: (type) => { listeners.delete(type); },
    emit() { listeners.get('resize')?.(); },
    set(next, top = 0) { this.height = next; this.offsetTop = top; this.emit(); },
    listenerCount: () => listeners.size,
  };
}

function makeDocument() {
  const props = new Map();
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    documentElement: {
      style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: (k) => props.delete(k),
        getPropertyValue: (k) => props.get(k) ?? '',
      },
    },
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    removeEventListener: (type) => { listeners.delete(type); },
    fire: (type) => listeners.get(type)?.(),
    hasListener: (type) => listeners.has(type),
  };
}

let vv;
let doc;
const readVar = () => doc.documentElement.style.getPropertyValue(KB_INSET_VAR);

beforeEach(() => {
  vv = makeViewport(800);
  doc = makeDocument();
  vi.stubGlobal('window', { visualViewport: vv });
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  isNativePlatform.mockReturnValue(false);
  vi.unstubAllGlobals();
});

describe('KB-01 web adapter', () => {
  it('publishes nothing while the keyboard is closed', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    expect(readKeyboardInset()).toBe(0);
    expect(readVar()).toBe('');
    off();
  });

  it('treats the tallest height seen as the closed baseline', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    vv.set(460);                    // keyboard up, no iOS pan
    expect(readKeyboardInset()).toBe(340);
    expect(readVar()).toBe('340px');
    off();
  });

  it('lifts only the residual iOS has not already panned', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    // iOS panned 300 of the 340 occlusion; lifting the full amount would float
    // a docked control far above the keyboard.
    vv.set(460, 300);
    expect(readKeyboardInset()).toBe(40);
    off();
  });

  it('ignores URL-bar jitter below the keyboard threshold', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    vv.set(760);                    // 40px — not a keyboard
    expect(readKeyboardInset()).toBe(0);
    off();
  });

  it('returns to zero when the keyboard closes', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    vv.set(460);
    expect(readKeyboardInset()).toBe(340);
    vv.set(800);
    expect(readKeyboardInset()).toBe(0);
    expect(readVar()).toBe('');
    off();
  });

  it('clears a stale inset when the app is resumed', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    vv.set(460);
    expect(readKeyboardInset()).toBe(340);
    // iOS can resume with the keyboard already dismissed and deliver no event.
    doc.fire('visibilitychange');
    expect(readKeyboardInset()).toBe(0);
    off();
  });
});

describe('KB-01 subscriber lifecycle', () => {
  it('attaches once for several screens and detaches on the last release', async () => {
    const a = observeKeyboardInset();
    const b = observeKeyboardInset();
    await Promise.resolve();
    expect(vv.listenerCount()).toBeGreaterThan(0);
    a();
    expect(vv.listenerCount()).toBeGreaterThan(0);   // b still needs it
    b();
    expect(vv.listenerCount()).toBe(0);
  });

  it('clears the variable when the last subscriber leaves', async () => {
    const off = observeKeyboardInset();
    await Promise.resolve();
    vv.set(460);
    expect(readVar()).toBe('340px');
    off();
    expect(readVar()).toBe('');
  });

  it('is idempotent, so a double unmount cannot underflow the count', async () => {
    const a = observeKeyboardInset();
    const b = observeKeyboardInset();
    await Promise.resolve();
    a(); a(); a();                                   // React can unmount twice
    expect(vv.listenerCount()).toBeGreaterThan(0);   // b's subscription survives
    b();
    expect(vv.listenerCount()).toBe(0);
  });
});

describe('KB-01 change subscription', () => {
  it('pushes changes to a listener instead of making it poll', async () => {
    const seen = [];
    const off = observeKeyboardInset((px) => seen.push(px));
    await Promise.resolve();
    vv.set(460);
    vv.set(800);
    expect(seen).toEqual([340, 0]);
    off();
  });

  it('does not re-notify when the value has not actually changed', async () => {
    const seen = [];
    const off = observeKeyboardInset((px) => seen.push(px));
    await Promise.resolve();
    vv.set(460);
    vv.emit();                       // same geometry, fires again
    vv.emit();
    expect(seen).toEqual([340]);     // one notification, not three
    off();
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const seen = [];
    const off = observeKeyboardInset((px) => seen.push(px));
    const keepAlive = observeKeyboardInset();
    await Promise.resolve();
    off();
    vv.set(460);
    expect(seen).toEqual([]);
    keepAlive();
  });

  it('survives a listener that throws, so the others still update', async () => {
    const seen = [];
    const bad = observeKeyboardInset(() => { throw new Error('consumer blew up'); });
    const good = observeKeyboardInset((px) => seen.push(px));
    await Promise.resolve();
    expect(() => vv.set(460)).not.toThrow();
    expect(seen).toEqual([340]);
    bad(); good();
  });
});

describe('KB-01 native adapter', () => {
  it('never measures on native — it uses the reported height', async () => {
    isNativePlatform.mockReturnValue(true);
    const off = observeKeyboardInset();
    await Promise.resolve();
    // The web listeners must NOT be attached; a native build that also measured
    // would double-count against the plugin's exact height.
    expect(vv.listenerCount()).toBe(0);
    off();
  });

  it('does not break the screen when the plugin is unavailable', async () => {
    isNativePlatform.mockReturnValue(true);
    const off = observeKeyboardInset();
    await Promise.resolve();
    await Promise.resolve();
    expect(readKeyboardInset()).toBe(0);
    expect(() => off()).not.toThrow();
  });
});
