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
 *   The album/quick-capture split survives: album-oriented surfaces batch
 *   multi-select uploads, while quick-capture surfaces stay snap-first and
 *   single-shot. Both directions still erode easily — adding `multiple` to a
 *   quick-capture input turns a one-tap snap into a picker flow; dropping it
 *   from an album surface re-serializes a 10-photo upload.
 *
 *   A third tier, attach flows (the Messages composer), is camera-first too,
 *   but its no-plugin fallback is the FILE INPUT, never the camera-direct
 *   single shot — an attach flow that lost album access would be a
 *   regression. Web/PWA keeps the plain input (no `capture` attribute).
 *
 *   OWNER AMENDMENT (2026-08-14, stated in conversation the same day): on
 *   the composer ONLY, the native [+] presents Apple's own action sheet
 *   with explicit Take Photo / Photo Library rows before the camera — the
 *   owner wants the source split visible there. Take Photo opens OUR
 *   custom camera (never the stock one); Photo Library opens the OS
 *   multi-select picker. This is a deliberate, surface-scoped exception to
 *   "no prompt anywhere"; every other photo button stays straight-to-camera,
 *   and the menu-contract describe below is what keeps the exception scoped.
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

// The attach flows: photos are STAGED (previewed, removable) before an
// explicit send — camera-first on native, but the fallback keeps the album.
const ATTACH_FLOW_SURFACES = [
  'src/pages/tech/v2/messages/Composer.jsx',
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
    for (const file of [...ALBUM_SURFACES, ...SNAP_FIRST_SURFACES, ...ATTACH_FLOW_SURFACES]) {
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
});

describe('album surfaces: camera-first primary + adjacent album icon, multi-select batches', () => {
  for (const file of ALBUM_SURFACES) {
    it(`${file} opens the camera experience with allowMultiple and offers the album icon`, () => {
      const src = read(file);
      // Primary tap: the camera experience, multi-select enabled for the batch loop.
      expect(src).toContain('openNativeCameraExperience({ allowMultiple: true })');
      // Adjacent album icon: straight to the OS multi-select picker.
      expect(src).toContain('pickNativePhotos');
      // Web: camera-first capture input + a `multiple` album input.
      expect(hasCaptureInput(src), `${file}: web primary input must be capture="environment"`).toBe(true);
      expect(hasMultipleInput(src), `${file}: web album input must carry \`multiple\``).toBe(true);
      // Uploads route through the shared usePhotoUpload hook — compression
      // before storage, one helper (perf-budget.md §2).
      expect(src).toContain('usePhotoUpload');
      // The batch loop reads every selected file, not just the first.
      expect(src).toContain('Array.from(e.target.files');
      expect(src, `${file}: single-file e.target.files?.[0] pattern must not return`).not.toContain('e.target.files?.[0]');
    });
  }
});

describe('quick-capture surfaces stay snap-first and single-shot', () => {
  for (const file of SNAP_FIRST_SURFACES) {
    it(`${file} opens the camera instantly and uploads one photo`, () => {
      const src = read(file);
      expect(src).toContain('openNativeCameraExperience()');
      expect(src, `${file}: quick-capture must not enable multi-select`).not.toContain('allowMultiple: true');
      expect(src, `${file}: quick-capture must not open the multi picker`).not.toContain('pickNativePhotos');
      expect(hasMultipleInput(src), `${file}: quick-capture input must stay single-file`).toBe(false);
      expect(hasCaptureInput(src), `${file}: web quick-capture input must be camera-first`).toBe(true);
    });
  }
});

describe('attach flows: camera-first on native, file-input fallback keeps the album', () => {
  for (const file of ATTACH_FLOW_SURFACES) {
    it(`${file} opens the camera experience with allowMultiple on plugin-carrying binaries`, () => {
      const src = read(file);
      // Native primary: the WhatsApp-style camera, multi-select enabled.
      expect(src).toContain('openNativeCameraExperience({ allowMultiple: true })');
      // Gate on plugin AVAILABILITY, not the platform: an older binary must
      // fall back to the same file input the web uses — the camera-direct
      // single shot has no album, and an attach flow must never lose it.
      expect(src).toContain('nativeCameraExperienceAvailable()');
      expect(src, `${file}: the single-shot fallback must not be reachable here`).not.toContain('captureNativePhoto');
      // Picked files feed the SAME staged-attachment state the input feeds —
      // previews, removable before send; upload timing is the hook's, and the
      // send path stays byte-untouched.
      expect(src).toMatch(/const files = await openNativeCameraExperience[\s\S]*?addFiles\(files\)/);
      // A cancelled camera is a silent no-op (never a toast on empty).
      expect(src).toContain('isUserCancelled');
      // Web/PWA keeps the plain attachment input: multi-select, no capture
      // attribute (an attach flow is not a capture surface).
      expect(hasMultipleInput(src), `${file}: web attach input must keep \`multiple\``).toBe(true);
      expect(hasCaptureInput(src), `${file}: web attach input must stay a plain picker`).toBe(false);
    });
  }
});

describe('composer [+] native menu — the owner-amended attach contract', () => {
  const src = read('src/pages/tech/v2/messages/Composer.jsx');

  it('offers the menu only when BOTH plugins answer, so every row does what it says', () => {
    // A launch where either isPluginAvailable misreads (observed intermittently
    // on the iOS 26.3 sim) degrades to the web sheet, never to a half-working menu.
    expect(src).toMatch(/nativeActionMenuAvailable\(\) && nativeCameraExperienceAvailable\(\)/);
  });

  it('Take Photo opens OUR camera; Photo Library opens the OS multi-select picker', () => {
    // takePhoto routes through onAttachPhotos → openNativeCameraExperience —
    // never the stock Capacitor camera, never a second chooser.
    expect(src).toMatch(/selected === 'takePhoto'\)\s*await onAttachPhotos\(\)/);
    expect(src).toMatch(/selected === 'photoLibrary'\)\s*await onPickFromLibrary\(\)/);
    expect(src).toMatch(/const files = await pickNativePhotos\(\)[\s\S]*?addFiles\(files\)/);
  });

  it('the menu exception stays scoped to the composer', () => {
    // Every other photo surface remains straight-to-camera: none may grow a
    // pre-camera menu without its own owner amendment recorded here.
    for (const file of [...ALBUM_SURFACES, ...SNAP_FIRST_SURFACES]) {
      expect(read(file), `${file}: pre-camera menu is composer-only`).not.toContain('presentNativeActionMenu');
    }
  });
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
