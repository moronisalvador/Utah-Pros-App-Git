/**
 * KB-02 — the message composer must clear the keyboard in the installed app.
 *
 * Owner-reported on-device 2026-07-28: keyboard up, composer nowhere to be seen.
 * Root cause is the same one KB-01 hit in the four field forms — capacitor.config
 * sets Keyboard.resize "none", so the WKWebView never shrinks and visualViewport
 * reports no occlusion. ThreadView's lift is derived entirely from visualViewport,
 * so it computed 0px and the composer stayed parked under the keyboard.
 *
 * These are source-contract assertions, not render tests: this repo's vitest
 * environment is `node` with no jsdom, so a ThreadView render is unavailable.
 * They pin the two things that actually broke — that native reads the plugin, and
 * that the web/PWA path is untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const threadView = read('src/pages/tech/v2/messages/ThreadView.jsx');

describe('KB-02 — native keyboard lift comes from the plugin', () => {
  it('branches on the native platform before using visualViewport', () => {
    // The order matters: the native branch has to return BEFORE the web algorithm
    // runs, or the plugin value gets overwritten by a visualViewport reading of 0.
    const effect = threadView.slice(
      threadView.indexOf('if (!active) return undefined;'),
      threadView.indexOf('}, [active]);'),
    );
    const nativeAt = effect.indexOf('Capacitor.isNativePlatform()');
    const webAt = effect.indexOf('vv.addEventListener');
    expect(nativeAt).toBeGreaterThan(-1);
    expect(webAt).toBeGreaterThan(-1);
    expect(nativeAt).toBeLessThan(webAt);
  });

  it('subscribes to the shared keyboard port rather than re-measuring', () => {
    expect(threadView).toContain("import { observeKeyboardInset } from '@/lib/nativeKeyboardLayout'");
    expect(threadView).toContain('observeKeyboardInset((px)');
  });

  it('sets the lift variable the composer CSS actually consumes', () => {
    // A typo here fails silently — the var just never resolves and the lift is 0.
    expect(threadView).toContain("pane.style.setProperty('--tv2-msgs-kb'");
    expect(read('src/index.css')).toContain('padding-bottom: var(--tv2-msgs-kb, 0px)');
  });

  it('toggles the class that drops the home-indicator inset', () => {
    expect(threadView).toContain("pane.classList.toggle('tv2-msgs-kb-open', px > 0)");
    expect(read('src/index.css')).toContain('.tv2-msgs-pane.tv2-msgs-kb-open .tv2-msgs-composer');
  });

  it('clears both the variable and the class on teardown', () => {
    // A stale inset left behind would push the composer off-screen with the
    // keyboard already gone — worse than the bug being fixed.
    const nativeBranch = threadView.slice(
      threadView.indexOf('if (Capacitor.isNativePlatform()) {'),
      threadView.indexOf('if (!vv) return undefined;'),
    );
    expect(nativeBranch).toContain("pane.style.removeProperty('--tv2-msgs-kb')");
    expect(nativeBranch).toContain("pane.classList.remove('tv2-msgs-kb-open')");
    expect(nativeBranch).toContain('unobserve()');
  });
});

describe('KB-02 — the PWA path is untouched', () => {
  it('keeps the on-device-proven baseline algorithm verbatim', () => {
    // The owner froze the PWA UI. These four lines ARE the web behaviour; if a
    // refactor ever rewrites them, that is a PWA change and needs to be deliberate.
    expect(threadView).toContain('if (vh > baseline) baseline = vh;');
    expect(threadView).toContain('const kbInset = baseline - vh;');
    expect(threadView).toContain('const kbOpen = kbInset > 60;');
    expect(threadView).toContain('const raw = Math.max(0, kbInset - vv.offsetTop);');
  });

  it('still guards on visualViewport before the web listeners attach', () => {
    // The original early return was `if (!vv || !pane)`. Splitting it moved the vv
    // half below the native branch; dropping it entirely would throw on a browser
    // with no visualViewport support.
    expect(threadView).toContain('if (!vv) return undefined;');
    expect(threadView).toContain('if (!pane) return undefined;');
  });
});

describe('KB-02 — the config this all depends on', () => {
  it('still sets resize "none", which is why the web algorithm cannot work here', () => {
    // If this ever flips to "native"/"body", the native branch becomes redundant
    // rather than wrong — but the reason for it should be re-read first.
    const config = JSON.parse(read('capacitor.config.json'));
    expect(config.plugins.Keyboard.resize).toBe('none');
  });
});
