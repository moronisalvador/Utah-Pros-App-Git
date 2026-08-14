/**
 * ════════════════════════════════════════════════
 * FILE: album-multi-photo-select.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the 2026-08-14 camera-first photo doctrine (owner ruling, recorded
 *   the day the CameraSource.Prompt / AddPhotoSourceSheet chooser flows
 *   shipped and were rejected): every photo button opens the CAMERA
 *   instantly — never a "camera or album?" prompt, neither the OS sheet nor
 *   a custom one. Album access is an affordance inside or beside the camera:
 *   the native camera screen carries a recents strip and an album icon
 *   (NativeCameraExperience plugin), the album pages carry an adjacent
 *   album icon-button, and web uses a camera-first capture input with a
 *   `multiple` album input behind the icon.
 *
 *   Unified 2026-08-14 (owner): EVERY button gets the identical camera —
 *   allowMultiple strip/album selection everywhere, and a shutter that
 *   shoots & saves instantly (each capture streams through onCapturedFile
 *   while the camera stays open, so one photo stays one tap). The only
 *   split left is page chrome: album surfaces carry an adjacent album
 *   icon + a `multiple` web input; quick-capture surfaces keep a lean
 *   camera-first single web input.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — the credential-free `qa` lane, so it runs in CI
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  src/lib/nativeCamera.js, src/pages/tech/**
 *   Data:      reads  → source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Source-contract assertions: they prove INTENT, not runtime behavior.
 *     The camera screen itself (Swift) only runs on a device/simulator;
 *     its wiring is pinned by native-plugin-wiring.test.js.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The album-oriented surfaces: multi-select batches are the point.
const ALBUM_SURFACES = [
  'src/pages/tech/TechJobAlbum.jsx',
  'src/pages/tech/TechClaimAlbum.jsx',
  'src/pages/tech/TechRoomDetail.jsx',
  'src/pages/tech/TechJobDetail.jsx',
  'src/pages/tech/TechClaimDetail.jsx',
];

// The quick-capture surfaces: snap-first, one shot, no picker detour.
const SNAP_FIRST_SURFACES = [
  'src/pages/tech/v2/dash/PhotoCaptureButton.jsx',
  'src/pages/tech/v2/hub/HubDock.jsx',
  'src/pages/tech/TechAppointment.jsx',
];

// A file input opts into multi-select only via the `multiple` attribute;
// match it as a standalone JSX attribute so `allowMultipleSelection` (the
// Capacitor option) can never satisfy the check.
const hasMultipleInput = (src) => /<input[\s\S]*?\bmultiple\b[\s\S]*?\/>/.test(src);
const hasCaptureInput = (src) => /<input[\s\S]*?\bcapture="environment"[\s\S]*?\/>/.test(src);

describe('every photo entry point is camera-first — no chooser prompt anywhere', () => {
  it('the AddPhotoSourceSheet chooser is gone', () => {
    expect(
      existsSync(join(ROOT, 'src/components/tech/AddPhotoSourceSheet.jsx')),
      'AddPhotoSourceSheet.jsx must stay deleted — a photo button never asks "camera or album?" first',
    ).toBe(false);
  });

  it('no photo surface references a source-chooser sheet', () => {
    for (const file of [...ALBUM_SURFACES, ...SNAP_FIRST_SURFACES]) {
      expect(read(file), `${file}: chooser sheet reference`).not.toContain('AddPhotoSourceSheet');
    }
  });

  it('nativeCamera.js never uses CameraSource.Prompt (the OS chooser)', () => {
    const src = read('src/lib/nativeCamera.js');
    expect(src).not.toContain('CameraSource.Prompt');
    expect(src).not.toContain('takeNativePhoto');
  });
});

describe('nativeCamera camera-experience contract', () => {
  const src = read('src/lib/nativeCamera.js');

  it('openNativeCameraExperience is the one entry point, with a multi-select option', () => {
    expect(src).toContain('export async function openNativeCameraExperience');
    expect(src).toContain('allowMultiple = false');
    expect(src).toContain("NativeCameraExperience.capture({ allowMultiple })");
  });

  it('feature-detects the plugin and falls back camera-direct (still no prompt)', () => {
    // An installed binary that predates the plugin must degrade to the
    // camera-direct single shot — never to a chooser.
    expect(src).toContain('nativeCameraExperienceAvailable');
    expect(src).toMatch(/if \(!nativeCameraExperienceAvailable\(\)\) \{[\s\S]*?captureNativePhoto\(\)/);
    expect(src).toContain('CameraSource.Camera');
  });

  it('pickNativePhotos multi-selects via chooseFromGallery with a pickImages fallback', () => {
    expect(src).toContain('export async function pickNativePhotos');
    expect(src).toContain('allowMultipleSelection: true');
    // Older installed binaries predate chooseFromGallery (plugin 8.x) — the
    // deprecated-but-present pickImages keeps them working.
    expect(src).toContain('Camera.pickImages');
    // Batch filenames carry a per-item suffix so same-millisecond conversions
    // cannot collide in the `${jobId}/${ts}-${name}` storage path.
    expect(src).toMatch(/webPathToFile\(item\.webPath, item\.format, `-\$\{i\}`\)/);
  });

  it('a cancelled camera stays a silent no-op', () => {
    expect(src).toContain('export function isUserCancelled');
    expect(src).toMatch(/if \(isUserCancelled\(err\)\) return \[\];/);
  });

  it('streams shutter captures to the caller while the camera stays open', () => {
    // Shoot & save instantly (owner choice 2026-08-14): each capture arrives
    // as a photoCaptured event and uploads through onCapturedFile; a caller
    // throw must never kill the listener for the next capture.
    expect(src).toContain('onCapturedFile');
    expect(src).toContain("addListener('photoCaptured'");
    expect(src).toMatch(/listener\?\.remove\(\)/);
    // Streamed captures get their own filename suffix so they cannot collide
    // with the returned strip/album selection.
    expect(src).toMatch(/`-c\$\{captureSeq\+\+\}`/);
  });
});

describe('every surface gets the IDENTICAL camera (owner unification, 2026-08-14)', () => {
  // One experience on all 8 buttons: allowMultiple strip/album selection AND
  // shoot-&-save-instantly capture streaming (each shutter tap uploads via
  // onCapturedFile while the camera stays open).
  for (const file of [...ALBUM_SURFACES, ...SNAP_FIRST_SURFACES]) {
    it(`${file} opens the unified camera: allowMultiple + streamed captures`, () => {
      const src = read(file);
      expect(src).toContain('openNativeCameraExperience({');
      expect(src, `${file}: strip/album multi-select must be enabled`).toContain('allowMultiple: true');
      expect(src, `${file}: shutter captures must stream to an instant upload`).toContain('onCapturedFile:');
      // Uploads route through the shared usePhotoUpload hook — compression
      // before storage, one helper (perf-budget.md §2).
      expect(src).toContain('usePhotoUpload');
    });
  }
});

describe('album surfaces additionally carry the adjacent album icon + multi web input', () => {
  for (const file of ALBUM_SURFACES) {
    it(`${file} offers the album icon and the web batch inputs`, () => {
      const src = read(file);
      // Adjacent album icon: straight to the OS multi-select picker.
      expect(src).toContain('pickNativePhotos');
      // Web: camera-first capture input + a `multiple` album input.
      expect(hasCaptureInput(src), `${file}: web primary input must be capture="environment"`).toBe(true);
      expect(hasMultipleInput(src), `${file}: web album input must carry \`multiple\``).toBe(true);
      // The batch loop reads every selected file, not just the first.
      expect(src).toContain('Array.from(e.target.files');
      expect(src, `${file}: single-file e.target.files?.[0] pattern must not return`).not.toContain('e.target.files?.[0]');
    });
  }
});

describe('quick-capture surfaces stay lean: no extra chrome around the camera', () => {
  // The camera itself is identical; these surfaces just skip the adjacent
  // album icon (it lives INSIDE the camera) and keep the web input single —
  // the web tier has no camera experience to stream from.
  for (const file of SNAP_FIRST_SURFACES) {
    it(`${file} carries no adjacent picker and a camera-first web input`, () => {
      const src = read(file);
      expect(src, `${file}: quick-capture must not open the multi picker directly`).not.toContain('pickNativePhotos');
      expect(hasMultipleInput(src), `${file}: quick-capture web input must stay single-file`).toBe(false);
      expect(hasCaptureInput(src), `${file}: web quick-capture input must be camera-first`).toBe(true);
    });
  }
});

describe('per-file failure reporting', () => {
  for (const file of ALBUM_SURFACES) {
    it(`${file} reports partial batches ("N of M uploaded") instead of stopping silently`, () => {
      const src = read(file);
      // The sequential loop counts successes and failures per file…
      expect(src).toContain('failures.push(err)');
      // …and the partial-failure summary reaches the tech, in the page's own
      // language (plain string on the album pages, i18n key on the detail pages).
      expect(
        /photos uploaded — .*failed|photosPartial/.test(src),
        `${file}: partial-batch summary toast missing`,
      ).toBe(true);
    });
  }
});
