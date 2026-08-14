/**
 * ════════════════════════════════════════════════
 * FILE: album-multi-photo-select.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the 2026-08-13 multi-photo album decision so a later edit cannot
 *   quietly undo half of it. Techs can select several album photos in one
 *   pass on the album-oriented surfaces (job album, claim album, room detail,
 *   and the two detail pages' photo sections), while the quick-capture
 *   buttons (Dash, Hub dock, appointment) stay snap-first and single-shot.
 *
 *   The split is deliberate and easy to erode from either side: adding
 *   `multiple` to a quick-capture input turns a one-tap snap into a picker
 *   flow, and dropping it from an album surface silently re-serializes a
 *   10-photo upload into 10 round trips through the picker.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — the credential-free `qa` lane, so it runs in CI
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  src/lib/nativeCamera.js, src/pages/tech/**,
 *              src/components/tech/AddPhotoSourceSheet.jsx
 *   Data:      reads  → source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Source-contract assertions: they prove INTENT, not runtime behavior.
 *     The native picker itself (Capacitor chooseFromGallery) only runs on a
 *     device/simulator.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The album-oriented surfaces: multi-select is the point.
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

describe('album surfaces support multi-photo selection', () => {
  for (const file of ALBUM_SURFACES) {
    it(`${file} carries a multi-select file input + native source sheet`, () => {
      const src = read(file);
      expect(hasMultipleInput(src), `${file}: hidden file input must carry \`multiple\``).toBe(true);
      expect(src).toContain('pickNativePhotos');
      expect(src).toContain('AddPhotoSourceSheet');
      // The batch loop reads every selected file, not just the first.
      expect(src).toContain('Array.from(e.target.files');
      expect(src, `${file}: single-file e.target.files?.[0] pattern must not return`).not.toContain('e.target.files?.[0]');
    });
  }
});

describe('quick-capture surfaces stay snap-first and single-shot', () => {
  for (const file of SNAP_FIRST_SURFACES) {
    it(`${file} keeps the one-shot takeNativePhoto flow`, () => {
      const src = read(file);
      expect(src).toContain('takeNativePhoto');
      expect(src, `${file}: quick-capture must not open the multi picker`).not.toContain('pickNativePhotos');
      expect(hasMultipleInput(src), `${file}: quick-capture input must stay single-file`).toBe(false);
    });
  }
});

describe('nativeCamera multi-pick contract', () => {
  it('pickNativePhotos multi-selects via chooseFromGallery with a pickImages fallback', () => {
    const src = read('src/lib/nativeCamera.js');
    expect(src).toContain('export async function pickNativePhotos');
    expect(src).toContain('allowMultipleSelection: true');
    // Older installed binaries predate chooseFromGallery (plugin 8.x) — the
    // deprecated-but-present pickImages keeps them working.
    expect(src).toContain('Camera.pickImages');
    // Batch filenames carry a per-item suffix so same-millisecond conversions
    // cannot collide in the `${jobId}/${ts}-${name}` storage path.
    expect(src).toMatch(/webPathToFile\(item\.webPath, item\.format, `-\$\{i\}`\)/);
  });

  it('the snap-first entry point is untouched: takeNativePhoto still prompts', () => {
    const src = read('src/lib/nativeCamera.js');
    expect(src).toContain('export async function takeNativePhoto');
    expect(src).toContain('CameraSource.Prompt');
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
