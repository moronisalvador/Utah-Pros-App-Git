/**
 * ════════════════════════════════════════════════
 * FILE: native-notification-bell-motion.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the native notification panel and dashboard menu's shared motion,
 *   lifecycle, refresh, accessibility, and field-tech surface contracts.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, vitest
 *   Internal:  NotificationBell.jsx, DashHeader.jsx, TechDashV2.jsx, index.css
 *   Data:      reads → repository source files
 *
 * NOTES / GOTCHAS:
 *   - This is source-contract coverage. Simulator and device verification own
 *     the real WKWebView animation and focus evidence.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const bell = read('src/components/NotificationBell.jsx');
const dash = read('src/pages/tech/v2/TechDashV2.jsx');
const header = read('src/pages/tech/v2/dash/DashHeader.jsx');
const css = read('src/index.css');

describe('native notification bell motion contract', () => {
  it('keeps the panel mounted for a native exit and honors reduced motion', () => {
    expect(bell).toContain('panelPresent');
    expect(bell).toContain("data-state={open ? 'open' : 'closing'}");
    expect(bell).toContain('onAnimationEnd');
    expect(bell).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
    expect(css).toContain('TECH POPOVER MOTION + NATIVE NOTIFICATION SURFACE — BELL-01');
    expect(css).toContain("notification-bell__panel[data-state='open']");
    expect(css).toContain("notification-bell__panel[data-state='closing']");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?notification-bell__panel[\s\S]*?animation: none !important/,
    );
  });

  it('scopes the visual treatment to native while using catalog motion tokens', () => {
    expect(css).toContain(":root[data-native='true'] .notification-bell__panel");
    expect(css).toContain('border-radius: var(--tech-radius-card) !important');
    expect(css).toContain(":root[data-native='true'] .notification-bell__item");
    expect(css).toContain('font-size: var(--tech-text-body)');
    expect(css).toContain('var(--motion-duration-fast)');
    expect(css).toContain('var(--motion-spring-in)');
    expect(css).toContain('var(--motion-ease-accelerate)');
    expect(css).not.toMatch(
      /techPopover(?:In|Out)[\s\S]*?transition:\s*\d+ms/,
    );
  });

  it('uses the same enter and exit motion for the dashboard menu', () => {
    expect(header).toContain('menuPresent');
    expect(header).toContain("data-state={menuOpen ? 'open' : 'closing'}");
    expect(header).toContain('onAnimationEnd');
    expect(header).toContain('aria-expanded={menuOpen}');
    expect(css).toContain(".tv2-dash-menu[data-state='open']");
    expect(css).toContain(".tv2-dash-menu[data-state='closing']");
    expect(css).toMatch(
      /tv2-dash-menu\[data-state='open'\][\s\S]*?techPopoverIn[\s\S]*?notification-bell__panel\[data-state='open'\][\s\S]*?techPopoverIn/,
    );
  });

  it('preserves rendered rows during realtime and limits resume to the count', () => {
    expect(bell).toContain('hasLoadedListRef');
    expect(bell).toContain('listRequestRef');
    expect(bell).toContain('loadList({ silent: true })');
    expect(bell).toContain('request !== listRequestRef.current');
    expect(bell).toContain('loading && !hasLoadedListRef.current');
    expect(bell).toMatch(/const refreshOnResume = useCallback\(\(\) => \{\s*pollCount\(\);\s*\}/);
  });

  it('closes a hidden dashboard pane and exposes accessible panel semantics', () => {
    expect(dash).toContain('active={active}');
    expect(header).toContain('<NotificationBell');
    expect(header).toContain('active={active}');
    expect(bell).toContain('aria-expanded={open}');
    expect(bell).toContain('aria-controls="notification-bell-panel"');
    expect(bell).toContain('aria-labelledby="notification-bell-title"');
    expect(bell).toContain("event.key === 'Escape'");
    expect(bell).toContain('triggerRef.current?.focus()');
  });

  it('routes live feedback through the shared toast entry point', () => {
    expect(bell).toContain("import { err, toast } from '@/lib/toast'");
    expect(bell).toContain("import { impact } from '@/lib/nativeHaptics'");
    expect(bell).toMatch(/const openItem = async \(item\) => \{\s*impact\('light'\)/);
    expect(bell).toMatch(/const markAll = async \(\) => \{[\s\S]*?impact\('light'\)/);
    expect(bell).toMatch(/const retryList = \(\) => \{\s*impact\('light'\)/);
    expect(bell).toContain("err('Could not mark that notification as read.')");
    expect(bell).toContain("err('Could not mark all notifications as read.')");
    expect(bell).not.toContain("dispatchEvent(new CustomEvent('upr:toast'");
  });
});
