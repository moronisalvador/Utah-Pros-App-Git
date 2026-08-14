/**
 * ════════════════════════════════════════════════
 * FILE: nativeCamera.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens the camera for the iPhone app's photo buttons. Tapping a photo
 *   button goes STRAIGHT to a full-screen camera — no "camera or album?"
 *   question ever (owner ruling 2026-08-14). The camera screen itself
 *   carries a strip of the phone's recent photos and an album icon that
 *   opens Apple's multi-select picker, WhatsApp-style. Whatever the tech
 *   snaps or selects is handed back in the exact File shape the pages'
 *   upload code expects. On the website this file is skipped — pages use
 *   hidden file inputs (camera-first via capture="environment").
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capacitor/camera
 *   Internal:  the Swift side lives in ios/App/App/NativeCameraExperience.swift
 *   Data:      reads  → none (device camera / photo album only)
 *              writes → none (callers upload the returned Files themselves)
 *
 * NOTES / GOTCHAS:
 *   - openNativeCameraExperience() is THE entry point for every photo button,
 *     and EVERY button gets the identical experience (owner unification,
 *     2026-08-14): allowMultiple strip/album selection everywhere, and a
 *     shutter that shoots & saves instantly — each capture streams through
 *     onCapturedFile while the camera stays open, so one photo is one tap
 *     (snap-first) and many photos are just more taps.
 *   - It feature-detects the NativeCameraExperience plugin; an older installed
 *     binary that predates it falls back to captureNativePhoto() — the
 *     camera-direct single shot, still with no chooser prompt.
 *   - pickNativePhotos() opens the OS multi-select album picker directly (no
 *     camera) — used by the album pages' adjacent album icon-button.
 *   - Cancelling anything rejects with a message containing "cancel" —
 *     isUserCancelled() turns that into a silent no-op, so callers must not
 *     toast on a null/empty return. Closing the camera AFTER shooting is a
 *     "done", not a cancel — it resolves with an empty selection.
 * ════════════════════════════════════════════════
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

const NativeCameraExperience = registerPlugin('NativeCameraExperience');

export function isNativeCamera() {
  return Capacitor.isNativePlatform();
}

// Feature gate for the WhatsApp-style camera screen: an installed binary
// that predates the plugin degrades to the camera-direct single shot.
export function nativeCameraExperienceAvailable() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeCameraExperience');
  } catch {
    return false;
  }
}

// Fetch a plugin-returned webPath into a File the upload handlers accept.
// `suffix` keeps same-millisecond batch items from sharing a filename (the
// storage path is `${jobId}/${Date.now()}-${file.name}`, so two identical
// names in one fast sequential batch could collide).
async function webPathToFile(webPath, format, suffix = '') {
  const res = await fetch(webPath);
  const blob = await res.blob();
  const ext = format || blob.type?.split('/')[1] || 'jpeg';
  const filename = `photo-${Date.now()}${suffix}.${ext}`;
  const mime = blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return new File([blob], filename, { type: mime });
}

// The one native photo entry point: full-screen camera with shutter/flash/
// flip, a recent-photos strip, and an album icon (PHPicker multi-select).
//
// Shoot & save instantly (owner choice 2026-08-14): every shutter tap emits
// a "photoCaptured" event the moment its JPEG is ready — pass onCapturedFile
// to upload each one in the background WHILE the camera stays open (a "N
// saved" counter shows on the camera). The returned promise resolves when
// the camera closes, with the strip/album selection as File[] (empty when
// the tech closes after shooting — those photos already streamed).
export async function openNativeCameraExperience({ allowMultiple = false, onCapturedFile } = {}) {
  if (!nativeCameraExperienceAvailable()) {
    // Older installed binary: camera-direct, still no chooser prompt. The
    // single shot comes back as the RESULT (no event support), so callers
    // handle it through the same returned-files path.
    const file = await captureNativePhoto();
    return file ? [file] : [];
  }
  let listener = null;
  let captureSeq = 0;
  let items = [];
  try {
    if (typeof onCapturedFile === 'function') {
      listener = await NativeCameraExperience.addListener('photoCaptured', async (item) => {
        if (!item?.webPath) return;
        try {
          // `-c${n}` keeps streamed captures from colliding with each other
          // or with the returned selection in the storage path.
          await onCapturedFile(await webPathToFile(item.webPath, item.format, `-c${captureSeq++}`));
        } catch {
          // The caller's uploader owns its own error reporting — a throw here
          // must never kill the listener for the next capture.
        }
      });
    }
    const res = await NativeCameraExperience.capture({ allowMultiple });
    items = res?.photos || [];
  } catch (err) {
    if (isUserCancelled(err)) return [];
    throw err;
  } finally {
    listener?.remove();
  }
  const files = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item?.webPath) continue;
    files.push(await webPathToFile(item.webPath, item.format, `-${i}`));
  }
  return files;
}

async function getPhotoFile(source) {
  const photo = await Camera.getPhoto({
    resultType: CameraResultType.Uri,
    source,
    quality: 85,
    saveToGallery: false,
    correctOrientation: true,
  });
  if (!photo?.webPath) return null;
  return webPathToFile(photo.webPath, photo.format);
}

// Camera directly, no OS prompt — the fallback single shot for binaries
// without the NativeCameraExperience plugin. Returns a File, or null if the
// user cancels. Falls back to the photo library if the camera itself is
// unavailable (simulator / camera-less hardware).
export async function captureNativePhoto() {
  try {
    return await getPhotoFile(CameraSource.Camera);
  } catch (err) {
    if (isUserCancelled(err)) return null;
    const msg = err?.message || '';
    if (/not available|simulator|no camera|unavailable/i.test(msg)) {
      return await getPhotoFile(CameraSource.Photos);
    }
    throw err;
  }
}

// OS multi-select album picker (PHPicker on iOS — no permission prompt).
// Returns File[] — empty if the user cancels or picks nothing. Callers loop
// their existing single-file upload handler over the result. Used by the
// album pages' adjacent album icon (and by older binaries, where the camera
// screen's built-in album icon doesn't exist).
// chooseFromGallery is the 8.x API; pickImages (deprecated, present since
// plugin 1.2.0) covers an older installed binary whose native side predates
// it — both reject with "cancel" strings on dismissal.
export async function pickNativePhotos() {
  let items = [];
  try {
    if (typeof Camera.chooseFromGallery === 'function') {
      const res = await Camera.chooseFromGallery({
        allowMultipleSelection: true,
        quality: 85,
        correctOrientation: true,
      });
      items = res?.results || [];
    } else {
      const res = await Camera.pickImages({ quality: 85 });
      items = res?.photos || [];
    }
  } catch (err) {
    if (isUserCancelled(err)) return [];
    throw err;
  }
  const files = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item?.webPath) continue;
    files.push(await webPathToFile(item.webPath, item.format, `-${i}`));
  }
  return files;
}

// Known cancel strings (Capacitor Camera + NativeCameraExperience) — treat
// as silent no-op.
export function isUserCancelled(err) {
  const m = err?.message || '';
  return /cancel/i.test(m);
}
