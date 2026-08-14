/**
 * ════════════════════════════════════════════════
 * FILE: nativeCamera.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the iPhone app add a photo the way the phone normally does it: a
 *   small menu appears asking whether to take a new picture or pick one that
 *   is already in the photo album. Whichever the tech chooses, the photo is
 *   handed back to the page in the exact shape its upload code expects.
 *   On the website version this file is skipped — the page's hidden file
 *   input shows the browser's own Photo Library / Take Photo choices.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capacitor/camera
 *   Internal:  none
 *   Data:      reads  → none (device camera / photo album only)
 *              writes → none (callers upload the returned File themselves)
 *
 * NOTES / GOTCHAS:
 *   - takeNativePhoto() uses CameraSource.Prompt (owner request 2026-08-13):
 *     the OS sheet offers "From Photos" and "Take Picture". Before that it
 *     forced the camera, which made album uploads impossible in the app.
 *     It stays the single-shot path for the quick-capture buttons (Dash,
 *     Hub dock, appointment) — snap-first surfaces never multi-select.
 *   - captureNativePhoto()/pickNativePhotos() are for surfaces that render
 *     their own Take Photo / Choose from Album sheet (the album pages):
 *     capture goes straight to the camera, pick opens the OS multi-select
 *     album picker and returns an array of Files.
 *   - If the user picks Take Picture on hardware with no usable camera
 *     (simulator), the plugin throws; we retry straight into the album.
 *   - Cancelling either the sheet or the pickers rejects with a message
 *     containing "cancel" — isUserCancelled() turns that into a silent no-op,
 *     so callers must not toast on a null/empty return.
 * ════════════════════════════════════════════════
 */

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export function isNativeCamera() {
  return Capacitor.isNativePlatform();
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

// Returns a File on success, null if the user cancels.
// CameraSource.Prompt shows the OS sheet (Take Picture / From Photos) so techs
// can upload existing album photos, not only new captures (owner request
// 2026-08-13). Falls back to Photos if the camera itself is unavailable
// (simulator / camera-less hardware) after the user picks Take Picture.
export async function takeNativePhoto() {
  try {
    return await getPhotoFile(CameraSource.Prompt);
  } catch (err) {
    if (isUserCancelled(err)) return null;
    // Simulator and a few edge devices report this — fall back to photo library
    const msg = err?.message || '';
    if (/not available|simulator|no camera|unavailable/i.test(msg)) {
      return await getPhotoFile(CameraSource.Photos);
    }
    throw err;
  }
}

// Camera directly, no OS prompt — for surfaces that render their own
// Take Photo / Choose from Album sheet, where "Take Photo" was already
// chosen. Returns a File, or null if the user cancels. Same simulator /
// camera-less fallback as takeNativePhoto().
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
// their existing single-file upload handler over the result.
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

// Known Capacitor Camera cancel strings — treat as silent no-op.
export function isUserCancelled(err) {
  const m = err?.message || '';
  return /cancel/i.test(m);
}
