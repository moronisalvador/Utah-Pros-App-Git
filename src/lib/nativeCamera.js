// Native camera wrapper for iOS (Capacitor).
// On web, callers fall back to the existing <input type=file capture> flow.
// On native, takeNativePhoto() returns a File with the shape upload handlers expect.

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export function isNativeCamera() {
  return Capacitor.isNativePlatform();
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
  const res = await fetch(photo.webPath);
  const blob = await res.blob();
  const ext = photo.format || 'jpeg';
  const filename = `photo-${Date.now()}.${ext}`;
  const mime = blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return new File([blob], filename, { type: mime });
}

// Returns a File on success, null if the user cancels.
// Snap-first on real devices; falls back to Photos on simulator / camera-less hardware.
export async function takeNativePhoto() {
  try {
    return await getPhotoFile(CameraSource.Camera);
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

// Known Capacitor Camera cancel strings — treat as silent no-op.
export function isUserCancelled(err) {
  const m = err?.message || '';
  return /cancel/i.test(m);
}
