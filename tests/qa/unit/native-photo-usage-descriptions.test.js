/**
 * ════════════════════════════════════════════════
 * FILE: native-photo-usage-descriptions.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the iPhone app's photo permission prompts honest. iOS shows these
 *   sentences when the app asks to use someone's photos, so they have to say
 *   what the app really does. They used to say the app "saves job photos" —
 *   the app has never saved a single photo to anyone's camera roll. This test
 *   fails if that claim comes back while no saving code exists, and it fails
 *   if either photo key is deleted, because the camera plugin refuses to run
 *   without them.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  ios/App/App/Info.plist, ios/App/App/*.swift
 *   Data:      reads repository source only
 *
 * NOTES / GOTCHAS:
 *   - NSPhotoLibraryAddUsageDescription looks dead (nothing adds), but
 *     @capacitor/camera's checkUsageDescriptions() loops every key in
 *     CameraPropertyListKeys and rejects the call when ANY is missing.
 *     getPhoto runs that check first, so deleting the key breaks
 *     captureNativePhoto() — the fallback shot for pre-plugin binaries and
 *     the simulator. verify-ios-release-artifact.mjs requires it too.
 *   - If a real save-to-camera-roll feature ever ships, the write-API check
 *     below goes red on purpose: update the read string at the same time.
 * ════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_DIR = join(ROOT, 'ios', 'App', 'App');
const plist = readFileSync(join(APP_DIR, 'Info.plist'), 'utf8');

const readString = (key) => {
  const match = plist.match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`),
  );
  return match ? match[1].trim() : null;
};

// Every Swift file the app owns, concatenated — the vendor plugin lives in
// node_modules and is deliberately out of scope.
const appSwift = readdirSync(APP_DIR)
  .filter((f) => f.endsWith('.swift'))
  .map((f) => readFileSync(join(APP_DIR, f), 'utf8'))
  .join('\n');

const PHOTO_LIBRARY_WRITE_APIS = [
  'PHAssetCreationRequest',
  'PHAssetChangeRequest',
  'UIImageWriteToSavedPhotosAlbum',
];

describe('iOS photo-library usage descriptions', () => {
  it('keeps all three camera/photo keys present and non-empty', () => {
    // @capacitor/camera rejects getPhoto if ANY of these is missing.
    for (const key of [
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) {
      expect(readString(key), `${key} must be present and non-empty`).toBeTruthy();
    }
  });

  it('does not claim the app saves photos while no save code exists', () => {
    const writesToLibrary = PHOTO_LIBRARY_WRITE_APIS.some((api) => appSwift.includes(api));
    if (writesToLibrary) return; // a real save shipped — the claim is fair again

    // The read prompt is shown when requesting .readWrite for the camera's
    // recents strip. Describing a save there tells the user the opposite of
    // what is being asked (App Store Guideline 5.1.1(i)).
    expect(readString('NSPhotoLibraryUsageDescription')).not.toMatch(/\bsaves?\b/i);
  });

  it('describes reading the library in the read prompt', () => {
    const read = readString('NSPhotoLibraryUsageDescription').toLowerCase();
    expect(read).toMatch(/photo/);
    expect(read).toMatch(/recent|attach|choose|select|existing/);
  });

  it('still performs no photo-library writes', () => {
    // Guards the premise of the test above rather than trusting it.
    for (const api of PHOTO_LIBRARY_WRITE_APIS) {
      expect(appSwift).not.toContain(api);
    }
    expect(readFileSync(join(ROOT, 'src', 'lib', 'nativeCamera.js'), 'utf8'))
      .toContain('saveToGallery: false');
  });
});
