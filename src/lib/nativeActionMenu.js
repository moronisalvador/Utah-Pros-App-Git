/**
 * ════════════════════════════════════════════════
 * FILE: nativeActionMenu.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens Apple's own pop-up menu (the choice sheet that slides up from the
 *   bottom of an iPhone screen) from inside the installed app. A page hands
 *   it a list of choices; the tech taps one and the page gets the answer
 *   back and does the work. On the website this file reports "not
 *   available" and pages keep their own web-drawn menus.
 *
 * Exports:
 *   nativeActionMenuAvailable() → bool — feature gate; false on web/PWA and
 *     on an installed binary that predates the plugin.
 *   presentNativeActionMenu({ title?, items, cancelTitle?, anchor? })
 *     items: [{ id, title, checked?, destructive?, disabled? }]
 *     anchor: the trigger DOM element (its rect pins the iPad popover)
 *     → resolves the selected item's id, or null when the tech cancels.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core
 *   Internal:  the Swift side lives in ios/App/App/NativeActionMenu.swift
 *   Data:      reads → none   writes → none (pure UI)
 *
 * NOTES / GOTCHAS:
 *   - Callers feature-detect with nativeActionMenuAvailable() and keep their
 *     web menu as the fallback — an older installed binary must degrade,
 *     never throw.
 *   - Cancel resolves null (the Swift side omits the `selected` key); it is
 *     not an error and must not toast.
 *   - Presenting a native sheet drops the WKWebView keyboard; the caller
 *     owns refocusing its input after the menu closes.
 * ════════════════════════════════════════════════
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeActionMenu = registerPlugin('NativeActionMenu');

// Feature gate: true only inside an installed binary that carries the plugin.
export function nativeActionMenuAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeActionMenu');
  } catch {
    return false;
  }
}

export async function presentNativeActionMenu({ title, items, cancelTitle, anchor } = {}) {
  const rect = anchor && typeof anchor.getBoundingClientRect === 'function'
    ? anchor.getBoundingClientRect()
    : null;
  const res = await NativeActionMenu.present({
    title,
    items,
    cancelTitle,
    // Viewport CSS px == points (full-bleed webview); only the iPad popover
    // reads the anchor — iPhone slides the sheet from the bottom regardless.
    ...(rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : {}),
  });
  return res?.selected || null;
}
