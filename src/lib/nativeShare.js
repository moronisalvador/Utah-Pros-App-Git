/**
 * ════════════════════════════════════════════════
 * FILE: nativeShare.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Bridge to the iPhone app's share sheet. Inside the installed app this
 *   opens Apple's own share sheet, so a tech can save a job photo to their
 *   Photos library, AirDrop it, or send a PDF to another app. On the web (or
 *   an older app build without the plugin) it reports unavailable and the
 *   caller keeps whatever it did before.
 *
 * Exports:
 *   nativeShareAvailable() → boolean
 *   shareNative({ url?, text?, title?, anchor? }) → Promise<{completed, activity}>
 *     `anchor` is an optional DOMRect-like {x, y} — iPad needs a point to
 *     hang the popover from.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core
 *   Internal:  the Swift side lives in ios/App/App/NativeShare.swift
 *   Data:      reads → none; writes → none (the URL is passed through)
 *
 * NOTES / GOTCHAS:
 *   - isPluginAvailable is the feature gate: an installed binary that predates
 *     the plugin degrades silently — callers must check before offering the
 *     control, so a tech is never shown a Share button that does nothing.
 *   - Pass an absolute https URL. The native side downloads it to a temp file
 *     so iOS offers real actions ("Save Image") rather than "Copy Link".
 * ════════════════════════════════════════════════
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeShare = registerPlugin('NativeShare');

export function nativeShareAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeShare');
  } catch {
    return false;
  }
}

/** Convenience: turn a tapped element into the iPad popover anchor. */
export function anchorFromEvent(event) {
  try {
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  } catch {
    return null;
  }
}

export function shareNative({ url, text, title, anchor } = {}) {
  return NativeShare.share({
    url,
    text,
    title,
    x: anchor?.x,
    y: anchor?.y,
  });
}
