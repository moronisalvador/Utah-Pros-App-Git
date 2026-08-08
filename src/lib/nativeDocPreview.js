/**
 * ════════════════════════════════════════════════
 * FILE: nativeDocPreview.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Bridge to the iPhone app's document previewer. Inside the installed app,
 *   opening a PDF (an estimate, a report, a work authorisation) shows Apple's
 *   own Quick Look viewer — pinch to zoom, scroll pages, share from inside it.
 *   On the web, or an older app build without the plugin, this reports
 *   unavailable and the caller falls back to opening the document normally.
 *
 * Exports:
 *   nativeDocPreviewAvailable() → boolean
 *   previewNativeDoc({ url, title? }) → Promise that resolves when closed.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core
 *   Internal:  the Swift side lives in ios/App/App/NativeDocPreview.swift
 *   Data:      reads → none; writes → none (the URL is passed through)
 *
 * NOTES / GOTCHAS:
 *   - Pass an absolute https URL. Quick Look can only read a LOCAL file, so
 *     the native side downloads it first; the filename extension is preserved
 *     because Quick Look picks its renderer from it.
 *   - isPluginAvailable is the feature gate — callers must check before
 *     routing a document here, so an older binary keeps the web path.
 * ════════════════════════════════════════════════
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeDocPreview = registerPlugin('NativeDocPreview');

export function nativeDocPreviewAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeDocPreview');
  } catch {
    return false;
  }
}

export function previewNativeDoc({ url, title } = {}) {
  return NativeDocPreview.present({ url, title });
}
