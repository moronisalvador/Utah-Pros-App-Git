/**
 * KB-01 — the keyboard work must not move the PWA's UI.
 *
 * Owner decision 2026-07-27: the web UI is frozen because it works. Native
 * keyboard handling is therefore gated at an explicit platform boundary, and
 * every derived style must collapse to "no change" when the inset is 0.
 *
 * This is a credential-free source contract (the unit lane runs environment:
 * 'node' with no jsdom, so a render test is not available here). It encodes the
 * guarantee structurally: if someone later applies a keyboard style
 * unconditionally, or drops the isNativePlatform gate, this fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('KB-01 — native keyboard handling never reaches the PWA', () => {
  it('gates the consumer hook on isNativePlatform and attaches nothing on web', () => {
    const hook = read('src/lib/useNativeKeyboardInset.js');
    expect(hook).toContain('Capacitor.isNativePlatform()');
    // The web branch must return BEFORE observing — not observe and discard.
    expect(hook).toMatch(/if\s*\(!Capacitor\.isNativePlatform\(\)\)\s*return\s+undefined;/);
    const gateAt = hook.indexOf('isNativePlatform()');
    const observeAt = hook.indexOf('observeKeyboardInset(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(observeAt).toBeGreaterThan(gateAt);
  });

  it('does not wire the port\'s web adapter to any screen', () => {
    // nativeKeyboardLayout.js ships a tested web adapter on purpose, but wiring
    // the PWA is a separate product decision. Only the native-gated hook may
    // reach the port from UI code.
    const consumers = [
      'src/components/tech/EsignRequestSheet.jsx',
      'src/pages/tech/TechNewAppointment.jsx',
      'src/pages/tech/TechEditAppointment.jsx',
      'src/pages/tech/TechNewJob.jsx',
      'src/pages/tech/TechNewCustomer.jsx',
    ];
    for (const file of consumers) {
      const source = read(file);
      expect(source).not.toContain('observeKeyboardInset');
      expect(source).not.toContain('nativeKeyboardLayout');
      expect(source).toContain('useNativeKeyboardInset');
    }
  });

  it('collapses every keyboard-derived style to today\'s value at inset 0', () => {
    const sheet = read('src/components/tech/EsignRequestSheet.jsx');
    // Each usage must be conditional, so a 0 inset renders byte-identically.
    expect(sheet).toContain('paddingBottom: kbInset || undefined');
    expect(sheet).toContain("maxHeight: kbInset ? `calc(92dvh - ${kbInset}px)` : '92dvh'");
    expect(sheet).toContain("paddingBottom: kbInset ? 12 : 'max(12px, env(safe-area-inset-bottom, 12px))'");
    // A bare `paddingBottom: kbInset` would emit paddingBottom:0 on web, which
    // is NOT the same as omitting the property once a stylesheet is involved.
    expect(sheet).not.toMatch(/paddingBottom:\s*kbInset\s*[,}]/);
  });

  it('routes all four field forms through the shared helper, never a literal', () => {
    // Four hand-copied offsets is how one screen silently keeps the old
    // behaviour after the others are fixed.
    const forms = [
      'src/pages/tech/TechNewAppointment.jsx',
      'src/pages/tech/TechEditAppointment.jsx',
      'src/pages/tech/TechNewJob.jsx',
      'src/pages/tech/TechNewCustomer.jsx',
    ];
    for (const form of forms) {
      const source = read(form);
      expect(source, form).toContain('bottom: techStickyCtaBottom(kbInset)');
      // The resting literal must be GONE from the form — it now lives once in
      // the helper, which is what guarantees all four move together.
      expect(source, form).not.toContain(
        "bottom: 'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))'",
      );
    }
  });

  it('leaves the on-device-verified ThreadView implementation alone', () => {
    // ThreadView's visualViewport handling is correct and on-device verified
    // (2026-07-10). Consolidating it is a follow-up, not a prerequisite, and
    // rewriting it would put a working surface at risk.
    const thread = read('src/pages/tech/v2/messages/ThreadView.jsx');
    expect(thread).toContain('--tv2-msgs-kb');
    expect(thread).not.toContain('useNativeKeyboardInset');
  });
});
