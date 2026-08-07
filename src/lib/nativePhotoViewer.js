/**
 * ════════════════════════════════════════════════
 * FILE: nativePhotoViewer.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Bridge to the iPhone app's built-in photo viewer. Inside the installed
 *   app, tapping a photo opens Apple's own full-screen viewer (real pinch,
 *   swipe, and drag physics). On the web or an older app build without the
 *   viewer, this reports unavailable and the JavaScript lightbox is used
 *   instead.
 *
 * Exports:
 *   nativePhotoViewerAvailable() → boolean
 *   presentNativePhotos({ urls, captions?, startIndex? }) → Promise that
 *     resolves when the tech closes the viewer.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core
 *   Internal:  the Swift side lives in ios/App/App/NativePhotoViewer.swift
 *   Data:      reads → none; writes → none (URLs are passed through)
 *
 * NOTES / GOTCHAS:
 *   - isPluginAvailable is the feature gate: an installed binary that
 *     predates the plugin simply keeps the web lightbox — no error path.
 * ════════════════════════════════════════════════
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const NativePhotoViewer = registerPlugin('NativePhotoViewer');

export function nativePhotoViewerAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativePhotoViewer');
  } catch {
    return false;
  }
}

export function presentNativePhotos({ urls, captions, startIndex }) {
  return NativePhotoViewer.present({ urls, captions, startIndex });
}
